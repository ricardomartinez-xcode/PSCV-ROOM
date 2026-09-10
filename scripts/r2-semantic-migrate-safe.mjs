#!/usr/bin/env node
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import crypto from 'node:crypto'; import {spawnSync} from 'node:child_process';
const PLAN=process.env.SEMANTIC_PLAN||'outputs/r2-semantic-migration-plan.json', APPLY=process.env.MIGRATION_CONFIRM==='MIGRATE_SAFE', DELETE_SOURCES=process.env.DELETE_SOURCE_DUPLICATES==='DELETE_EXACT_DUPLICATES', BUCKET='psicologia', DB='pscv-room';
function run(c,a,{allowFail=false}={}){const r=spawnSync(c,a,{encoding:'utf8',stdio:['ignore','pipe','pipe']}); if(r.status!==0&&!allowFail) throw new Error(`${c} ${a.join(' ')} failed: ${(r.stderr||r.stdout).trim()}`); return r;}
function sha(f){return crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')} function q(v){return `'${String(v).replaceAll("'","''")}'`}
function slug(s){return s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'seccion'}
function d1(sql){return JSON.parse(run('npx',['wrangler','d1','execute',DB,'--remote','--json','--command',sql]).stdout||'[]')} function rows(x){return Array.isArray(x)?(x[0]?.results||[]):(x?.result?.[0]?.results||[])}
function ensureSection(p,cache){let parent=null,cur=''; for(const [i,part] of p.split('/').filter(Boolean).entries()){cur=cur?`${cur}/${part}`:part; if(cache.has(cur)){parent=cache.get(cur);continue} const hit=rows(d1(`SELECT id FROM material_sections WHERE path=${q(cur)} LIMIT 1`))[0]; if(hit){cache.set(cur,hit.id);parent=hit.id;continue} const id=crypto.randomUUID(); d1(`INSERT INTO material_sections (id,parent_id,name,slug,path,active,sort_order) VALUES (${q(id)},${parent?q(parent):'NULL'},${q(part)},${q(slug(part))},${q(cur)},1,${i*100})`); cache.set(cur,id); parent=id} return parent}
function get(k,f,allowFail=false){return run('npx',['wrangler','r2','object','get',`${BUCKET}/${k}`,'--file',f,'--remote'],{allowFail})} function put(k,f){return run('npx',['wrangler','r2','object','put',`${BUCKET}/${k}`,'--file',f,'--remote'])} function del(k){return run('npx',['wrangler','r2','object','delete',`${BUCKET}/${k}`,'--remote'])}
if(!fs.existsSync(PLAN)) throw new Error(`Missing semantic plan: ${PLAN}`); const plan=JSON.parse(fs.readFileSync(PLAN,'utf8')), candidates=plan.filter(x=>x.safe_to_migrate&&x.sha256&&x.canonical_source&&x.target);
const targetHashes=new Map(); for(const x of candidates){if(!targetHashes.has(x.target))targetHashes.set(x.target,new Set());targetHashes.get(x.target).add(x.sha256)}
const collidedTargets=new Set([...targetHashes].filter(([,v])=>v.size>1).map(([k])=>k)); const safe=candidates.filter(x=>!collidedTargets.has(x.target)), review=plan.filter(x=>!x.safe_to_migrate||collidedTargets.has(x.target));
console.log(JSON.stringify({mode:APPLY?'APPLY_SAFE':'DRY_RUN',delete_exact_duplicate_sources:DELETE_SOURCES,groups:plan.length,safe:safe.length,review:review.length,target_collisions:collidedTargets.size},null,2)); if(!APPLY){console.log('Dry-run only. Set MIGRATION_CONFIRM=MIGRATE_SAFE to apply.');process.exit(0)}
const cache=new Map(rows(d1('SELECT id,path FROM material_sections')).map(x=>[x.path,x.id])), report=[];
for(const [i,item] of safe.entries()){
  const tmp=path.join(os.tmpdir(),`pscv-semantic-${process.pid}-${i}`), check=`${tmp}.verify`;
  const deleteChecks=[];
  try{
    const sourceInitial=get(item.canonical_source,tmp,true);
    if(sourceInitial.status===0 && sha(tmp)!==item.sha256) throw new Error(`Source hash mismatch: ${item.canonical_source}`);
    const ex=get(item.target,check,true);
    if(ex.status===0){if(sha(check)!==item.sha256) throw new Error(`Target differs: ${item.target}`)}
    else {
      if(sourceInitial.status!==0) throw new Error(`Neither verified target nor canonical source exists: ${item.target}`);
      put(item.target,tmp);get(item.target,check);if(sha(check)!==item.sha256) throw new Error(`Target verify failed: ${item.target}`)
    }
    const sources=[...new Set([item.canonical_source,...(item.duplicate_sources||[])])];
    const lookupKeys=[item.target,...sources];
    const dbRows=rows(d1(`SELECT id,r2_key FROM materials WHERE provider='r2' AND r2_key IN (${lookupKeys.map(q).join(',')}) ORDER BY id`));
    const canonical=dbRows.find(x=>x.r2_key===item.target)||dbRows.find(x=>x.r2_key===item.canonical_source)||dbRows[0];
    if(!canonical) throw new Error(`No D1 row for ${item.canonical_source}`);
    const sectionId=ensureSection(item.target.split('/').slice(0,-1).join('/'),cache);
    d1(`UPDATE materials SET r2_key=${q(item.target)}, section_id=${q(sectionId)}, visibility='visible', updated_at=CURRENT_TIMESTAMP WHERE id=${q(canonical.id)}`);
    for(const r of dbRows) if(r.id!==canonical.id){
      d1(`INSERT OR IGNORE INTO task_materials (task_id,material_id) SELECT task_id,${q(canonical.id)} FROM task_materials WHERE material_id=${q(r.id)}`);
      d1(`UPDATE materials SET visibility='hidden', updated_at=CURRENT_TIMESTAMP WHERE id=${q(r.id)}`);
    }
    const deleted=[];
    if(DELETE_SOURCES){
      for(const [sourceIndex,source] of sources.entries()){
        if(source===item.target) continue;
        const visibleRefs=Number(rows(d1(`SELECT COUNT(*) AS n FROM materials WHERE provider='r2' AND r2_key=${q(source)} AND visibility='visible'`))[0]?.n??0);
        if(visibleRefs!==0) throw new Error(`Refusing to delete source still referenced by a visible D1 row: ${source}`);
        const sourceCheck=path.join(os.tmpdir(),`pscv-semantic-delete-${process.pid}-${i}-${sourceIndex}`);
        deleteChecks.push(sourceCheck);
        const sourceGet=get(source,sourceCheck,true);
        if(sourceGet.status!==0) continue;
        if(sha(sourceCheck)!==item.sha256) throw new Error(`Refusing to delete changed duplicate source: ${source}`);
        del(source);
        const verify=get(source,sourceCheck+'.gone',true);
        deleteChecks.push(sourceCheck+'.gone');
        if(verify.status===0) throw new Error(`Source still exists after delete: ${source}`);
        deleted.push(source);
      }
    }
    report.push({sha256:item.sha256,target:item.target,canonical_id:canonical.id,hidden_duplicate_ids:dbRows.filter(x=>x.id!==canonical.id).map(x=>x.id),source_objects_retained:DELETE_SOURCES?sources.filter(x=>!deleted.includes(x)):sources,source_objects_deleted:deleted});
    console.log(`[${i+1}/${safe.length}] ${item.target} deleted=${deleted.length}`)
  } finally {
    for(const f of [tmp,check,...deleteChecks])try{fs.unlinkSync(f)}catch{}
  }
}
const residual={deleted:[],missing:[],unmatched:[],shared_with_visible:[]};
if(DELETE_SOURCES){
  const visibleRows=rows(d1("SELECT id,r2_key FROM materials WHERE provider='r2' AND r2_key IS NOT NULL AND visibility='visible' ORDER BY id"));
  const hiddenRows=rows(d1("SELECT id,r2_key FROM materials WHERE provider='r2' AND r2_key IS NOT NULL AND visibility='hidden' ORDER BY id"));
  const legacyVisible=Number(rows(d1("SELECT COUNT(*) AS n FROM materials WHERE provider='r2' AND r2_key IS NOT NULL AND visibility='visible' AND r2_key NOT LIKE 'Materias/%' AND r2_key NOT LIKE 'Biblioteca/%' AND r2_key NOT LIKE 'Instrumentos psicológicos/%'"))[0]?.n??-1);
  if(visibleRows.length!==153) throw new Error(`Residual cleanup expected 153 visible canonical materials, found ${visibleRows.length}`);
  if(legacyVisible!==0) throw new Error(`Residual cleanup found ${legacyVisible} visible legacy paths`);
  const visibleKeys=[...new Set(visibleRows.map(x=>x.r2_key))], visibleSet=new Set(visibleKeys), hiddenKeys=[...new Set(hiddenRows.map(x=>x.r2_key))];
  const visibleBySig=new Map();
  for(const [idx,key] of visibleKeys.entries()){
    const file=path.join(os.tmpdir(),`pscv-semantic-visible-${process.pid}-${idx}`);
    try{
      const r=get(key,file,true); if(r.status!==0) throw new Error(`Visible canonical object missing during residual cleanup: ${key}`);
      const sig=`${sha(file)}:${fs.statSync(file).size}`; if(!visibleBySig.has(sig)) visibleBySig.set(sig,[]); visibleBySig.get(sig).push(key);
    } finally { try{fs.unlinkSync(file)}catch{} }
  }
  for(const [idx,key] of hiddenKeys.entries()){
    if(visibleSet.has(key)){residual.shared_with_visible.push(key);continue}
    const file=path.join(os.tmpdir(),`pscv-semantic-hidden-${process.pid}-${idx}`), gone=`${file}.gone`;
    try{
      const r=get(key,file,true); if(r.status!==0){residual.missing.push(key);continue}
      const sig=`${sha(file)}:${fs.statSync(file).size}`, matches=visibleBySig.get(sig)||[];
      if(!matches.length){residual.unmatched.push({key,sha256:sig.split(':')[0],size:Number(sig.split(':')[1])});continue}
      const visibleRefs=Number(rows(d1(`SELECT COUNT(*) AS n FROM materials WHERE provider='r2' AND r2_key=${q(key)} AND visibility='visible'`))[0]?.n??0);
      if(visibleRefs!==0) throw new Error(`Refusing residual delete for visible-referenced key: ${key}`);
      del(key); const verify=get(key,gone,true); if(verify.status===0) throw new Error(`Residual duplicate still exists after delete: ${key}`);
      residual.deleted.push({key,canonical_matches:matches,sha256:sig.split(':')[0],size:Number(sig.split(':')[1])});
    } finally { for(const f of [file,gone])try{fs.unlinkSync(f)}catch{} }
  }
}
const plannedDeletedCount=report.reduce((n,item)=>n+(item.source_objects_deleted?.length||0),0), residualDeletedCount=residual.deleted.length, deletedCount=plannedDeletedCount+residualDeletedCount;
fs.mkdirSync('outputs',{recursive:true});
fs.writeFileSync('outputs/r2-semantic-migration-applied.json',JSON.stringify({applied_at:new Date().toISOString(),deleted_source_objects:deletedCount,planned_source_objects_deleted:plannedDeletedCount,residual_exact_duplicates_deleted:residualDeletedCount,items:report,residual_cleanup:residual,review_groups_skipped:review.length},null,2));
console.log(JSON.stringify({migrated:report.length,review_groups_skipped:review.length,planned_source_objects_deleted:plannedDeletedCount,residual_exact_duplicates_deleted:residualDeletedCount,source_objects_deleted:deletedCount,residual_missing:residual.missing.length,residual_unmatched:residual.unmatched.length,residual_shared_with_visible:residual.shared_with_visible.length},null,2));

