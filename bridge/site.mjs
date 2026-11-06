// The website being built, one folder per project:
//   tokens.css         the design system every section uses (the "design" step)
//   site.json          { "title", "sections": ["hero", ...], "plan": { "hero": "one line" } }
//                      (the "structure" step: order and a one-line plan per section)
//   sections/<id>.html one file per section, so sections build and change independently
//   scripts.js         the scroll choreography that joins sections (GSAP)
//   img/, video/       generated media
// /site/ assembles them into one page. With a design but no structure, the page is a style
// tile read from tokens.css. A section listed but not written yet shows as a labelled grey
// box with its plan line, which is the wireframe stage for free.
import { watch } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

export const SECTION_ID = /^[a-z][a-z0-9-]{0,39}$/;
/** Build keys that are steps, not sections. */
export const STEPS = new Set(['design', 'structure', 'scripts', 'site']);

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
    const plan = site.plan && typeof site.plan === 'object' ? site.plan : {};
    return {
      title: String(site.title ?? 'Untitled'),
      sections: (Array.isArray(site.sections) ? site.sections : []).filter(
        (id) => SECTION_ID.test(id) && !STEPS.has(id),
      ),
      plan: Object.fromEntries(Object.entries(plan).map(([k, v]) => [k, String(v)])),
    };
  } catch {
    return { title: 'Untitled', sections: [], plan: {} };
  }
}

const read = (path) => readFile(path, 'utf8').catch(() => '');
const escape = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

const WIREFRAME = (id, plan) =>
  `<div class="slop-wire"><span>${escape(id.toUpperCase())}</span>${
    plan ? `<small>${escape(plan)}</small>` : ''
  }</div>`;

/** The custom properties declared in tokens.css, in order. */
export function tokensOf(css) {
  const out = [];
  for (const m of css.matchAll(/--([a-zA-Z0-9_-]+)\s*:\s*([^;}]+)/g))
    if (!out.some((t) => t.name === m[1])) out.push({ name: m[1], value: m[2].trim() });
  return out;
}

