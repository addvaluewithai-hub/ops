// The bridge's side of slop-media (Cloud Run): pictures for <img data-gen="..."> and clips.
// Generated files land in the project's img/ and video/ folders, where the preview sees them.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'video/mp4': 'mp4' };

export function mediaClient(config, fetcher = fetch) {
  const call = async (path, init = {}) => {
    if (!config.mediaUrl) throw new Error('MEDIA_URL is not set');
    const response = await fetcher(`${config.mediaUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${config.token}`,
        'content-type': 'application/json',
        ...init.headers,
      },
    });
    if (response.status >= 400) {
      const text = await response.text();
      let message = text;
      try {
        message = JSON.parse(text).error ?? text;
      } catch {
        // plain text
      }
      throw new Error(`media ${response.status}: ${String(message).slice(0, 300)}`);
    }
    return response;
  };
  return {
    /** { bytes, mimeType, model, ms } */
    async image(prompt, aspect) {
      const started = Date.now();
      const response = await call('/image', {
        method: 'POST',
        body: JSON.stringify({ prompt, aspect }),
      });
      const mimeType = response.headers.get('content-type') ?? 'image/png';
      return {
        bytes: Buffer.from(await response.arrayBuffer()),
        mimeType,
        model: response.headers.get('x-model') ?? '',
        ms: Date.now() - started,
      };
    },
    async startVideo(body) {
      const response = await call('/video', { method: 'POST', body: JSON.stringify(body) });
      return response.json();
    },
    /** null while Veo is still working, else { bytes, mimeType }. */
    async videoStatus(op) {
      const response = await call(`/video?op=${encodeURIComponent(op)}`);
      if (response.status === 202) return null;
      return {
        bytes: Buffer.from(await response.arrayBuffer()),
        mimeType: response.headers.get('content-type') ?? 'video/mp4',
      };
    },
  };
}

/** A stable file name for a prompt, so the same prompt is never paid for twice. */
export const mediaName = (prompt, aspect = '') =>
  createHash('sha256').update(`${aspect}|${prompt}`).digest('hex').slice(0, 16);

/** Every <img data-gen="..."> in the HTML whose src is still empty. */
export function pendingImages(html) {
  const found = [];
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const prompt = /\bdata-gen="([^"]+)"/i.exec(tag)?.[1];
    if (!prompt) continue;
    const src = /\bsrc="([^"]*)"/i.exec(tag)?.[1] ?? '';
    if (src.trim()) continue;
    const aspect = /\bdata-aspect="([^"]+)"/i.exec(tag)?.[1] ?? '16:9';
    found.push({ tag, prompt: unescapeHtml(prompt), aspect });
  }
  return found;
}

const unescapeHtml = (s) =>
  s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** The tag with its src filled in (added if it had none). */
export function withSrc(tag, src) {
  return /\bsrc="[^"]*"/i.test(tag)
    ? tag.replace(/\bsrc="[^"]*"/i, `src="${src}"`)
    : tag.replace(/<img\b/i, `<img src="${src}"`);
}

/**
 * Generates every pending picture in one file, all at once, and writes each src in as soon as
 * its picture lands, so the preview fills in one image at a time. Reports through onEvent.
 */
export async function fillImages({ dir, file, media }, onEvent) {
  const path = join(dir, file);
  const pending = pendingImages(await readFile(path, 'utf8'));
  // Pictures land in any order; their edits to the file go one after another.
  let writing = Promise.resolve();
  const fill = (tag, name) =>
    (writing = writing.then(async () => {
      const html = await readFile(path, 'utf8');
      await writeFile(path, html.replace(tag, withSrc(tag, name)));
    }));
  await Promise.all(
    pending.map(async ({ tag, prompt, aspect }) => {
      try {
        onEvent({ kind: 'image', state: 'start', file, prompt });
        const image = await media.image(prompt, aspect);
        const name = `img/${mediaName(prompt, aspect)}.${EXT[image.mimeType] ?? 'png'}`;
        await writeFile(join(dir, name), image.bytes);
        await fill(tag, name);
        onEvent({ kind: 'image', state: 'done', file, prompt, src: name, ms: image.ms, model: image.model });
      } catch (error) {
        onEvent({ kind: 'image', state: 'error', file, prompt, error: error.message });
      }
    }),
  );
  return pending.length;
}

export { EXT };
