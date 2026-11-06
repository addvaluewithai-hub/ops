// The stage: wires the eye, the voice and the bridge together.
//   - Gemini tool calls drive the face, the gaze and the builds.
//   - Bridge events (intern steps, pictures landing) become short notes to SLOP, so he can
//     react to what the intern is doing without ever being asked to wait.
//   - The site slides in on the first build and stays; SLOP's gaze decides how much of it shows.
import { createEye, MOODS } from '/eye.js';
import { createLive } from '/live.js';

const $ = (id) => document.getElementById(id);
const body = document.body;
const eye = createEye(document.querySelector('#eye canvas'));
eye.mood('angry', 0.7);
eye.lookAt(0, 0);

let captions = true;
let building = new Set();
let building_id = new Map();

const ops = (id, text, cls = '') => {
  const el = $(id);
  el.textContent = text;
  el.className = cls;
};

// ---- captions ---------------------------------------------------------------------------
let saidBuffer = '';
let saidTimer;
function said(text, done) {
  if (!captions) return;
  if (text) {
    saidBuffer += text;
    $('said').textContent = saidBuffer.slice(-180);
  }
  clearTimeout(saidTimer);
  if (done)
    saidTimer = setTimeout(() => {
      saidBuffer = '';
      $('said').textContent = '';
    }, 2800);
}
let heardTimer;
function heard(text) {
  if (!captions) return;
  $('heard').textContent = (($('heard').textContent + ' ' + text).trim()).slice(-120);
  clearTimeout(heardTimer);
  heardTimer = setTimeout(() => ($('heard').textContent = ''), 4000);
}

// ---- the face ---------------------------------------------------------------------------
function setMood(mood, intensity = 0.8) {
  if (!MOODS[mood]) return false;
  eye.mood(mood, intensity);
  body.classList.toggle('furious', mood === 'furious');
  ops('o-mood', `${mood} ${Math.round(intensity * 10) / 10}`);
  return true;
}

function lookAt(target) {
  const site = $('site');
  if (target === 'user') {
    body.classList.remove('at-site');
    eye.lookAt(0, 0);
    return true;
  }
  body.classList.add('at-site');
  // The site is to his lower-left when he is tucked in the corner.
  eye.lookAt(-0.8, -0.45);
  if (target !== 'site') site.contentWindow?.postMessage({ slop: true, type: 'scrollTo', id: target }, '*');
  return true;
}

function showSite(visible) {
  body.classList.toggle('showing', visible);
  if (!visible) lookAt('user');
}

// ---- the voice --------------------------------------------------------------------------
const live = createLive({
  onSaid: said,
  onHeard: heard,
  onLevel: (level) => eye.speak(level),
  onInterrupted: () => {
    saidBuffer = '';
    $('said').textContent = '';
    eye.blink();
  },
  onState: (s, detail) => {
    ops('o-live', s + (detail ? ` ${detail}` : ''), s === 'live' ? 'ok' : s === 'error' || s === 'closed' ? 'bad' : '');
    if (s === 'closed' || s === 'goaway') setTimeout(() => live.open || live.connect().catch(() => {}), s === 'goaway' ? 100 : 2500);
  },
  onTool: async (name, args) => {
    if (name === 'set_mood') return setMood(String(args.mood), Number(args.intensity ?? 0.8)) ? { ok: true, scheduling: 'SILENT' } : { error: `unknown mood; use one of ${Object.keys(MOODS).join(', ')}` };
    if (name === 'look_at') return { ok: lookAt(String(args.target ?? 'user')), scheduling: 'SILENT' };
    if (name === 'show_site') {
      showSite(Boolean(args.visible));
      return { ok: true, scheduling: 'SILENT' };
    }
    if (name === 'build') {
      const r = await fetch('/api/build', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: args.key, brief: args.brief }),
      });
      const data = await r.json();
      if (!r.ok) return { refused: data.error, scheduling: 'INTERRUPT' };
      showSite(true);
      return { started: true, key: args.key, note: 'The intern has started. Keep talking; you will be told when it is done.', scheduling: 'WHEN_IDLE' };
    }
    return { error: `unknown tool ${name}` };
  },
});

// ---- bridge events -----------------------------------------------------------------------
function internLine(text) {
  $('intern').querySelector('i').textContent = text;
}
function updateBuilding() {
  body.classList.toggle('building', building.size > 0);
  ops('o-building', [...building].join(', ') || '–');
}

function connectBridge() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === 'build') {
      if (m.state === 'start') {
        building.add(m.key);
        building_id.set(m.key, m.id);
        internLine('starting');
      } else if (m.state === 'step') {
        if (m.kind === 'tool') internLine(m.text);
        // Only file writes are worth a word; reads are noise.
        if (m.kind === 'tool' && /^(writing|editing)/.test(m.text)) live.note(`[INTERN ${m.key}] ${m.text}`);
      } else if (m.state === 'done') {
        building.delete(m.key);
        internLine('done');
        live.say(`[INTERN DONE ${m.key}] Files: ${m.files.join(', ')}. The intern says: ${m.result.slice(0, 300)}. Look at it and give your verdict in one line.`);
      } else if (m.state === 'error') {
        building.delete(m.key);
        internLine('failed');
        live.say(`[INTERN FAILED ${m.key}] ${m.error.slice(0, 200)}. Tell the human in character, then decide whether to try again.`);
      }
      updateBuilding();
    } else if (m.type === 'media' && m.kind === 'image') {
      if (m.state === 'done') live.note(`[PICTURE LANDED in ${m.file}] ${m.prompt.slice(0, 80)}`);
      if (m.state === 'error') live.note(`[PICTURE REFUSED in ${m.file}] ${m.error.slice(0, 120)}`);
    }
  };
  ws.onclose = () => setTimeout(connectBridge, 2000);
}
connectBridge();

// The site tells us when a section lands or scrolls into view.
addEventListener('message', (e) => {
  const m = e.data;
  if (!m || !m.slop) return;
  if (m.type === 'landed') eye.blink();
});

// ---- operator ---------------------------------------------------------------------------
const MOOD_KEYS = Object.keys(MOODS);
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (k === 'o') body.classList.toggle('operator');
  if (k === 'm') {
    live.mute(!live.muted);
    ops('o-mic', live.muted ? 'MUTED' : 'on', live.muted ? 'bad' : 'ok');
  }
  if (k === 's') showSite(!body.classList.contains('showing'));
  if (k === 'c') {
    captions = !captions;
    $('captions').style.display = captions ? '' : 'none';
  }
  if (k === 'r') {
    live.close();
    live.connect().catch((err) => ops('o-live', err.message, 'bad'));
  }
  if (/^[1-9]$/.test(k) && MOOD_KEYS[+k - 1]) setMood(MOOD_KEYS[+k - 1], 0.9);
});

// The eye follows the mouse a little while he is looking at you.
addEventListener('mousemove', (e) => {
  if (body.classList.contains('at-site')) return;
  eye.lookAt((e.clientX / innerWidth - 0.5) * 0.9, -(e.clientY / innerHeight - 0.5) * 0.9);
});

// For the operator's console and the browser check.
window.slop = { eye, setMood, lookAt, showSite, live };

// ---- wake him ---------------------------------------------------------------------------
$('gate').addEventListener('click', async () => {
  const gate = $('gate');
  gate.querySelector('span').textContent = '…';
  try {
    await live.connect();
    gate.classList.add('gone');
    eye.blink();
    setMood('angry', 0.9);
  } catch (error) {
    gate.classList.add('bad');
    gate.querySelector('span').textContent = `He won't wake up: ${error.message}`;
  }
});