const isColor = (v) => /^(#[0-9a-f]{3,8}|(rgb|hsl|oklch|oklab|lab|lch|color)\(|(white|black|ivory|cream)$)/i.test(v);
const isFont = (name, v) => /font|face|family/i.test(name) && /[a-z]/i.test(v) && !/^\d/.test(v);

/** A style tile: colours, typefaces and a headline, so the design can be judged before any section. */
export function styleTile(css, title) {
  const tokens = tokensOf(css);
  const colors = tokens.filter((t) => isColor(t.value));
  const fonts = tokens.filter((t) => isFont(t.name, t.value) && !/size|weight|scale|line|leading|tracking/i.test(t.name));
  const display = fonts.find((t) => /display|head|title|hero/i.test(t.name)) ?? fonts[0];
  const body = fonts.find((t) => /body|text|copy|sans/i.test(t.name) && t !== display) ?? fonts[1] ?? display;
  const bg = colors.find((t) => /bg|background|paper|surface|canvas/i.test(t.name));
  const ink = colors.find((t) => /ink|text|fg|foreground/i.test(t.name));
  const accent = colors.find((t) => /accent|primary|brand|signal/i.test(t.name));
  const v = (t) => (t ? `var(--${t.name})` : 'inherit');
  return `<section id="design" class="slop-tile" style="background:${bg ? v(bg) : '#111'};color:${ink ? v(ink) : '#eee'}">
<div class="slop-tile-head" style="font-family:${v(display)}">${escape(title)}</div>
<div class="slop-tile-sub" style="font-family:${v(body)}">The quick brown fox jumps over the lazy dog. 0123456789</div>
<div class="slop-tile-row">${colors
    .map((t) => `<div class="slop-swatch"><i style="background:var(--${t.name})"></i><b>${escape(t.name)}</b><small>${escape(t.value)}</small></div>`)
    .join('')}</div>
<div class="slop-tile-row">${fonts
    .map((t) => `<div class="slop-font" style="font-family:var(--${t.name})"><span>Aa</span><b>${escape(t.name)}</b><small>${escape(t.value)}</small></div>`)
    .join('')}</div>
${accent ? `<div class="slop-tile-row"><span class="slop-btn" style="background:${v(accent)};color:${bg ? v(bg) : '#000'};font-family:${v(body)}">A button</span></div>` : ''}
</section>`;
}

const BASE_CSS = `
.slop-wire{min-height:60vh;display:grid;place-content:center;gap:10px;margin:12px;border:1px dashed #555;text-align:center;
background:repeating-linear-gradient(45deg,#1a1a1a 0 12px,#151515 12px 24px);color:#777;
font:600 14px/1 ui-monospace,monospace;letter-spacing:.3em;padding:24px}
.slop-wire small{display:block;letter-spacing:.02em;font-weight:400;font-size:13px;color:#8a8a8a;max-width:46ch;line-height:1.5}
.slop-tile{min-height:100vh;padding:8vh 7vw;display:flex;flex-direction:column;gap:5vh;justify-content:center}
.slop-tile-head{font-size:clamp(48px,11vw,180px);line-height:.95;letter-spacing:-.02em;font-weight:700}
.slop-tile-sub{font-size:clamp(16px,1.6vw,22px);opacity:.75;max-width:60ch}
.slop-tile-row{display:flex;flex-wrap:wrap;gap:18px;align-items:flex-end}
.slop-swatch{display:grid;gap:6px;font:12px/1.3 ui-monospace,monospace}.slop-swatch i{display:block;width:88px;height:88px;border-radius:6px;box-shadow:inset 0 0 0 1px rgba(128,128,128,.25)}
.slop-swatch b{font-weight:600}.slop-swatch small,.slop-font small{opacity:.55;font-size:11px;max-width:22ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.slop-font{display:grid;gap:4px}.slop-font span{font-size:72px;line-height:1}.slop-font b{font:600 12px/1.3 ui-monospace,monospace}
.slop-btn{display:inline-block;padding:14px 28px;border-radius:4px;font-weight:600}
img[data-gen]{transition:opacity 1.2s ease}
img[data-gen].slop-pending{background:linear-gradient(100deg,#141414 40%,#262626 50%,#141414 60%) 0 0/300% 100%;
animation:slop-shimmer 1.4s linear infinite;min-height:120px}
img[data-gen].slop-landing{opacity:0}
@keyframes slop-shimmer{to{background-position:-150% 0}}
[data-slop-section]{transition:opacity .9s ease,filter .9s ease}
[data-slop-section].slop-developing{opacity:0;filter:blur(14px) saturate(0)}
`;

// A pending picture gets a transparent pixel for src, so the browser never draws the broken-image
// icon and the shimmer shows through.
const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const placeholders = (html) =>
  html.replace(/<img\b[^>]*\bdata-gen=[^>]*>/gi, (tag) => {
    const src = /\bsrc="([^"]*)"/i.exec(tag)?.[1] ?? '';
    if (src.trim()) return tag;
    const withSrc = /\bsrc="[^"]*"/i.test(tag) ? tag.replace(/\bsrc="[^"]*"/i, `src="${PIXEL}"`) : tag.replace(/<img\b/i, `<img src="${PIXEL}"`);
    return withSrc.replace(/<img\b/i, '<img class="slop-pending"').replace(/class="slop-pending"([^>]*)\bclass="([^"]*)"/i, 'class="slop-pending $2"$1');
  });

