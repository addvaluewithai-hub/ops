import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { claudeArgs, describe } from '../bridge/claude.mjs';
import { bridgeConfig } from '../bridge/config.mjs';
import { liveSetup } from '../bridge/live.mjs';
import { pendingImages, withSrc } from '../bridge/media.mjs';
import { createBridge } from '../bridge/server.mjs';
import { assemble, ensureProject, projectPath } from '../bridge/site.mjs';
import { TUNNEL_URL } from '../bridge/tunnel.mjs';

const FAKE = fileURLToPath(new URL('./fake-claude.mjs', import.meta.url));

test('the intern only gets file tools and never asks for permission', () => {
  const args = claudeArgs({
    prompt: 'go',
    sessionId: 'abc',
    resume: false,
    config: bridgeConfig({}),
    brief: 'brief',
  });
  assert.equal(args[args.indexOf('--tools') + 1], 'Read,Write,Edit,Glob,Grep');
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'dontAsk');
  assert.equal(args[args.indexOf('--session-id') + 1], 'abc');
  assert.ok(!args.includes('Bash'));
  assert.equal(describe('Write', { file_path: '/p/sections/hero.html' }, '/p'), 'writing sections/hero.html');
});

test('pictures to make are found and filled in', () => {
  const html = '<img data-gen="a &quot;loud&quot; bowl" alt="x" src=""><img data-gen="done" src="img/a.png">';
  const pending = pendingImages(html);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].prompt, 'a "loud" bowl');
  assert.equal(pending[0].aspect, '16:9');
  assert.match(withSrc(pending[0].tag, 'img/b.png'), /src="img\/b\.png"/);
  assert.match(withSrc('<img data-gen="x">', 'img/c.png'), /^<img src="img\/c\.png" data-gen/);
});

test('project paths cannot leave the project or read hidden folders', () => {
  assert.equal(projectPath('/p', '../etc/passwd'), null);
  assert.equal(projectPath('/p', '%2e%2e/x'), null);
  assert.equal(projectPath('/p', '.slop/sessions.json'), null);
  assert.equal(projectPath('/p', 'img/a.png'), '/p/img/a.png');
});

test('unwritten sections show as wireframe boxes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'slop-'));
  await ensureProject(dir);
  await writeFile(join(dir, 'site.json'), '{"title":"Slurp","sections":["hero","menu","Bad Id"]}');
  await writeFile(join(dir, 'sections', 'hero.html'), '<section id="hero">hi</section>');
  const page = await assemble(dir);
  assert.match(page, /<section id="hero">hi<\/section>/);
  assert.match(page, /class="slop-wire"><span>MENU</);
  assert.doesNotMatch(page, /Bad Id/);
});

test('the quick tunnel address is read from cloudflared output', () => {
  const line = '2026-11-06 INF |  https://brave-red-eye-12.trycloudflare.com  |';
  assert.equal(TUNNEL_URL.exec(line)[0], 'https://brave-red-eye-12.trycloudflare.com');
});

test('live tools default to non-blocking so SLOP keeps talking', () => {
  const setup = liveSetup({
    instruction: 'x',
    tools: [{ name: 'build_section', description: 'd', parameters: { type: 'object', properties: { key: { type: 'string' } } } }],
  });
  const fn = setup.tools[0].functionDeclarations[0];
  assert.equal(fn.behavior, 'NON_BLOCKING');
  assert.equal(fn.parameters.type, 'OBJECT');
  assert.equal(fn.parameters.properties.key.type, 'STRING');
});

test('a build streams to the browser and its pictures are filled in', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'slop-'));
  await ensureProject(dir);
  const config = { ...bridgeConfig({ SLOP_TOKEN: 'secret', MEDIA_URL: 'http://media' }), port: 0 };
  const media = {
    image: async () => ({ bytes: Buffer.from('png'), mimeType: 'image/png', model: 'm', ms: 5 }),
  };
  const spawner = (_bin, args, options) => spawn(process.execPath, [FAKE, ...args], options);
  const { server } = createBridge({ config, dir, media, spawner });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/api/state`)).status, 401);
    const login = await fetch(`${base}/?key=secret`, { redirect: 'manual' });
    assert.equal(login.status, 302);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    assert.doesNotMatch(cookie, /secret/);

    const ws = new WebSocket(`${base.replace('http', 'ws')}/ws`, { headers: { cookie } });
    const events = [];
    await new Promise((resolve) => ws.once('open', resolve));
    const finished = new Promise((resolve) =>
      ws.on('message', (data) => {
        const event = JSON.parse(data);
        events.push(event);
        if (event.type === 'media' && event.state !== 'start') resolve();
      }),
    );
    const started = await fetch(`${base}/api/build`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'hero', prompt: 'build the hero' }),
    });
    assert.equal(started.status, 202);
    await finished;
    ws.close();

    const kinds = events.map((e) => `${e.type}:${e.state}${e.kind ? `:${e.kind}` : ''}`);
    assert.ok(kinds.includes('build:step:tool'));
    assert.ok(kinds.includes('build:done'));
    assert.ok(kinds.includes('media:done:image'));
    const hero = await readFile(join(dir, 'sections', 'hero.html'), 'utf8');
    assert.match(hero, /src="img\/[0-9a-f]{16}\.png"/);
    const sessions = JSON.parse(await readFile(join(dir, '.slop', 'sessions.json'), 'utf8'));
    assert.match(sessions.hero, /^[0-9a-f-]{36}$/);
    const served = await fetch(`${base}/site/${/src="([^"]+)"/.exec(hero)[1]}`, { headers: { cookie } });
    assert.equal(await served.text(), 'png');
  } finally {
    server.close();
  }
});
