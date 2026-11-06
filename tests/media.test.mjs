import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { authorized, mediaConfig, mediaHandler } from '../media/server.mjs';

const png = Buffer.from('89504e470d0a1a0a', 'hex');

function fakeVertex(routes) {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    for (const [pattern, reply] of routes)
      if (pattern.test(url)) return typeof reply === 'function' ? reply(url, init) : reply;
    return new Response('{}', { status: 500 });
  };
  return { fetcher, calls };
}

async function serve(handler, fn) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    server.close();
  }
}

const config = mediaConfig({
  SLOP_TOKEN: 'secret',
  GCP_PROJECT_ID: 'proj',
  IMAGE_MODELS: 'missing-model,real-model',
});
const auth = { authorization: 'Bearer secret', 'content-type': 'application/json' };

test('the token is checked exactly', () => {
  assert.equal(authorized('Bearer secret', 'secret'), true);
  assert.equal(authorized('Bearer secre', 'secret'), false);
  assert.equal(authorized('', 'secret'), false);
  assert.equal(authorized('Bearer ', ''), false);
});

test('a picture falls through to the first model the project has', async () => {
  const { fetcher, calls } = fakeVertex([
    [/missing-model/, new Response('nope', { status: 404 })],
    [
      /real-model:generateContent/,
      Response.json({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: png.toString('base64') } }] } }],
      }),
    ],
  ]);
  await serve(mediaHandler(config, { fetcher, token: async () => 'tok' }), async (base) => {
    assert.equal((await fetch(`${base}/image`, { method: 'POST' })).status, 401);
    const response = await fetch(`${base}/image`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ prompt: 'an eye', aspect: '4:5' }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-model'), 'real-model');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
  });
  assert.match(calls[1].url, /aiplatform\.googleapis\.com\/v1\/projects\/proj\/locations\/global\//);
  assert.equal(calls[1].body.generationConfig.imageConfig.aspectRatio, '4:5');
});

test('a clip starts, reports pending, then returns the bytes', async () => {
  let polls = 0;
  const { fetcher, calls } = fakeVertex([
    [/:predictLongRunning$/, Response.json({ name: 'projects/p/operations/op1' })],
    [
      /:fetchPredictOperation$/,
      () =>
        ++polls < 2
          ? Response.json({ done: false })
          : Response.json({ done: true, response: { videos: [{ bytesBase64Encoded: 'AAEC', mimeType: 'video/mp4' }] } }),
    ],
  ]);
  await serve(mediaHandler(config, { fetcher, token: async () => 'tok' }), async (base) => {
    const started = await fetch(`${base}/video`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ prompt: 'slow push on an eye', seconds: 20 }),
    });
    assert.equal(started.status, 202);
    const { op } = await started.json();
    const pending = await fetch(`${base}/video?op=${encodeURIComponent(op)}`, { headers: auth });
    assert.equal(pending.status, 202);
    const done = await fetch(`${base}/video?op=${encodeURIComponent(op)}`, { headers: auth });
    assert.equal(done.status, 200);
    assert.deepEqual([...Buffer.from(await done.arrayBuffer())], [0, 1, 2]);
  });
  assert.match(calls[0].url, /us-central1-aiplatform\.googleapis\.com/);
  assert.equal(calls[0].body.parameters.durationSeconds, 8);
  assert.equal(calls[1].body.operationName, 'projects/p/operations/op1');
});
