// The website being built, one folder per project:
//   site.json          { "title": "...", "sections": ["hero", "features", ...] }  (order)
//   tokens.css         the design system every section uses
//   sections/<id>.html one file per section, so sections build and change independently
//   scripts.js         the scroll choreography that joins sections (GSAP)
//   img/, video/       generated media
// /site/ assembles them into one page. A section listed but not written yet shows as a
// labelled grey box, which is the wireframe stage for free.
import { watch } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

export const SECTION_ID = /^[a-z][a-z0-9-]{0,39}$/;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.woff2': 'font/woff2',
};

export async function ensureProject(dir) {
  await mkdir(join(dir, 'sections'), { recursive: true });
  await mkdir(join(dir, 'img'), { recursive: true });
  await mkdir(join(dir, 'video'), { recursive: true });
  try {
    await stat(join(dir, 'site.json'));
  } catch {
    await writeFile(join(dir, 'site.json'), '{ "title": "Untitled", "sections": [] }\n');
  }
}

export async function readSite(dir) {
  try {
    const site = JSON.parse(await readFile(join(dir, 'site.json'), 'utf8'));
    return {
      title: String(site.title ?? 'Untitled'),
      sections: (Array.isArray(site.sections) ? site.sections : []).filter((id) =>
        SECTION_ID.test(id),
      ),
    };
  } catch {
    return { title: 'Untitled', sections: [] };
  }
}

const read = (path) => readFile(path, 'utf8').catch(() => '');
const escape = (s) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

const WIREFRAME = (id) =>
  `<div class="slop-wire"><span>${escape(id.toUpperCase())}</span></div>`;

// Reloads the preview when a file changes, keeping the scroll position.
const LIVE = `<script>(()=>{const k='slop-scroll';const y=sessionStorage.getItem(k);
if(y)addEventListener('load',()=>scrollTo(0,+y));let t;
const ws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws');
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.type!=='file')return;clearTimeout(t);
t=setTimeout(()=>{sessionStorage.setItem(k,scrollY);location.reload()},150)};})();</script>`;

/** The whole page: tokens, each section (or its wireframe), the choreography, live reload. */
export async function assemble(dir, { live = true } = {}) {
  const site = await readSite(dir);
  const sections = await Promise.all(
    site.sections.map(async (id) => {
      const html = await read(join(dir, 'sections', `${id}.html`));
      return `<div data-slop-section="${id}">\n${html.trim() || WIREFRAME(id)}\n</div>`;
    }),
  );
  const hasScripts = Boolean(await read(join(dir, 'scripts.js')));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(site.title)}</title>
<style>.slop-wire{min-height:60vh;display:grid;place-items:center;margin:12px;border:1px dashed #555;
background:repeating-linear-gradient(45deg,#1a1a1a 0 12px,#151515 12px 24px);color:#777;
font:600 14px/1 ui-monospace,monospace;letter-spacing:.3em}
img[data-gen][src=""],img[data-gen]:not([src]){color:transparent;background:linear-gradient(100deg,#141414 40%,#262626 50%,#141414 60%)
0 0/300% 100%;animation:slop-shimmer 1.4s linear infinite;min-height:120px}
@keyframes slop-shimmer{to{background-position:-150% 0}}</style>
<link rel="stylesheet" href="tokens.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js"></script>
</head>
<body>
${sections.join('\n') || WIREFRAME('nothing yet')}
${hasScripts ? '<script src="scripts.js"></script>' : ''}
${live ? LIVE : ''}
</body>
</html>
`;
}

/** A file inside the project, or null for anything outside it or hidden (.slop/, .claude/). */
export function projectPath(dir, relative) {
  const clean = normalize(decodeURIComponent(relative)).replace(/^([/\\])+/, '');
  if (!clean || clean.split(sep).some((part) => part.startsWith('.') || part === '..')) return null;
  const full = join(dir, clean);
  return full.startsWith(dir + sep) ? full : null;
}

export async function serveFile(dir, relative) {
  const path = projectPath(dir, relative);
  if (!path) return null;
  try {
    const body = await readFile(path);
    return { body, type: TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream' };
  } catch {
    return null;
  }
}

/** Calls onChange(relativePath) for every visible file that changes in the project. */
export function watchProject(dir, onChange) {
  return watch(dir, { recursive: true }, (_event, name) => {
    if (!name) return;
    const path = String(name);
    if (path.split(sep).some((part) => part.startsWith('.'))) return;
    onChange(path.split(sep).join('/'));
  });
}
