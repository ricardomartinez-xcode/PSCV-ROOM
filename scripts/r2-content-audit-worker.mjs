export default {
  async fetch(request, env) {
    const auth = request.headers.get('authorization');
    if (!env.AUDIT_TOKEN || auth !== `Bearer ${env.AUDIT_TOKEN}`) return new Response('unauthorized', { status: 401 });
    const url = new URL(request.url);
    if (url.pathname === '/health') return new Response('ok');
    if (url.pathname !== '/object') return new Response('not found', { status: 404 });
    const key = url.searchParams.get('key');
    if (!key) return new Response('missing key', { status: 400 });
    const obj = await env.R2.get(key);
    if (!obj) return new Response('not found', { status: 404 });
    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set('etag', obj.httpEtag || '');
    headers.set('x-r2-size', String(obj.size || 0));
    return new Response(obj.body, { headers });
  },
};