// Keeps the preview live without flicker:
//   - a changed section is fetched and swapped in place; if only pictures changed, just the
//     pictures fade in; a real change gets a short "develop" reveal
//   - tokens.css is hot-swapped as a stylesheet; only scripts.js needs a full reload
//   - the page tells its parent (the stage) which section is on screen, when one lands, and
//     before it reloads, so the stage can fade instead of flash
const LIVE = `<script>(()=>{
const k='slop-scroll';const y=sessionStorage.getItem(k);if(y)addEventListener('load',()=>scrollTo(0,+y));
const tell=(m)=>parent!==window&&parent.postMessage({slop:true,...m},'*');
let full;const reload=()=>{clearTimeout(full);full=setTimeout(()=>{sessionStorage.setItem(k,scrollY);tell({type:'reloading'});setTimeout(()=>location.reload(),350)},200)};
const timers=new Map();
const norm=(el)=>el.innerHTML.replace(/\\s+class="[^"]*slop-(pending|landing)[^"]*"/g,'').replace(/\\bsrc="[^"]*"/g,'src=""');
function land(img,src){img.classList.add('slop-landing');const probe=new Image();probe.onload=()=>{img.src=src;img.classList.remove('slop-pending');requestAnimationFrame(()=>img.classList.remove('slop-landing'));};probe.src=src;}
async function swap(id){
  const html=await (await fetch('/site/',{cache:'no-store'})).text();
  const doc=new DOMParser().parseFromString(html,'text/html');
  const fresh=doc.querySelector('[data-slop-section="'+id+'"]');
  const here=document.querySelector('[data-slop-section="'+id+'"]');
  if(!fresh||!here)return reload();
  if(norm(fresh)===norm(here)){
    const a=here.querySelectorAll('img[data-gen]'),b=fresh.querySelectorAll('img[data-gen]');
    a.forEach((img,i)=>{const src=b[i]&&b[i].getAttribute('src');if(src&&!src.startsWith('data:')&&img.getAttribute('src')!==src)land(img,src);});
    return;
  }
  const wasWire=Boolean(here.querySelector('.slop-wire'));
  here.classList.add('slop-developing');
  await new Promise(r=>setTimeout(r,920));
  here.innerHTML=fresh.innerHTML;
  for(const old of here.querySelectorAll('script')){const s=document.createElement('script');for(const at of old.attributes)s.setAttribute(at.name,at.value);s.textContent=old.textContent;old.replaceWith(s);}
  requestAnimationFrame(()=>requestAnimationFrame(()=>here.classList.remove('slop-developing')));
  if(window.ScrollTrigger)ScrollTrigger.refresh();
  if(wasWire)here.scrollIntoView({behavior:'smooth',block:'start'});
  tell({type:'landed',id});
}
function restyle(){
  const old=document.querySelector('link[data-slop-tokens]');const l=document.createElement('link');l.rel='stylesheet';l.dataset.slopTokens='1';
  l.href='tokens.css?v='+Date.now();l.onload=()=>{old&&old.remove();if(document.querySelector('[data-slop-section="design"]'))swap('design');};document.head.append(l);
}
const ws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws');
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.type!=='file')return;
  const sec=/^sections\\/([a-z0-9-]+)\\.html$/.exec(m.path);
  const later=(key,fn,ms)=>{clearTimeout(timers.get(key));timers.set(key,setTimeout(fn,ms));};
  if(sec)return later(sec[1],()=>swap(sec[1]),150);
  if(m.path==='tokens.css')return later('tokens',document.querySelector('[data-slop-section]')?restyle:reload,150);
  if(m.path==='site.json')return later('site',()=>document.querySelector('[data-slop-section]')?reload():reload(),150);
  if(m.path==='scripts.js')return later('scripts',reload,150);
};
addEventListener('message',e=>{const m=e.data;if(!m||!m.slop)return;
  if(m.type==='scrollTo'){const el=document.querySelector('[data-slop-section="'+m.id+'"]');el&&el.scrollIntoView({behavior:'smooth',block:'start'});}});
const seen=new IntersectionObserver(es=>{for(const x of es)if(x.isIntersecting)tell({type:'visible',id:x.target.dataset.slopSection});},{threshold:.5});
addEventListener('load',()=>{document.querySelectorAll('[data-slop-section]').forEach(el=>seen.observe(el));tell({type:'ready'});});
})();</script>`;

/** The whole page: tokens, the style tile or each section (or its wireframe), the choreography, live reload. */
export async function assemble(dir, { live = true } = {}) {
  const site = await readSite(dir);
  const tokens = await read(join(dir, 'tokens.css'));
  const sections = await Promise.all(
    site.sections.map(async (id) => {
      const html = await read(join(dir, 'sections', `${id}.html`));
      return `<div data-slop-section="${id}">\n${placeholders(html.trim()) || WIREFRAME(id, site.plan[id])}\n</div>`;
    }),
  );
  const body = sections.length
    ? sections.join('\n')
    : tokens
      ? `<div data-slop-section="design">\n${styleTile(tokens, site.title)}\n</div>`
      : WIREFRAME('nothing yet');
  const hasScripts = Boolean(await read(join(dir, 'scripts.js')));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(site.title)}</title>
<link rel="icon" href="data:,">
<style>${BASE_CSS}</style>
<link rel="stylesheet" href="tokens.css" data-slop-tokens>
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js"></script>
</head>
<body>
${body}
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
  const path = projectPath(dir, relative.split('?')[0]);
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
