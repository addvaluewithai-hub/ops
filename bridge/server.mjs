// The bridge's HTTP and WebSocket routes (docs/setup.md, part 2). index.mjs starts it.
//   GET  /?key=...        log in (sets a cookie), then the app
//   GET  /                the stage: the eye, the voice, the site (public/index.html)
//   GET  /check.html      the setup check page
//   GET  /site/...        the website being built, assembled live
//   GET  /api/state       project, sections, what is building, the public address
//   POST /api/live-token  a single-use Gemini Live token with SLOP's persona and tools
//   POST /api/build       { key, brief }: the intern starts now (SLOP's build tool)
//   POST /api/image       { prompt, aspect }: one picture into img/
//   POST /api/video       { prompt, aspect, seconds, image }: one clip into video/
//   WS   /ws              every event: build steps, files, pictures, clips
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { allowed, keyMatches, loginCookie } from './auth.mjs';
import { build } from './claude.mjs';
import { liveSetup, mintLiveToken } from './live.mjs';
import { EXT, fillImages, mediaName } from './media.mjs';
import { assemble, projectPath, readSite, serveFile } from './site.mjs';
import { TOOLS, internPrompt, projectNote, refuseBuild } from './tools.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, 'public');
const STATIC = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const persona = () => readFile(join(HERE, 'persona.md'), 'utf8');

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

export function createBridge({ config, dir, media, fetcher = fetch, spawner }) {
  const building = new Map();
  const state = { tunnelUrl: '' };
  let wss;
  let counter = 0;

  const broadcast = (event) => {
    const text = JSON.stringify(event);
    for (const client of wss?.clients ?? []) if (client.readyState === 1) client.send(text);
  };

  const builtSections = async () =>
    new Set(
      (await readdir(join(dir, 'sections')).catch(() => []))
        .filter((name) => name.endsWith('.html'))
        .map((name) => name.slice(0, -5)),
    );

  async function fillAllImages() {
    const files = await readdir(join(dir, 'sections')).catch(() => []);
    await Promise.all(
      files
        .filter((name) => name.endsWith('.html'))
        .map((name) =>
          fillImages({ dir, file: `sections/${name}`, media }, (e) =>
            broadcast({ type: 'media', ...e }),
          ),
        ),
    );
  }

  function startBuild(key, prompt) {
    const id = `b${++counter}`;
    building.set(key, id);
    broadcast({ type: 'build', id, key, state: 'start' });
    build({ dir, key, prompt, config, ...(spawner ? { spawner } : {}) }, (step) =>
      broadcast({ type: 'build', id, key, state: 'step', ...step }),
    )
      .then((result) => {
        broadcast({ type: 'build', id, key, state: 'done', files: [...result.files], result: result.result });
        return fillAllImages();
      })
      .catch((error) => broadcast({ type: 'build', id, key, state: 'error', error: error.message }))
      .finally(() => building.delete(key));
    return id;
  }

  function startVideo(input) {
    const id = `v${++counter}`;
    const name = `video/${mediaName(input.prompt, input.aspect)}.mp4`;
    broadcast({ type: 'media', kind: 'video', state: 'start', id, prompt: input.prompt });
    (async () => {
      const { op } = await media.startVideo(input);
      for (let i = 0; i < 120; i++) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        const clip = await media.videoStatus(op);
        if (!clip) continue;
        await writeFile(join(dir, name), clip.bytes);
        return broadcast({ type: 'media', kind: 'video', state: 'done', id, src: name });
      }
      throw new Error('the clip took more than 10 minutes');
    })().catch((error) =>
      broadcast({ type: 'media', kind: 'video', state: 'error', id, error: error.message }),
    );
    return { id, src: name };
  }

  async function api(req, res, path) {
    if (req.method === 'GET' && path === '/api/state')
      return json(res, 200, {
        project: config.project,
        site: await readSite(dir),
        building: Object.fromEntries(building),
        design: await readFile(join(dir, 'tokens.css'), 'utf8').then(Boolean, () => false),
        tunnel: state.tunnelUrl,
        media: Boolean(config.mediaUrl),
        live: Boolean(config.geminiKey),
      });
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
    const input = await body(req);
    if (path === '/api/live-token') {
      const hasDesign = await readFile(join(dir, 'tokens.css'), 'utf8').then(Boolean, () => false);
      const note = projectNote(await readSite(dir), await builtSections(), hasDesign);
      const setup = liveSetup({
        instruction: `${await persona()}\n\n## Right now\n\n${note}`,
        voice: input.voice || config.voice,
        tools: TOOLS,
      });
      return json(res, 200, await mintLiveToken({ key: config.geminiKey, model: config.liveModel, setup }, fetcher));
    }
    if (path === '/api/build') {
      const key = String(input.key ?? '');
      const brief = String(input.brief ?? input.prompt ?? '');
      const refused = refuseBuild({ key, brief });
      if (refused) return json(res, 400, { error: refused });
      if (building.has(key)) return json(res, 409, { error: `${key} is already building`, id: building.get(key) });
      return json(res, 202, { id: startBuild(key, internPrompt({ key, brief })) });
    }
    if (path === '/api/image') {
      if (!input.prompt) return json(res, 400, { error: 'prompt is required' });
      const image = await media.image(String(input.prompt), input.aspect);
      const src = `img/${mediaName(String(input.prompt), input.aspect ?? '')}.${EXT[image.mimeType] ?? 'png'}`;
      await writeFile(join(dir, src), image.bytes);
      return json(res, 200, { src, model: image.model, ms: image.ms });
    }
    if (path === '/api/video') {
      if (!input.prompt) return json(res, 400, { error: 'prompt is required' });
      const video = { prompt: String(input.prompt), aspect: input.aspect, seconds: input.seconds };
      if (input.image) {
        const file = projectPath(dir, String(input.image));
        if (!file) return json(res, 400, { error: 'image must be a file in the project' });
        video.image = (await readFile(file)).toString('base64');
        video.imageType = String(input.image).endsWith('.jpg') ? 'image/jpeg' : 'image/png';
      }
      return json(res, 202, startVideo(video));
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
    if (path.startsWith('/api/')) return api(req, res, path);
    const asset = path === '/' ? 'index.html' : /^\/[a-z-]+\.(html|js|css)$/.test(path) ? path.slice(1) : '';
    if (asset) {
      const file = await readFile(join(PUBLIC, asset)).catch(() => null);
      if (!file) return json(res, 404, { error: 'not found' });
      res.writeHead(200, { 'content-type': STATIC[asset.slice(asset.lastIndexOf('.'))], 'cache-control': 'no-store' });
      return res.end(file);
    }
    if (path === '/site') {
      res.writeHead(302, { location: '/site/' });
      return res.end();
    }
    if (path === '/site/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(await assemble(dir));
    }
    if (path.startsWith('/site/')) {
      const file = await serveFile(dir, path.slice('/site/'.length));
      // Before the design step there is no tokens.css; an empty sheet beats a 404 in the console.
      if (!file && path.startsWith('/site/tokens.css')) {
        res.writeHead(200, { 'content-type': 'text/css', 'cache-control': 'no-store' });
        return res.end('');
      }
      if (!file) return json(res, 404, { error: 'not found' });
      res.writeHead(200, { 'content-type': file.type, 'cache-control': 'no-store' });
      return res.end(file.body);
    }
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
    if (new URL(req.url, 'http://local').pathname !== '/ws' || !allowed(req, config.token))
      return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  return { server, broadcast, state };
}
