// SLOP's face: one eye, drawn in a WebGL fragment shader. Everything that makes him feel alive
// is a parameter the stage can push: mood, gaze, speech loudness, blinks and gestures. No lips,
// so the pupil, the iris and the lids do the acting. His resting face is sarcasm: a heavy
// half-lid, one side of the lid raised like an eyebrow, a slow blink, the occasional eye-roll.
//
//   const eye = createEye(canvas);
//   eye.mood('smug', 0.8);  eye.lookAt(x, y);  eye.speak(level);  eye.gesture('eyeroll');

const VERT = `attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}`;

const FRAG = `
precision highp float;
uniform vec2 R;         // canvas size
uniform float T;        // seconds
uniform vec2 LOOK;      // gaze, -1..1
uniform float BLINK;    // 0 open .. 1 closed
uniform float ANGER;    // 0..1  red veins, lid pressure, tight pupil
uniform float DILATE;   // -1..1 pupil size offset
uniform float SPEAK;    // 0..1 loudness right now
uniform float LIDS;     // lid heaviness (bored/smug), 0..1
uniform float BROW;     // upper lid: 1 pressed down in a V (anger) .. -1 lifted (surprise)
uniform float TILT;     // asymmetry: one side of the upper lid raised, the eyebrow of sarcasm
uniform vec3 IRIS;      // iris colour

float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*noise(p);p*=2.1;a*=.5;}return v;}

void main(){
  vec2 uv=(gl_FragCoord.xy-.5*R)/min(R.x,R.y);   // -0.5..0.5 on the short side
  float t=T;
  float r=length(uv);
  float ball=.42;
  if(r>ball+.03){gl_FragColor=vec4(0.);return;}
  vec3 n=vec3(uv/ball,sqrt(max(0.,1.-dot(uv/ball,uv/ball))));
  vec2 gaze=LOOK*.33;
  vec2 c=uv-gaze*ball;                          // iris-centred coords
  float d=length(c);

  // Sclera: warm off-white, darker at the edge, veins that grow with anger.
  vec3 col=mix(vec3(.93,.90,.86),vec3(.62,.52,.50),smoothstep(.22,ball,r));
  float ang=atan(uv.y,uv.x);
  float veins=0.;
  for(int i=0;i<3;i++){
    float fi=float(i);
    float v=fbm(vec2(ang*3.+fi*7.,r*18.+t*.05))*fbm(vec2(r*40.-fi,ang*2.));
    veins+=smoothstep(.62-.18*ANGER,.9,v)*smoothstep(.12,.40,r);
  }
  col=mix(col,vec3(.75,.08,.06),clamp(veins*(.25+1.5*ANGER),0.,1.));
  col=mix(col,vec3(.92,.55,.50),ANGER*.18*smoothstep(.15,.42,r));

  // Iris: radial fibres that drift, two rings, a dark limbus. Speech makes the fibres shimmer.
  float irisR=.165;
  float pupilR=irisR*(.34-.16*ANGER+.14*DILATE+.09*SPEAK+.015*sin(t*7.));
  float ca=atan(c.y,c.x);
  float spin=t*(.15+.6*SPEAK);
  float fib=fbm(vec2(ca*9.,d*26.-spin))*.6+fbm(vec2(ca*40.+spin*.5,d*6.))*.4;
  vec3 iris=IRIS*(.55+.9*fib);
  iris=mix(iris,IRIS*1.8,smoothstep(.6,.95,fib)*.5);
  iris*=mix(1.,.35,smoothstep(irisR*.55,irisR,d));
  iris=mix(iris,vec3(.02),smoothstep(irisR-.012,irisR,d));
  float inIris=smoothstep(irisR+.004,irisR-.004,d);
  col=mix(col,iris,inIris);
  float pr=pupilR*(1.+.05*SPEAK*sin(t*31.));
  col=mix(col,vec3(0.),smoothstep(pr+.006,pr-.004,d));

  // Wet specular: a hard highlight and a soft sheen, placed by the normal.
  vec3 L=normalize(vec3(-.45,.55,.9));
  float spec=pow(max(0.,dot(normalize(reflect(-L,n)),vec3(0,0,1))),120.);
  col+=vec3(1.)*spec*.9;
  col+=vec3(.6,.7,.9)*pow(max(0.,dot(n,normalize(vec3(.6,-.3,.7)))),30.)*.25;
  col*=.75+.35*n.z;

  // Lids: an almond opening that narrows to the corners. The upper lid presses down into a V
  // for anger, lifts for surprise, sits heavy for boredom and smugness, and tilts so one side
  // is raised for sarcasm. Loud speech lifts it a little, like emphasis.
  float W=.47;
  float almond=sqrt(max(0.,1.-uv.x*uv.x/(W*W)));
  float dipV=ANGER*max(0.,BROW)*(.11-.09*abs(uv.x)/W);
  float tilt=TILT*.10*(uv.x/W);
  float hU=(.30+.09*max(0.,-BROW)-.11*LIDS+.04*SPEAK)*almond-dipV+tilt*almond;
  float hL=(.24-.07*LIDS-.03*ANGER)*almond;
  hU=mix(hU,.012*almond,BLINK);hL=mix(hL,.012*almond,BLINK);
  float curveU=hU;float curveL=-hL;
  float open=smoothstep(curveU+.010,curveU-.004,uv.y)*smoothstep(curveL-.010,curveL+.004,uv.y);
  col*=mix(.42,1.,smoothstep(curveU-.08,curveU-.012,uv.y)*.65+.35);
  float edge=smoothstep(.010,0.,abs(uv.y-curveU))+smoothstep(.007,0.,abs(uv.y-curveL));
  edge*=smoothstep(W+.02,W-.03,abs(uv.x));
  vec3 skin=vec3(.07,.045,.045);
  col=mix(skin,col,open);
  col=mix(col,vec3(.18,.04,.04),edge*.9*open);
  float alpha=max(open,edge*.6);
  gl_FragColor=vec4(col*alpha,alpha);
}`;

