// ops-6yu.pages.dev/api/bridge (docs/setup.md, part 3): where the bridge is right now.
// The bridge POSTs its new trycloudflare.com address on every start (Bearer SLOP_TOKEN);
// the page reads it with GET. Needs the KV binding SLOP_KV and the secret SLOP_TOKEN.
const TUNNEL = /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/;

async function same(a, b) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all(
    [a, b].map((s) => crypto.subtle.digest('SHA-256', enc.encode(String(s)))),
  );
  const u = new Uint8Array(x);
  const v = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < u.length; i++) diff |= u[i] ^ v[i];
  return diff === 0;
}

const json = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

export async function onRequestGet({ env }) {
  const saved = await env.SLOP_KV.get('bridge', 'json');
  return json(saved ?? { url: '' });
}

export async function onRequestPost({ request, env }) {
  const bearer = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!env.SLOP_TOKEN || !bearer || !(await same(bearer, env.SLOP_TOKEN)))
    return json({ error: 'unauthorized' }, 401);
  const { url } = await request.json().catch(() => ({}));
  if (!TUNNEL.test(String(url ?? ''))) return json({ error: 'not a tunnel address' }, 400);
  await env.SLOP_KV.put('bridge', JSON.stringify({ url, at: new Date().toISOString() }));
  return json({ ok: true });
}
