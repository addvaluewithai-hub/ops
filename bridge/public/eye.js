// SLOP's face: one flat, graphic eye drawn on a 2D canvas, like a mark rather than an eyeball.
// A thick almond, a big dark iris with one hard highlight, a heavy lid that rests at half-mast,
// and a single eyebrow above it that does most of the acting. A thin red ring inside the iris
// lights up with his voice. Everything is a parameter the stage can push: mood, gaze, speech
// loudness, blinks and gestures.
//
//   const eye = createEye(canvas);
//   eye.mood('smug', 0.8);  eye.lookAt(x, y);  eye.speak(level);  eye.gesture('eyeroll');

export const MOODS = {
  //            lids  tilt  browH  arch  browTilt  dip   dilate  tint
  smug:       { lids: 0.5, tilt: 0.8, browH: 0.55, arch: 0.35, browTilt: 0.55, dip: 0.0, dilate: 0.15, tint: 0 },
  deadpan:    { lids: 0.5, tilt: 0.0, browH: 0.38, arch: 0.05, browTilt: 0.0, dip: 0.0, dilate: -0.1, tint: 0 },
  bored:      { lids: 0.82, tilt: 0.1, browH: 0.3, arch: 0.1, browTilt: 0.1, dip: 0.0, dilate: -0.2, tint: 0 },
  suspicious: { lids: 0.6, tilt: 0.5, browH: 0.3, arch: 0.15, browTilt: 0.35, dip: 0.35, dilate: -0.3, tint: 0.1 },
  contempt:   { lids: 0.7, tilt: 0.7, browH: 0.32, arch: 0.2, browTilt: 0.6, dip: 0.15, dilate: -0.35, tint: 0.15 },
  thinking:   { lids: 0.3, tilt: 0.4, browH: 0.62, arch: 0.55, browTilt: 0.3, dip: 0.0, dilate: 0.0, tint: 0 },
  angry:      { lids: 0.3, tilt: 0.0, browH: 0.2, arch: 0.0, browTilt: 0.0, dip: 0.9, dilate: -0.4, tint: 0.55 },
  furious:    { lids: 0.2, tilt: 0.0, browH: 0.12, arch: 0.0, browTilt: 0.0, dip: 1.0, dilate: -0.65, tint: 1.0 },
  surprised:  { lids: 0.0, tilt: 0.0, browH: 0.95, arch: 0.9, browTilt: 0.0, dip: 0.0, dilate: 0.8, tint: 0 },
  pleased:    { lids: 0.45, tilt: 0.4, browH: 0.6, arch: 0.55, browTilt: 0.25, dip: 0.0, dilate: 0.5, tint: 0 },
  calm:       { lids: 0.2, tilt: 0.1, browH: 0.5, arch: 0.35, browTilt: 0.0, dip: 0.0, dilate: 0.1, tint: 0 },
};
const KEYS = Object.keys(MOODS.calm);

/** Gestures: short scripted moves layered over the mood. [seconds, fn(progress) -> partial state]. */
const GESTURES = {
  eyeroll: [1.4, (p) => ({ look: [Math.sin(p * Math.PI) * 0.7, Math.sin(p * Math.PI) * 1.0], lids: 0.15, browH: 0.8 })],
  glance: [0.9, (p) => ({ look: [p < 0.5 ? 0.9 : 0.9 * (1 - (p - 0.5) * 2), 0.15] })],
  slowblink: [1.3, (p) => ({ blink: p < 0.25 ? p * 4 : p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3 })],
  squint: [1.2, () => ({ lids: 0.9, dilate: -0.5, browH: 0.22, dip: 0.4 })],
  doubletake: [0.6, (p) => ({ blink: Math.max(0, Math.sin(p * Math.PI * 4)) })],
  wide: [0.9, () => ({ lids: 0, browH: 0.95, arch: 0.9, dilate: 0.7 })],
};
export const GESTURE_NAMES = Object.keys(GESTURES);

const INK = '#0b0b0b';
const SCLERA = '#ece6da';
const BROW = '#d9d2c6';