export const MOODS = {
  //            anger  lids  brow  tilt  dilate   iris colour
  smug:       { anger: 0.05, lids: 0.55, brow: 0.1, tilt: 0.9, dilate: 0.2, iris: [0.5, 0.6, 0.55] },
  deadpan:    { anger: 0.05, lids: 0.5, brow: 0.2, tilt: 0.0, dilate: -0.1, iris: [0.48, 0.55, 0.55] },
  bored:      { anger: 0.1, lids: 0.9, brow: 0.1, tilt: 0.2, dilate: -0.2, iris: [0.45, 0.5, 0.52] },
  suspicious: { anger: 0.3, lids: 0.6, brow: 0.6, tilt: 0.6, dilate: -0.3, iris: [0.55, 0.5, 0.42] },
  contempt:   { anger: 0.35, lids: 0.75, brow: 0.7, tilt: 0.7, dilate: -0.4, iris: [0.6, 0.48, 0.38] },
  thinking:   { anger: 0.1, lids: 0.3, brow: 0.3, tilt: 0.4, dilate: 0.0, iris: [0.52, 0.58, 0.62] },
  angry:      { anger: 0.65, lids: 0.2, brow: 1.0, tilt: 0.0, dilate: -0.4, iris: [0.7, 0.45, 0.3] },
  furious:    { anger: 1.0, lids: 0.1, brow: 1.0, tilt: 0.0, dilate: -0.7, iris: [0.85, 0.4, 0.22] },
  surprised:  { anger: 0.05, lids: 0.0, brow: -1.0, tilt: 0.0, dilate: 0.8, iris: [0.55, 0.62, 0.7] },
  pleased:    { anger: 0.0, lids: 0.4, brow: -0.2, tilt: 0.5, dilate: 0.5, iris: [0.5, 0.65, 0.6] },
  calm:       { anger: 0.0, lids: 0.15, brow: 0.1, tilt: 0.1, dilate: 0.1, iris: [0.55, 0.62, 0.66] },
};

/** Gestures: short scripted moves layered over the mood. Each is [seconds, fn(progress) -> partial state]. */
const GESTURES = {
  // Up, across the top, back down: the classic.
  eyeroll: [1.4, (p) => ({ look: [Math.sin(p * Math.PI) * 0.7, Math.sin(p * Math.PI) * 1.0], lids: 0.2 })],
  // A quick glance to the side and back, as if someone else should be seeing this.
  glance: [0.9, (p) => ({ look: [p < 0.5 ? 0.9 : 0.9 * (1 - (p - 0.5) * 2), 0.15] })],
  // A long, deliberate blink that holds shut for a beat.
  slowblink: [1.3, (p) => ({ blink: p < 0.25 ? p * 4 : p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3 })],
  // Narrow the eye, hold, release.
  squint: [1.2, (p) => ({ lids: 0.95, dilate: -0.5 })],
  // Two fast blinks: "sorry, what?"
  doubletake: [0.6, (p) => ({ blink: Math.max(0, Math.sin(p * Math.PI * 4)) })],
  // Both lids wide for a beat: mock surprise.
  wide: [0.9, () => ({ lids: 0, brow: -0.8, dilate: 0.7 })],
};

