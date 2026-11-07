// The stage: wires the eye, the voice and the bridge together.
//   - Gemini tool calls drive the face, the gaze and the builds.
//   - Bridge events (intern steps, pictures landing) become short notes to SLOP, so he can
//     react to what the intern is doing without ever being asked to wait.
//   - The site slides in on the first build and stays; SLOP's gaze decides how much of it shows.
import { createEye, GESTURE_NAMES, MOODS } from '/eye.js';
import { createLive } from '/live.js';

const $ = (id) => document.getElementById(id);
const body = document.body;
const eye = createEye(document.querySelector('#eye canvas'));
eye.mood('smug', 0.8);
eye.lookAt(0, 0);
const eyeCanvas = document.querySelector('#eye canvas');

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
function setMood(mood, intensity = 0.8, gesture = '') {
  if (!MOODS[mood]) return false;
  eye.mood(mood, intensity);
  if (gesture) eye.gesture(gesture);
  body.classList.toggle('furious', mood === 'furious');
  ops('o-mood', `${mood} ${Math.round(intensity * 10) / 10}${gesture ? ` + ${gesture}` : ''}`);
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
  try {
    localStorage.setItem(`slop-showing:${location.pathname}`, visible ? '1' : '');
  } catch {
    // private window
  }
}

// After a refresh, the site comes back if it was showing or if anything has been built.
fetch('api/state')
  .then((r) => r.json())
  .then((s) => {
    let remembered = '';
    try {
      remembered = localStorage.getItem(`slop-showing:${location.pathname}`) ?? '';
    } catch {
      // private window
    }
    if (remembered === '1' || (remembered === '' && (s.site.sections.length || s.design))) showSite(true);
    for (const key of Object.keys(s.building)) building.add(key);
    updateBuilding();
    showSpec(s.spec ?? {}, s.missing ?? []);
    document.title = `SLOP · ${s.site.title !== 'Untitled' ? s.site.title : s.project}`;
  })
  .catch(() => {});

// ---- the voice --------------------------------------------------------------------------
const live = createLive({
  onSaid: said,
  onHeard: heard,
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
    if (name === 'set_mood')
      return setMood(String(args.mood), Number(args.intensity ?? 0.8), String(args.gesture ?? ''))
        ? { ok: true, scheduling: 'SILENT' }
        : { error: `unknown mood; use one of ${Object.keys(MOODS).join(', ')}` };
    if (name === 'look_at') return { ok: lookAt(String(args.target ?? 'user')), scheduling: 'SILENT' };
    if (name === 'note_spec') {
      const r = await fetch('api/spec', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ field: args.field, answer: args.answer }),
      });
      const data = await r.json();
      if (!r.ok) return { error: data.error };
      showSpec(data.spec, data.missing);
      return { recorded: args.field, missing: data.missing, scheduling: 'SILENT' };
    }
    if (name === 'show_site') {
      showSite(Boolean(args.visible));
      return { ok: true, scheduling: 'SILENT' };
    }
    if (name === 'build') {
      const r = await fetch('api/build', {
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

// Every frame: his voice moves the eye (pupil, lids, a small swell of the whole eye).
(function pulse() {
  const level = live.level();
  eye.speak(level);
  eyeCanvas.style.transform = `scale(${(1 + level * 0.045).toFixed(4)})`;
  requestAnimationFrame(pulse);
})();

// ---- bridge events -----------------------------------------------------------------------
function internLine(text) {
  $('intern').querySelector('i').textContent = text;
}
// The spec checklist in the operator panel.
const FIELDS = ['name', 'what', 'audience', 'goal', 'feeling', 'content', 'brand'];
const shown = {};
function showSpec(spec, missing) {
  const el = $('o-spec');
  el.innerHTML = '';
  for (const id of FIELDS) {
    const row = document.createElement('div');
    row.innerHTML = '<span></span><span></span>';
    row.children[0].textContent = id;
    row.children[1].textContent = spec[id] ? spec[id].slice(0, 28) : missing.includes(id) ? '?' : '';
    row.children[1].className = spec[id] ? 'ok' : 'bad';
    el.append(row);
  }
  // The brief on stage: every slot, lit as it is answered; a changed answer flashes again.
  const brief = $('brief');
  if (!brief.children.length)
    for (const id of FIELDS) {
      const slot = document.createElement('div');
      slot.dataset.field = id;
      slot.innerHTML = '<b></b><span></span>';
      slot.querySelector('b').textContent = id;
      brief.append(slot);
    }
  for (const slot of brief.children) {
    const id = slot.dataset.field;
    const value = spec[id] || '';
    slot.classList.toggle('on', Boolean(value));
    if (value && value !== shown[id]) {
      slot.querySelector('span').textContent = value;
      slot.classList.remove('fresh');
      void slot.offsetWidth;
      slot.classList.add('fresh');
      if (shown[id] !== undefined) eye.gesture('glance');
    }
    if (!value) slot.querySelector('span').textContent = '';
    shown[id] = value;
  }
}

function updateBuilding() {
  body.classList.toggle('building', building.size > 0);
  ops('o-building', [...building].join(', ') || '–');
}

function connectBridge() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${location.pathname.replace(/[^/]*$/, '')}ws`);
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
    } else if (m.type === 'spec') showSpec(m.spec, m.missing);
  };
  ws.onclose = () => setTimeout(connectBridge, 2000);
}
connectBridge();

// The site tells us when a section lands, when it is about to reload (so we fade instead of
// flash) and when it is ready again.
addEventListener('message', (e) => {
  const m = e.data;
  if (!m || !m.slop) return;
  if (m.type === 'landed') eye.blink();
  if (m.type === 'reloading') $('site').classList.add('reloading');
  if (m.type === 'ready') $('site').classList.remove('reloading');
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
  if (k === 'b') body.classList.toggle('nobrief');
  if (k === 'r') {
    live.close();
    live.connect().catch((err) => ops('o-live', err.message, 'bad'));
  }
  if (/^[1-9]$/.test(k) && MOOD_KEYS[+k - 1]) setMood(MOOD_KEYS[+k - 1], 0.9);
  if (k === 'e') eye.gesture('eyeroll');
  if (k === 'g') eye.gesture(GESTURE_NAMES[Math.floor(Math.random() * GESTURE_NAMES.length)]);
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
    eye.gesture('slowblink');
    setMood('smug', 0.9);
  } catch (error) {
    gate.classList.add('bad');
    gate.querySelector('span').textContent = `He won't wake up: ${error.message}`;
  }
});
