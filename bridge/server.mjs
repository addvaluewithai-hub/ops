// The bridge's HTTP and WebSocket routes (docs/setup.md, part 2). index.mjs starts it.
// Projects are folders under PROJECTS_DIR, one per site; everything about a project lives
// under /p/<name>/, so a bookmark or a refresh lands back in the same site.
//   GET  /?key=...              log in (sets a cookie), then the entry screen
//   GET  /                      the entry screen: every site, and "new site" (public/home.html)
//   GET  /api/projects          the list;  POST { name } makes one
//   GET  /p/<name>/             the stage for that site (public/index.html)
//   GET  /p/<name>/check.html   the setup check page
//   GET  /p/<name>/site/...     the website being built, assembled live
//   GET  /p/<name>/api/state    sections, spec, what is building, the public address
//   POST /p/<name>/api/live-token  a single-use Gemini Live token with SLOP's persona and tools
//   POST /p/<name>/api/spec     { field, answer }: one spec answer recorded (note_spec)
//   POST /p/<name>/api/build    { key, brief }: the intern starts now (build)
//   POST /p/<name>/api/image    { prompt, aspect }: one picture into img/
//   POST /p/<name>/api/video    { prompt, aspect, seconds, image }: one clip into video/
//   WS   /p/<name>/ws           every event of that site: build steps, files, pictures, clips
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join as joinPath } from 'node:path';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { allowed, keyMatches, loginCookie } from './auth.mjs';
import { build } from './claude.mjs';
import { liveSetup, mintLiveToken } from './live.mjs';
import { EXT, fillImages, mediaName } from './media.mjs';
import { assemble, ensureProject, projectPath, readSite, serveFile, watchProject } from './site.mjs';
import { isField, missingAll, readSpec, writeSpec } from './spec.mjs';
import { TOOLS, internPrompt, projectNote, refuseBuild } from './tools.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, 'public');
const STATIC = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const persona = () => readFile(join(HERE, 'persona.md'), 'utf8');
export const PROJECT_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    return {};
  }
}

const json = (res, status, value) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
};

const page = async (res, name) => {
  const file = await readFile(join(PUBLIC, name)).catch(() => null);
  if (!file) return json(res, 404, { error: 'not found' });
  res.writeHead(200, { 'content-type': STATIC[name.slice(name.lastIndexOf('.'))], 'cache-control': 'no-store' });
  res.end(file);
};

