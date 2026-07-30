export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/copy" || request.method !== "POST") return new Response("Not found", { status: 404 });
    if (request.headers.get("Authorization") !== `Bearer ${env.MIGRATION_TOKEN}`) return new Response("Not found", { status: 404 });
    try {
      const { source, target } = await request.json();
      if (typeof source !== "string" || typeof target !== "string" || !source || !target || source === target) {
        return Response.json({ error: "Ruta inválida." }, { status: 400 });
      }
      if (!(target.startsWith("Recursos Generales/") || target.startsWith("Materiales de clase/"))) {
        return Response.json({ error: "Destino fuera de la jerarquía aprobada." }, { status: 400 });
      }
      const sourceObject = await env.R2.get(source);
      if (!sourceObject) return Response.json({ error: `Origen no encontrado: ${source}` }, { status: 404 });
      const existing = await env.R2.head(target);
      if (existing && existing.size === sourceObject.size && existing.etag === sourceObject.etag) {
        return Response.json({ ok: true, reused: true, size: existing.size, etag: existing.etag });
      }
      await env.R2.put(target, sourceObject.body, {
        httpMetadata: sourceObject.httpMetadata,
        customMetadata: { ...(sourceObject.customMetadata ?? {}), migrationSource: source },
      });
      const verified = await env.R2.head(target);
      if (!verified || verified.size !== sourceObject.size) {
        return Response.json({ error: `No se pudo verificar la copia: ${target}` }, { status: 500 });
      }
      return Response.json({ ok: true, reused: false, size: verified.size, etag: verified.etag });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
  },
};
