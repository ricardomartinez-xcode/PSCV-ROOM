#!/usr/bin/env python3
import json, os, re, tempfile, urllib.parse, urllib.request, unicodedata
from pathlib import Path
from collections import Counter

URL=os.environ['AUDIT_WORKER_URL']; TOKEN=os.environ['AUDIT_WORKER_TOKEN']
raw=json.load(open('r2-audit-materials.json',encoding='utf-8'))
rows=(raw[0].get('results',[]) if isinstance(raw,list) else raw.get('result',[{}])[0].get('results',[]))

def norm(s):
    s=unicodedata.normalize('NFD',s or '')
    return re.sub(r'\s+',' ',''.join(c for c in s if unicodedata.category(c)!='Mn').lower())

def fetch(key):
    u=f"{URL}/object?key={urllib.parse.quote(key,safe='')}"
    r=urllib.request.Request(u,headers={'Authorization':f'Bearer {TOKEN}'})
    with urllib.request.urlopen(r,timeout=120) as x: return x.read()

def extract(data,name):
    ext=Path(name).suffix.lower(); p=None
    try:
        with tempfile.NamedTemporaryFile(suffix=ext,delete=False) as f: f.write(data); p=f.name
        if ext=='.pdf':
            from pypdf import PdfReader
            return ' '.join((pg.extract_text() or '') for pg in PdfReader(p).pages[:100]),'PDF',None
        if ext=='.docx':
            from docx import Document
            d=Document(p); return ' '.join(x.text for x in d.paragraphs),'Documento Word',None
        if ext=='.pptx':
            from pptx import Presentation
            prs=Presentation(p); return ' '.join(sh.text for sl in prs.slides for sh in sl.shapes if hasattr(sh,'text')),'Presentación',None
        if ext=='.xlsx':
            from openpyxl import load_workbook
            wb=load_workbook(p,read_only=True,data_only=True)
            return ' '.join(str(v) for ws in wb.worksheets for row in ws.iter_rows(max_row=500,values_only=True) for v in row if v is not None),'Hoja de cálculo',None
        if ext in {'.txt','.md','.csv','.rtf'}: return data.decode('utf-8','ignore'),'Texto',None
        return '',ext.lstrip('.').upper() or 'Archivo','formato sin extractor'
    except Exception as e: return '',ext.lstrip('.').upper() or 'Archivo',f'{type(e).__name__}: {e}'
    finally:
        if p:
            try: os.unlink(p)
            except: pass

AREAS={
'Psicología Clínica':['psicoterapia','terapia','intervencion','duelo','depresion','ansiedad','paciente','salud mental','diagnostico clinico'],
'Psicopatología':['psicopatologia','trastorno','dsm','cie 10','psicosis','esquizofrenia','bipolar','trastornos de la personalidad'],
'Psicología Educativa':['psicologia educativa','educacion','aprendizaje','docente','alumno','escolar','ensenanza','pedagog'],
'Psicología Organizacional':['psicologia organizacional','recursos humanos','capital humano','talento humano','clima laboral','seleccion de personal'],
'Psicología Jurídica y Forense':['forense','juridica','criminologia','criminal','delito','victima','peritaje','perfilacion'],
'Investigación y Metodología':['metodologia','investigacion','hipotesis','variable','muestra','apa','estadistica','diseno de investigacion'],
'Psicometría':['psicometria','test psicologico','cuestionario','escala','baremo','validez','confiabilidad','wais','wisc','inventario','instrumento psicologico'],
'Psicología Social':['psicologia social','procesos grupales','dinamica de grupos','influencia social','actitud','comunidad','problematica social'],
'Psicología del Desarrollo':['desarrollo humano','desarrollo infantil','adolescencia','infancia','vejez','ciclo vital','piaget','erikson'],
'Neuropsicología':['neuropsicologia','cerebro','funciones ejecutivas','memoria','atencion','neurolog','cognicion'],
'Psicología General':['psicologia','conducta','emocion','motivacion','personalidad','teoria psicologica']}
COURSES={
'Alteraciones de la Conducta':['alteraciones de la conducta','conducta anormal','psicopatologia','trastorno'],
'Evaluación Psicológica I':['evaluacion psicologica','psicodiagnostico','entrevista psicologica','pruebas psicologicas','test psicologico'],
'Psicología del Aprendizaje':['teorias del aprendizaje','psicologia del aprendizaje','condicionamiento','skinner','pavlov','bandura'],
'Teoría y Práctica de Procesos Grupales':['procesos grupales','dinamica de grupos','cohesion grupal','liderazgo grupal'],
'Psicología en la Problemática Social Mexicana':['problematica social mexicana','violencia social','desigualdad','comunidad mexicana']}
TYPES={
'Instrumentos':['test','cuestionario','escala','inventario','protocolo','hoja de respuesta','cuadernillo'],
'Manuales':['manual','guia de aplicacion','instrucciones'],
'Artículos científicos':['abstract','metodologia','resultados','discusion','doi'],
'Casos y prácticas':['caso clinico','caso practico','actividad','ejercicio','practica'],
'Lecturas':['capitulo','lectura','introduccion','conclusion']}

