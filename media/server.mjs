// slop-media: a Cloud Run SERVICE (not a scheduled job) so a picture starts the moment the
// bridge asks (docs/setup.md, part 1). Node built-ins only. Every route but /health needs
// `Authorization: Bearer $SLOP_TOKEN`; Google access comes from the service account.
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { accessToken } from './google.mjs';
import { generateImage, startVideo, videoStatus } from './vertex.mjs';

export function mediaConfig(env = process.env) {
  const list = (value, fallback) =>
    (value || fallback)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  return {
    token: env.SLOP_TOKEN || '',
    project: env.GCP_PROJECT_ID || '',
    imageRegion: env.IMAGE_REGION || 'global',
    // The first one the project has wins; set IMAGE_MODELS at deploy to pin the exact IDs.
    imageModels: list(
      env.IMAGE_MODELS,
      'gemini-3.1-flash-lite-image,gemini-3.1-flash-image,gemini-2.5-flash-image',
    ),
    videoRegion: env.VIDEO_REGION || 'us-central1',
    videoModel: env.VIDEO_MODEL || 'veo-3.1-fast-generate-001',
  };
}

export function authorized(header, token) {
  if (!token) return false;
  const given = Buffer.from(String(header ?? '').replace(/^Bearer\s+/i, ''));
  const want = Buffer.from(token);
  return given.length === want.length && timingSafeEqual(given, want);
}

const MAX_BODY = 15 * 1024 * 1024;

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('body too large'), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw Object.assign(new Error('body is not JSON'), { status: 400 });
  }
}

const json = (res, status, value) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
};

/** The request handler, separate from listen() so tests can drive it with a fake Vertex. */
export function mediaHandler(config, { fetcher = fetch, token = () => accessToken() } = {}) {
  return async (req, res) => {
    const url = new URL(req.url, 'http://local');
    try {
      if (url.pathname === '/health') return json(res, 200, { ok: true });
      if (!authorized(req.headers.authorization, config.token))
        return json(res, 401, { error: 'unauthorized' });
      if (!config.project) return json(res, 503, { error: 'GCP_PROJECT_ID is not set' });

      if (req.method === 'POST' && url.pathname === '/image') {
        const body = await readJson(req);
        if (!body.prompt) return json(res, 400, { error: 'prompt is required' });
        const started = Date.now();
        const image = await generateImage(
          {
            prompt: String(body.prompt),
            aspect: body.aspect,
            project: config.project,
            region: config.imageRegion,
            models: config.imageModels,
          },
          { token: await token(), fetcher },
        );
        res.writeHead(200, {
          'content-type': image.mimeType,
          'x-model': image.model,
          'x-ms': String(Date.now() - started),
        });
        return res.end(image.bytes);
      }

      const video = {
        project: config.project,
        region: config.videoRegion,
        model: config.videoModel,
      };
      if (req.method === 'POST' && url.pathname === '/video') {
        const body = await readJson(req);
        if (!body.prompt) return json(res, 400, { error: 'prompt is required' });
        const started = await startVideo(
          { ...video, ...body, prompt: String(body.prompt) },
          { token: await token(), fetcher },
        );
        return json(res, 202, started);
      }
      if (req.method === 'GET' && url.pathname === '/video') {
        const op = url.searchParams.get('op');
        if (!op) return json(res, 400, { error: 'op is required' });
        const status = await videoStatus({ ...video, op }, { token: await token(), fetcher });
        if (!status.done) return json(res, 202, { done: false });
        res.writeHead(200, { 'content-type': status.mimeType });
        return res.end(status.bytes);
      }
      return json(res, 404, { error: 'not found' });
    } catch (error) {
      console.error(error.message);
      return json(res, error.status ?? 502, { error: error.message });
    }
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = mediaConfig();
  if (!config.token) console.warn('SLOP_TOKEN is not set: every request will be refused');
  const port = Number(process.env.PORT) || 8080;
  createServer(mediaHandler(config)).listen(port, () =>
    console.log(
      `slop-media on :${port}, images ${config.imageModels.join(' > ')}, video ${config.videoModel}`,
    ),
  );
}