export function createEye(canvas) {
  const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: true });
  if (!gl) throw new Error('WebGL is not available');
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const p = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(p);
  gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  const U = {};
  for (const name of ['R', 'T', 'LOOK', 'BLINK', 'ANGER', 'DILATE', 'SPEAK', 'LIDS', 'BROW', 'TILT', 'IRIS'])
    U[name] = gl.getUniformLocation(prog, name);

  const KEYS = ['anger', 'lids', 'brow', 'tilt', 'dilate'];
  let moodName = 'smug';
  const target = { ...MOODS.smug, look: [0, 0] };
  const now = { anger: 0.05, lids: 0.55, brow: 0.1, tilt: 0.9, dilate: 0.2, iris: [...MOODS.smug.iris], look: [0, 0] };
  let intensity = 0.8;
  let blink = 0;
  let blinkAt = 2 + Math.random() * 3;
  let saccade = [0, 0];
  let saccadeAt = 1;
  let idleAt = 6;
  let speak = 0;
  let speakTarget = 0;
  let gesture = null; // { name, started, seconds, fn }
  const start = performance.now();
  const lerp = (a, b, k) => a + (b - a) * k;
  const rnd = (a, b) => a + Math.random() * (b - a);

  function frame() {
    const t = (performance.now() - start) / 1000;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
    // The gesture, if one is playing, overrides parts of the mood for its duration.
    let over = null;
    if (gesture) {
      const prog = (t - gesture.started) / gesture.seconds;
      if (prog >= 1) gesture = null;
      else over = gesture.fn(prog);
    }
    const k = 0.07;
    for (const key of KEYS) {
      const want = over && key in over ? over[key] : target[key] * (key === 'brow' || key === 'tilt' ? 1 : intensity);
      now[key] = lerp(now[key], want, key in (over ?? {}) ? 0.25 : k);
    }
    for (let i = 0; i < 3; i++) now.iris[i] = lerp(now.iris[i], target.iris[i], k * 0.5);
    // Gaze: the target plus tiny saccades, a slow drift, and the odd idle glance.
    if (t > saccadeAt) {
      saccade = [rnd(-0.06, 0.06), rnd(-0.04, 0.04)];
      saccadeAt = t + rnd(0.4, 2.6);
    }
    if (t > idleAt && !gesture) {
      const pick = Math.random();
      gesture = pick < 0.4 ? make('glance') : pick < 0.7 ? make('slowblink') : pick < 0.85 ? make('squint') : make('doubletake');
      gesture.started = t;
      idleAt = t + rnd(5, 11);
    }
    const drift = [Math.sin(t * 0.37) * 0.025, Math.cos(t * 0.23) * 0.02];
    const lookWant = over?.look ?? [target.look[0] + saccade[0] + drift[0], target.look[1] + saccade[1] + drift[1]];
    const lk = over?.look ? 0.12 : 0.18;
    now.look[0] = lerp(now.look[0], lookWant[0], lk);
    now.look[1] = lerp(now.look[1], lookWant[1], lk);
    // Blinks: fast close, slower open, at uneven intervals; heavy lids blink slower.
    if (t > blinkAt) {
      blink = 1;
      blinkAt = t + rnd(2.5, 7 - 2 * now.anger);
    }
    blink = Math.max(0, blink - (blink > 0.5 ? 0.12 : 0.06));
    const shut = Math.max(blink > 0.5 ? (1 - blink) * 2 : blink * 2, over?.blink ?? 0);
    // Speech: smoothed, with a quick attack and a slower release.
    speak = lerp(speak, speakTarget, speakTarget > speak ? 0.5 : 0.12);

    gl.uniform2f(U.R, w, h);
    gl.uniform1f(U.T, t);
    gl.uniform2f(U.LOOK, now.look[0], now.look[1]);
    gl.uniform1f(U.BLINK, Math.min(1, shut));
    gl.uniform1f(U.ANGER, now.anger);
    gl.uniform1f(U.DILATE, now.dilate);
    gl.uniform1f(U.SPEAK, speak);
    gl.uniform1f(U.LIDS, now.lids);
    gl.uniform1f(U.BROW, now.brow);
    gl.uniform1f(U.TILT, now.tilt);
    gl.uniform3f(U.IRIS, now.iris[0], now.iris[1], now.iris[2]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    requestAnimationFrame(frame);
  }
  const make = (name) => {
    const [seconds, fn] = GESTURES[name];
    return { name, started: (performance.now() - start) / 1000, seconds, fn };
  };
  requestAnimationFrame(frame);

  return {
    /** One of MOODS, with how strongly it shows (0..1). */
    mood(name, strength = 0.8) {
      const m = MOODS[name];
      if (!m) return false;
      moodName = name;
      Object.assign(target, { anger: m.anger, lids: m.lids, brow: m.brow, tilt: m.tilt, dilate: m.dilate, iris: m.iris });
      intensity = Math.max(0.2, Math.min(1, strength));
      return true;
    },
    /** A short move: eyeroll, glance, slowblink, squint, doubletake, wide. */
    gesture(name) {
      if (!GESTURES[name]) return false;
      gesture = make(name);
      idleAt = (performance.now() - start) / 1000 + 6;
      return true;
    },
    /** Where he looks, -1..1 on each axis. */
    lookAt(x, y) {
      target.look = [Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, y))];
    },
    /** Loudness of what he is saying right now, 0..1, every frame. */
    speak(level) {
      speakTarget = Math.min(1, level);
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

export const GESTURE_NAMES = Object.keys(GESTURES);