def score(t,words): return sum((3 if ' ' in w else 1)*t.count(norm(w)) for w in words)
def choose(t,table,default):
    ranked=sorted(((score(t,v),k) for k,v in table.items()),reverse=True)
    return (ranked[0][1],ranked[0][0],ranked[1][0] if len(ranked)>1 else 0) if ranked and ranked[0][0] else (default,0,0)
def clean_name(k): return re.sub(r'^[0-9a-f]{8}-[0-9a-f-]{27}-','',Path(k).name,flags=re.I)

out=[]
for i,row in enumerate(rows,1):
    key=row['r2_key']; title=row.get('title') or clean_name(key)
    try: data=fetch(key); text,kind,err=extract(data,key)
    except Exception as e: text=''; kind='Archivo'; err=f'{type(e).__name__}: {e}'
    body=norm(text[:800000]); basis=body if len(body)>=120 else norm(title+' '+key)
    area,ascore,a2=choose(basis,AREAS,'Psicología General')
    course,cscore,c2=choose(basis,COURSES,'')
    dtype,dscore,_=choose(basis,TYPES,'Lecturas')
    if Path(key).suffix.lower()=='.pptx': dtype='Presentaciones'
    if any(x in norm(title) for x in ['test','escala','cuestionario','inventario','wais','wisc']): dtype='Instrumentos'
    is_course=bool(course and cscore>=5 and cscore>=max(2,c2*1.25))
    if is_course:
        target=f'Materiales de clase/Sexto cuatrimestre/{course}/{dtype}/{clean_name(key)}'; section=f'Materias / Sexto cuatrimestre / {course} / {dtype}'
    else:
        target=f'Biblioteca/{area}/{dtype}/{clean_name(key)}'; section=f'Biblioteca / {area} / {dtype}'
    strength=max(ascore,cscore); conf='alta' if strength>=12 else ('media' if strength>=5 else 'baja')
    rec={'id':row.get('id'),'title':title,'source':key,'target':target,'section':section,'area':area,'course':course or None,'document_type':dtype,'file_kind':kind,'text_chars':len(text),'confidence':conf,'scores':{'area':ascore,'course':cscore,'type':dscore},'needs_review':bool(err or len(text)<120 or conf=='baja')}
    if err: rec['extraction_error']=err
    out.append(rec); print(f'[{i}/{len(rows)}] {conf:5} {area} :: {title[:90]} :: error={err or "-"}')

Path('outputs').mkdir(exist_ok=True)
json.dump(out,open('outputs/r2-semantic-classification.json','w',encoding='utf-8'),ensure_ascii=False,indent=2)
summary={'total':len(out),'readable_content':sum(x['text_chars']>=120 for x in out),'needs_review':sum(x['needs_review'] for x in out),'confidence':dict(Counter(x['confidence'] for x in out)),'areas':dict(Counter(x['area'] for x in out)),'document_types':dict(Counter(x['document_type'] for x in out)),'courses':dict(Counter(x['course'] for x in out if x['course'])),'extraction_errors':sum('extraction_error' in x for x in out),'review_items':[{'title':x['title'],'source':x['source'],'area':x['area'],'course':x['course'],'text_chars':x['text_chars']} for x in out if x['needs_review']]}
json.dump(summary,open('outputs/r2-semantic-summary.json','w',encoding='utf-8'),ensure_ascii=False,indent=2)
print(json.dumps(summary,ensure_ascii=False,indent=2))
#!/usr/bin/env python3
import json, os, re, tempfile, urllib.parse, urllib.request, unicodedata
from pathlib import Path
from collections import Counter