export function createBridge({ config, projectsDir, media, fetcher = fetch, spawner }) {
  const projects = new Map(); // name -> { dir, building, watcher }
  const state = { tunnelUrl: '' };
  let wss;
  let counter = 0;

  const broadcast = (name, event) => {
    const text = JSON.stringify(event);
    for (const client of wss?.clients ?? [])
      if (client.readyState === 1 && (name === null || client.project === name)) client.send(text);
  };

  /** The project's context, opened (and watched) on first use. */
  async function open(name) {
    if (projects.has(name)) return projects.get(name);
    const dir = join(projectsDir, name);
    await ensureProject(dir);
    const p = { name, dir, building: new Map(), seen: new Map() };
    p.watcher = watchProject(dir, (path) => broadcast(name, { type: 'file', path }));
    p.watcher.unref?.();
    // Fallback to the watcher: every 2 s, while anyone is listening, compare the mtimes of the
    // files the preview cares about and announce what changed.
    p.poll = setInterval(async () => {
      if (![...(wss?.clients ?? [])].some((c) => c.project === name && c.readyState === 1)) return;
      const files = ['site.json', 'tokens.css', 'scripts.js'];
      for (const f of await readdir(joinPath(dir, 'sections')).catch(() => [])) if (f.endsWith('.html')) files.push(`sections/${f}`);
      for (const f of files) {
        const m = await stat(joinPath(dir, f)).then((s) => s.mtimeMs, () => 0);
        const was = p.seen.get(f);
        p.seen.set(f, m);
        if (was !== undefined && m !== was) broadcast(name, { type: 'file', path: f, via: 'poll' });
      }
    }, 2000);
    p.poll.unref?.();
    projects.set(name, p);
    return p;
  }

  async function listProjects() {
    const names = (await readdir(projectsDir, { withFileTypes: true }).catch(() => []))
      .filter((d) => d.isDirectory() && PROJECT_NAME.test(d.name))
      .map((d) => d.name);
    const out = [];
    for (const name of names) {
      const dir = join(projectsDir, name);
      const site = await readSite(dir);
      const spec = await readSpec(dir);
      const built = (await builtSections(dir)).size;
      const times = await Promise.all(
        ['site.json', 'tokens.css', '.slop/spec.json', 'sections'].map((f) => stat(join(dir, f)).then((s) => s.mtimeMs, () => 0)),
      );
      out.push({
        name,
        title: site.title !== 'Untitled' ? site.title : spec.name || name,
        sections: site.sections.length,
        built,
        design: await stat(join(dir, 'tokens.css')).then(() => true, () => false),
        specDone: missingAll(spec).filter((f) => f !== 'brand').length === 0,
        updated: Math.max(...times),
        building: [...(projects.get(name)?.building.keys() ?? [])],
      });
    }
    return out.sort((a, b) => b.updated - a.updated);
  }

  const builtSections = async (dir) => {
    const names = (await readdir(join(dir, 'sections')).catch(() => [])).filter((n) => n.endsWith('.html'));
    const built = new Set();
    for (const name of names) {
      const html = await readFile(join(dir, 'sections', name), 'utf8').catch(() => '');
      if (html && !/<section\b[^>]*\bdata-wire\b/i.test(html)) built.add(name.slice(0, -5));
    }
    return built;
  };

  async function fillAllImages(p) {
    const files = await readdir(join(p.dir, 'sections')).catch(() => []);
    await Promise.all(
      files
        .filter((name) => name.endsWith('.html'))
        .map((name) =>
          fillImages({ dir: p.dir, file: `sections/${name}`, media }, (e) => broadcast(p.name, { type: 'media', ...e })),
        ),
    );
  }

  function startBuild(p, key, prompt) {
    const id = `b${++counter}`;
    p.building.set(key, id);
    broadcast(p.name, { type: 'build', id, key, state: 'start' });
    build({ dir: p.dir, key, prompt, config, ...(spawner ? { spawner } : {}) }, (step) =>
      broadcast(p.name, { type: 'build', id, key, state: 'step', ...step }),
    )
      .then((result) => {
        broadcast(p.name, { type: 'build', id, key, state: 'done', files: [...result.files], result: result.result });
        return fillAllImages(p);
      })
      .catch((error) => broadcast(p.name, { type: 'build', id, key, state: 'error', error: error.message }))
      .finally(() => p.building.delete(key));
    return id;
  }

  function startVideo(p, input) {
    const id = `v${++counter}`;
    const name = `video/${mediaName(input.prompt, input.aspect)}.mp4`;
    broadcast(p.name, { type: 'media', kind: 'video', state: 'start', id, prompt: input.prompt });
    (async () => {
      const { op } = await media.startVideo(input);
      for (let i = 0; i < 120; i++) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        const clip = await media.videoStatus(op);
        if (!clip) continue;
        await writeFile(join(p.dir, name), clip.bytes);
        return broadcast(p.name, { type: 'media', kind: 'video', state: 'done', id, src: name });
      }
      throw new Error('the clip took more than 10 minutes');
    })().catch((error) => broadcast(p.name, { type: 'media', kind: 'video', state: 'error', id, error: error.message }));
    return { id, src: name };
  }

  async function api(p, req, res, path) {
    const { dir } = p;
    if (req.method === 'GET' && path === 'api/state')
      return json(res, 200, {
        project: p.name,
        site: await readSite(dir),
        building: Object.fromEntries(p.building),
        design: await readFile(join(dir, 'tokens.css'), 'utf8').then(Boolean, () => false),
        spec: await readSpec(dir),
        missing: missingAll(await readSpec(dir)),
        tunnel: state.tunnelUrl,
        media: Boolean(config.mediaUrl),
        live: Boolean(config.geminiKey),
      });
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
    const input = await body(req);
    if (path === 'api/live-token') {
      const hasDesign = await readFile(join(dir, 'tokens.css'), 'utf8').then(Boolean, () => false);
      const note = projectNote(await readSite(dir), await builtSections(dir), hasDesign, await readSpec(dir));
      const setup = liveSetup({
        instruction: `${await persona()}\n\n## Right now\n\n${note}`,
        voice: input.voice || config.voice,
        tools: TOOLS,
      });
      return json(res, 200, await mintLiveToken({ key: config.geminiKey, model: config.liveModel, setup }, fetcher));
    }
    if (path === 'api/spec') {
      const field = String(input.field ?? '');
      if (!isField(field)) return json(res, 400, { error: `unknown field ${field}` });
      const spec = await readSpec(dir);
      const answer = String(input.answer ?? '').trim();
      if (answer) spec[field] = answer.slice(0, 400);
      else delete spec[field];
      await writeSpec(dir, spec);
      broadcast(p.name, { type: 'spec', spec, missing: missingAll(spec) });
      return json(res, 200, { spec, missing: missingAll(spec) });
    }
    if (path === 'api/build') {
      const key = String(input.key ?? '');
      const brief = String(input.brief ?? input.prompt ?? '');
      const spec = await readSpec(dir);
      const refused = refuseBuild({ key, brief, spec });
      if (refused) return json(res, 400, { error: refused });
      if (p.building.has(key)) return json(res, 409, { error: `${key} is already building`, id: p.building.get(key) });
      return json(res, 202, { id: startBuild(p, key, internPrompt({ key, brief, spec })) });
    }
    if (path === 'api/image') {
      if (!input.prompt) return json(res, 400, { error: 'prompt is required' });
      const image = await media.image(String(input.prompt), input.aspect);
      const src = `img/${mediaName(String(input.prompt), input.aspect ?? '')}.${EXT[image.mimeType] ?? 'png'}`;
      await writeFile(join(dir, src), image.bytes);
      return json(res, 200, { src, model: image.model, ms: image.ms });
    }
    if (path === 'api/video') {
      if (!input.prompt) return json(res, 400, { error: 'prompt is required' });
      const video = { prompt: String(input.prompt), aspect: input.aspect, seconds: input.seconds };
      if (input.image) {
        const file = projectPath(dir, String(input.image));
        if (!file) return json(res, 400, { error: 'image must be a file in the project' });
        video.image = (await readFile(file)).toString('base64');
        video.imageType = String(input.image).endsWith('.jpg') ? 'image/jpeg' : 'image/png';
      }
      return json(res, 202, startVideo(p, video));
    }
    return json(res, 404, { error: 'not found' });
  }

  /** Everything under /p/<name>/: the stage, the check page, the site, the api. */
  async function project(req, res, name, rest) {
    if (!PROJECT_NAME.test(name)) return json(res, 404, { error: 'no such site' });
    const p = await open(name);
    if (rest === '' || rest === 'index.html') return page(res, 'index.html');
    if (rest === 'check.html') return page(res, 'check.html');
    if (rest.startsWith('api/')) return api(p, req, res, rest);
    if (rest === 'site') {
      res.writeHead(302, { location: `/p/${name}/site/` });
      return res.end();
    }
    if (rest === 'site/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(await assemble(p.dir));
    }
    if (rest.startsWith('site/')) {
      const file = await serveFile(p.dir, rest.slice('site/'.length));
      // Before the design step there is no tokens.css; an empty sheet beats a 404 in the console.
      if (!file && rest.startsWith('site/tokens.css')) {
        res.writeHead(200, { 'content-type': 'text/css', 'cache-control': 'no-store' });
        return res.end('');
      }
      if (!file) return json(res, 404, { error: 'not found' });
      res.writeHead(200, { 'content-type': file.type, 'cache-control': 'no-store' });
      return res.end(file.body);
    }
    return json(res, 404, { error: 'not found' });
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://local');
    const path = url.pathname;
    if (path === '/health') return json(res, 200, { ok: true });
    const key = url.searchParams.get('key');
    if (key !== null) {
      if (!keyMatches(key, config.token)) {
        res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' });
        return res.end(`Wrong key. Open ${config.pagesUrl || 'the Pages address'}/?forget to type it again.`);
      }
      res.writeHead(302, { 'set-cookie': loginCookie(req, config.token), location: path });
      return res.end();
    }
    if (!allowed(req, config.token)) {
      res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('SLOP does not know you. Open this address with ?key=<your SLOP_TOKEN>.');
    }
    if (path === '/') return page(res, 'home.html');
    if (path === '/api/projects') {
      if (req.method === 'GET') return json(res, 200, { projects: await listProjects(), tunnel: state.tunnelUrl });
      const name = String((await body(req)).name ?? '').trim().toLowerCase();
      if (!PROJECT_NAME.test(name)) return json(res, 400, { error: 'a name is lowercase letters, digits and hyphens' });
      await open(name);
      return json(res, 201, { name });
    }
    const scoped = /^\/p\/([^/]+)\/?(.*)$/.exec(path);
    if (scoped) {
      if (!path.startsWith(`/p/${scoped[1]}/`)) {
        res.writeHead(302, { location: `/p/${scoped[1]}/` });
        return res.end();
      }
      return project(req, res, scoped[1], scoped[2]);
    }
    // Shared static assets: the eye, the voice, the stage script.
    if (/^\/[a-z-]+\.(js|css)$/.test(path)) return page(res, path.slice(1));
    return json(res, 404, { error: 'not found' });
  }

  const server = createServer((req, res) =>
    handle(req, res).catch((error) => {
      console.error(error.message);
      if (!res.headersSent) json(res, 502, { error: error.message });
      else res.end();
    }),
  );
  wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const m = /^\/p\/([a-z0-9-]+)\/ws$/.exec(new URL(req.url, 'http://local').pathname);
    if (!m || !allowed(req, config.token)) return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.project = m[1];
      wss.emit('connection', ws, req);
    });
  });

  // Keep sockets alive through proxies that drop idle connections (the tunnel does).
  const heartbeat = setInterval(() => {
    for (const client of wss?.clients ?? []) if (client.readyState === 1) client.ping();
  }, 25_000);
  heartbeat.unref?.();
  const close = () => {
    clearInterval(heartbeat);
    for (const p of projects.values()) {
      p.watcher.close();
      clearInterval(p.poll);
    }
    wss.close();
    server.close();
  };
  return { server, broadcast: (event) => broadcast(null, event), state, close };
}