export function createEye(canvas) {
  const ctx = canvas.getContext('2d');
  let moodName = 'smug';
  const target = { ...MOODS.smug, look: [0, 0] };
  const now = { ...MOODS.smug, look: [0, 0] };
  let intensity = 0.8;
  let blink = 0;
  let blinkAt = 2 + Math.random() * 3;
  let saccade = [0, 0];
  let saccadeAt = 1;
  let idleAt = 6;
  let speak = 0;
  let speakTarget = 0;
  let gesture = null;
  const start = performance.now();
  const lerp = (a, b, k) => a + (b - a) * k;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const make = (name) => {
    const [seconds, fn] = GESTURES[name];
    return { name, started: (performance.now() - start) / 1000, seconds, fn };
  };

  // Lid curves as functions of x in [-1, 1] (units of the eye's half-width), in units of u.
  const upper = (x, s) => {
    const almond = Math.sqrt(Math.max(0, 1 - x * x)) ** 0.85;
    const open = 0.52 - 0.36 * s.lids + 0.05 * speak;
    return open * almond + s.tilt * 0.13 * x * almond - s.dip * 0.16 * (1 - Math.abs(x)) * (1 - s.lids * 0.5);
  };
  const lower = (x, s) => -(0.27 - 0.05 * s.lids) * Math.sqrt(Math.max(0, 1 - x * x)) ** 0.9;

  function lidPath(s, A, shut) {
    // The opening, as a closed path: upper lid left to right, lower lid right to left.
    ctx.beginPath();
    for (let i = 0; i <= 48; i++) {
      const x = -1 + (2 * i) / 48;
      const y = lerp(upper(x, s), 0.012, shut);
      ctx[i ? 'lineTo' : 'moveTo'](x * A, -y * A);
    }
    for (let i = 48; i >= 0; i--) {
      const x = -1 + (2 * i) / 48;
      const y = lerp(lower(x, s), -0.012, shut);
      ctx.lineTo(x * A, -y * A);
    }
    ctx.closePath();
  }

  function frame() {
    const t = (performance.now() - start) / 1000;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    let over = null;
    if (gesture) {
      const prog = (t - gesture.started) / gesture.seconds;
      if (prog >= 1) gesture = null;
      else over = gesture.fn(prog);
    }
    for (const key of KEYS) {
      const base = key === 'tilt' || key === 'browTilt' || key === 'tint' ? target[key] : target[key] * intensity + (key === 'browH' ? 0.3 * (1 - intensity) : 0);
      const want = over && key in over ? over[key] : base;
      now[key] = lerp(now[key], want, over && key in over ? 0.25 : 0.08);
    }
    if (t > saccadeAt) {
      saccade = [rnd(-0.05, 0.05), rnd(-0.03, 0.03)];
      saccadeAt = t + rnd(0.4, 2.6);
    }
    if (t > idleAt && !gesture) {
      const pick = Math.random();
      gesture = pick < 0.4 ? make('glance') : pick < 0.7 ? make('slowblink') : pick < 0.85 ? make('squint') : make('doubletake');
      idleAt = t + rnd(5, 11);
    }
    const drift = [Math.sin(t * 0.37) * 0.02, Math.cos(t * 0.23) * 0.015];
    const lookWant = over?.look ?? [target.look[0] + saccade[0] + drift[0], target.look[1] + saccade[1] + drift[1]];
    const lk = over?.look ? 0.12 : 0.18;
    now.look[0] = lerp(now.look[0], lookWant[0], lk);
    now.look[1] = lerp(now.look[1], lookWant[1], lk);
    if (t > blinkAt) {
      blink = 1;
      blinkAt = t + rnd(2.5, 7);
    }
    blink = Math.max(0, blink - (blink > 0.5 ? 0.12 : 0.06));
    const shut = clamp(Math.max(blink > 0.5 ? (1 - blink) * 2 : blink * 2, over?.blink ?? 0), 0, 1);
    speak = lerp(speak, speakTarget, speakTarget > speak ? 0.5 : 0.12);

    // ---- draw ----
    const u = Math.min(w, h) / 2;
    const A = u * 0.84; // half-width of the eye
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.translate(w / 2, h / 2 + u * 0.12);

    // The coin: a black disc behind everything, so the mark sits on any page.
    ctx.beginPath();
    ctx.arc(0, -u * 0.12, u * 0.98, 0, Math.PI * 2);
    ctx.fillStyle = '#000';
    ctx.fill();

    // The opening, filled with sclera, then the iris clipped inside it.
    ctx.save();
    lidPath(now, A, shut);
    ctx.fillStyle = SCLERA;
    ctx.fill();
    ctx.clip();
    const irisR = A * 0.36;
    const cx = now.look[0] * A * 0.42;
    const cy = -now.look[1] * A * 0.2 - A * 0.02;
    const tint = clamp(now.tint, 0, 1);
    // A soft shadow under the upper lid.
    const sh = ctx.createLinearGradient(0, -A * 0.5, 0, A * 0.1);
    sh.addColorStop(0, 'rgba(0,0,0,.28)');
    sh.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sh;
    ctx.fillRect(-A, -A, 2 * A, 2 * A);
    // Iris.
    ctx.beginPath();
    ctx.arc(cx, cy, irisR, 0, Math.PI * 2);
    ctx.fillStyle = `rgb(${Math.round(28 + 90 * tint)},${Math.round(44 - 20 * tint)},${Math.round(48 - 26 * tint)})`;
    ctx.fill();
    ctx.lineWidth = A * 0.028;
    ctx.strokeStyle = INK;
    ctx.stroke();
    // The red ring: his voice.
    const ring = clamp(0.12 + speak * 0.95 + tint * 0.4, 0, 1);
    ctx.beginPath();
    ctx.arc(cx, cy, irisR * 0.66, 0, Math.PI * 2);
    ctx.lineWidth = A * (0.018 + 0.02 * speak);
    ctx.strokeStyle = `rgba(224,38,31,${ring})`;
    ctx.stroke();
    // Pupil.
    const pupilR = irisR * clamp(0.42 + 0.16 * now.dilate + 0.1 * speak - 0.08 * tint, 0.22, 0.7);
    ctx.beginPath();
    ctx.arc(cx, cy, pupilR, 0, Math.PI * 2);
    ctx.fillStyle = INK;
    ctx.fill();
    // One hard highlight, and a small second one.
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(cx - irisR * 0.34, cy - irisR * 0.36, irisR * 0.17, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + irisR * 0.3, cy + irisR * 0.38, irisR * 0.06, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // The lid line: thick ink along the upper lid, thinner along the lower, thickening at the
    // outer corner like a lash.
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = INK;
    ctx.beginPath();
    for (let i = 0; i <= 48; i++) {
      const x = -1 + (2 * i) / 48;
      ctx[i ? 'lineTo' : 'moveTo'](x * A, -lerp(upper(x, now), 0.012, shut) * A);
    }
    ctx.lineWidth = A * 0.075;
    ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i <= 48; i++) {
      const x = -1 + (2 * i) / 48;
      ctx[i ? 'lineTo' : 'moveTo'](x * A, -lerp(lower(x, now), -0.012, shut) * A);
    }
    ctx.lineWidth = A * 0.04;
    ctx.stroke();
    // The lash: a short thick flick off the outer (right) corner.
    const cornerY = -lerp(upper(1, now), 0.012, shut) * A;
    ctx.beginPath();
    ctx.moveTo(A * 0.98, cornerY);
    ctx.quadraticCurveTo(A * 1.08, cornerY - A * 0.06, A * 1.14, cornerY - A * 0.16);
    ctx.lineWidth = A * 0.06;
    ctx.stroke();

    // The eyebrow: a tapered stroke above the eye. Height, arch, tilt and the inner dip (anger)
    // come from the mood; loud speech lifts it a little.
    const bh = -A * (0.42 + 0.36 * now.browH + 0.06 * speak);
    const bA = A * 0.92;
    ctx.beginPath();
    const browY = (x) => bh - A * (0.22 * now.arch * (1 - x * x) + 0.12 * now.browTilt * x - 0.2 * now.dip * (1 - Math.abs(x)) * (x < 0 ? 1 : 0.6));
    const browW = (x) => A * 0.11 * Math.sqrt(Math.max(0, 1 - x * x)) * (1 - 0.25 * (x + 1) / 2);
    for (let i = 0; i <= 40; i++) {
      const x = -1 + (2 * i) / 40;
      ctx[i ? 'lineTo' : 'moveTo'](x * bA, browY(x) - browW(x) / 2);
    }
    for (let i = 40; i >= 0; i--) {
      const x = -1 + (2 * i) / 40;
      ctx.lineTo(x * bA, browY(x) + browW(x) / 2);
    }
    ctx.closePath();
    ctx.fillStyle = BROW;
    ctx.fill();

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    mood(name, strength = 0.8) {
      const m = MOODS[name];
      if (!m) return false;
      moodName = name;
      Object.assign(target, m);
      intensity = clamp(strength, 0.2, 1);
      return true;
    },
    gesture(name) {
      if (!GESTURES[name]) return false;
      gesture = make(name);
      idleAt = (performance.now() - start) / 1000 + 6;
      return true;
    },
    lookAt(x, y) {
      target.look = [clamp(x, -1, 1), clamp(y, -1, 1)];
    },
    speak(level) {
      speakTarget = clamp(level, 0, 1);
    },
    blink() {
      blink = 1;
    },
    get moodName() {
      return moodName;
    },
    get level() {
      return speak;
    },
  };
}