URL=os.environ['AUDIT_WORKER_URL']; TOKEN=os.environ['AUDIT_WORKER_TOKEN']
raw=json.load(open('r2-audit-materials.json',encoding='utf-8'))
rows=(raw[0].get('results',[]) if isinstance(raw,list) else raw.get('result',[{}])[0].get('results',[]))

def norm(s):
    s=unicodedata.normalize('NFD',s or '')
    return re.sub(r'\s+',' ',''.join(c for c in s if unicodedata.category(c)!='Mn').lower())

def fetch(key):
    u=f"{URL}/object?key={urllib.parse.quote(key,safe='')}"
    r=urllib.request.Request(u,headers={'Authorization':f'Bearer {TOKEN}'})
    with urllib.request.urlopen(r,timeout=120) as x: return x.read()

def extract(data,name):
    ext=Path(name).suffix.lower(); p=None
    try:
        with tempfile.NamedTemporaryFile(suffix=ext,delete=False) as f: f.write(data); p=f.name
        if ext=='.pdf':
            from pypdf import PdfReader
            return ' '.join((pg.extract_text() or '') for pg in PdfReader(p).pages[:100]),'PDF',None
        if ext=='.docx':
            from docx import Document
            d=Document(p); return ' '.join(x.text for x in d.paragraphs),'Documento Word',None
        if ext=='.pptx':
            from pptx import Presentation
            prs=Presentation(p); return ' '.join(sh.text for sl in prs.slides for sh in sl.shapes if hasattr(sh,'text')),'Presentación',None
        if ext=='.xlsx':
            from openpyxl import load_workbook
            wb=load_workbook(p,read_only=True,data_only=True)
            return ' '.join(str(v) for ws in wb.worksheets for row in ws.iter_rows(max_row=500,values_only=True) for v in row if v is not None),'Hoja de cálculo',None
        if ext in {'.txt','.md','.csv','.rtf'}: return data.decode('utf-8','ignore'),'Texto',None
        return '',ext.lstrip('.').upper() or 'Archivo','formato sin extractor'
    except Exception as e: return '',ext.lstrip('.').upper() or 'Archivo',f'{type(e).__name__}: {e}'
    finally:
        if p:
            try: os.unlink(p)
            except: pass

AREAS={
'Psicología Clínica':['psicoterapia','terapia','intervencion','duelo','depresion','ansiedad','paciente','salud mental','diagnostico clinico'],
'Psicopatología':['psicopatologia','trastorno','dsm','cie 10','psicosis','esquizofrenia','bipolar','trastornos de la personalidad'],
'Psicología Educativa':['psicologia educativa','educacion','aprendizaje','docente','alumno','escolar','ensenanza','pedagog'],
'Psicología Organizacional':['psicologia organizacional','recursos humanos','capital humano','talento humano','clima laboral','seleccion de personal'],
'Psicología Jurídica y Forense':['forense','juridica','criminologia','criminal','delito','victima','peritaje','perfilacion'],
'Investigación y Metodología':['metodologia','investigacion','hipotesis','variable','muestra','apa','estadistica','diseno de investigacion'],
'Psicometría':['psicometria','test psicologico','cuestionario','escala','baremo','validez','confiabilidad','wais','wisc','inventario','instrumento psicologico'],
'Psicología Social':['psicologia social','procesos grupales','dinamica de grupos','influencia social','actitud','comunidad','problematica social'],
'Psicología del Desarrollo':['desarrollo humano','desarrollo infantil','adolescencia','infancia','vejez','ciclo vital','piaget','erikson'],
'Neuropsicología':['neuropsicologia','cerebro','funciones ejecutivas','memoria','atencion','neurolog','cognicion'],
'Psicología General':['psicologia','conducta','emocion','motivacion','personalidad','teoria psicologica']}
COURSES={
'Alteraciones de la Conducta':['alteraciones de la conducta','conducta anormal','psicopatologia','trastorno'],
'Evaluación Psicológica I':['evaluacion psicologica','psicodiagnostico','entrevista psicologica','pruebas psicologicas','test psicologico'],
'Psicología del Aprendizaje':['teorias del aprendizaje','psicologia del aprendizaje','condicionamiento','skinner','pavlov','bandura'],
'Teoría y Práctica de Procesos Grupales':['procesos grupales','dinamica de grupos','cohesion grupal','liderazgo grupal'],
'Psicología en la Problemática Social Mexicana':['problematica social mexicana','violencia social','desigualdad','comunidad mexicana']}
TYPES={
'Instrumentos':['test','cuestionario','escala','inventario','protocolo','hoja de respuesta','cuadernillo'],
'Manuales':['manual','guia de aplicacion','instrucciones'],
'Artículos científicos':['abstract','metodologia','resultados','discusion','doi'],
'Casos y prácticas':['caso clinico','caso practico','actividad','ejercicio','practica'],
'Lecturas':['capitulo','lectura','introduccion','conclusion']}

def score(t,words): return sum((3 if ' ' in w else 1)*t.count(norm(w)) for w in words)
def choose(t,table,default):
    ranked=sorted(((score(t,v),k) for k,v in table.items()),reverse=True)
    return (ranked[0][1],ranked[0][0],ranked[1][0] if len(ranked)>1 else 0) if ranked and ranked[0][0] else (default,0,0)
def clean_name(k): return re.sub(r'^[0-9a-f]{8}-[0-9a-f-]{27}-','',Path(k).name,flags=re.I)

out=[]
for i,row in enumerate(rows,1):
    key=row['r2_key']; title=row.get('title') or clean_name(key)
    try: data=fetch(key); text,kind,err=extract(data,key)
    except Exception as e: text=''; kind='Archivo'; err=f'{type(e).__name__}: {e}'
    body=norm(text[:800000]); basis=body if len(body)>=120 else norm(title+' '+key)
    area,ascore,a2=choose(basis,AREAS,'Psicología General')
    course,cscore,c2=choose(basis,COURSES,'')
    dtype,dscore,_=choose(basis,TYPES,'Lecturas')
    if Path(key).suffix.lower()=='.pptx': dtype='Presentaciones'
    if any(x in norm(title) for x in ['test','escala','cuestionario','inventario','wais','wisc']): dtype='Instrumentos'
    is_course=bool(course and cscore>=5 and cscore>=max(2,c2*1.25))
    if is_course:
        target=f'Materiales de clase/Sexto cuatrimestre/{course}/{dtype}/{clean_name(key)}'; section=f'Materias / Sexto cuatrimestre / {course} / {dtype}'
    else:
        target=f'Biblioteca/{area}/{dtype}/{clean_name(key)}'; section=f'Biblioteca / {area} / {dtype}'
    strength=max(ascore,cscore); conf='alta' if strength>=12 else ('media' if strength>=5 else 'baja')
    rec={'id':row.get('id'),'title':title,'source':key,'target':target,'section':section,'area':area,'course':course or None,'document_type':dtype,'file_kind':kind,'text_chars':len(text),'confidence':conf,'scores':{'area':ascore,'course':cscore,'type':dscore},'needs_review':bool(err or len(text)<120 or conf=='baja')}
    if err: rec['extraction_error']=err
    out.append(rec); print(f'[{i}/{len(rows)}] {conf:5} {area} :: {title[:90]}')

Path('outputs').mkdir(exist_ok=True)
json.dump(out,open('outputs/r2-semantic-classification.json','w',encoding='utf-8'),ensure_ascii=False,indent=2)
summary={'total':len(out),'readable_content':sum(x['text_chars']>=120 for x in out),'needs_review':sum(x['needs_review'] for x in out),'confidence':dict(Counter(x['confidence'] for x in out)),'areas':dict(Counter(x['area'] for x in out)),'document_types':dict(Counter(x['document_type'] for x in out)),'courses':dict(Counter(x['course'] for x in out if x['course'])),'extraction_errors':sum('extraction_error' in x for x in out),'review_items':[{'title':x['title'],'source':x['source'],'area':x['area'],'course':x['course'],'text_chars':x['text_chars']} for x in out if x['needs_review']]}
json.dump(summary,open('outputs/r2-semantic-summary.json','w',encoding='utf-8'),ensure_ascii=False,indent=2)
print(json.dumps(summary,ensure_ascii=False,indent=2))
