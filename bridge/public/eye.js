// SLOP's face: one eye, drawn in a WebGL fragment shader. Everything that makes him feel alive
// is a parameter the stage can push: mood, gaze, speech loudness, blinking. No lips, so the
// pupil, the iris and the lids do the acting.
//
//   const eye = createEye(canvas);
//   eye.mood('furious', 0.8);  eye.lookAt(x, y);  eye.speak(level);  eye.blink();

const VERT = `attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}`;

const FRAG = `
precision highp float;
uniform vec2 R;         // canvas size
uniform float T;        // seconds
uniform vec2 LOOK;      // gaze, -1..1
uniform float BLINK;    // 0 open .. 1 closed
uniform float ANGER;    // 0..1  red veins, lid slant, tight pupil
uniform float DILATE;   // -1..1 pupil size offset
uniform float SPEAK;    // 0..1 loudness
uniform float LIDS;     // extra lid drop (bored/contempt), 0..1
uniform float BROW;     // upper lid tilt sign, -1 (surprise) .. 1 (anger)
uniform vec3 IRIS;      // iris colour

float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*noise(p);p*=2.1;a*=.5;}return v;}

void main(){
  vec2 uv=(gl_FragCoord.xy-.5*R)/min(R.x,R.y);   // -0.5..0.5 on the short side
  float t=T;

  // The eyeball: a sphere seen from the front. Gaze rotates the iris across it.
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
  col=mix(col,vec3(.75,.08,.06),clamp(veins*(.35+1.4*ANGER),0.,1.));
  col=mix(col,vec3(.92,.55,.50),ANGER*.18*smoothstep(.15,.42,r)); // bloodshot flush

  // Iris: radial fibres, two rings, a dark limbus.
  float irisR=.165;
  float pupilR=irisR*(.34-.16*ANGER+.14*DILATE+.06*SPEAK+.015*sin(t*7.));
  float ca=atan(c.y,c.x);
  float fib=fbm(vec2(ca*9.,d*26.-t*.15))*.6+fbm(vec2(ca*40.,d*6.))*.4;
  vec3 iris=IRIS*(.55+.9*fib);
  iris=mix(iris,IRIS*1.8,smoothstep(.6,.95,fib)*.5);
  iris*=mix(1.,.35,smoothstep(irisR*.55,irisR,d));        // dark outer ring
  iris=mix(iris,vec3(.02),smoothstep(irisR-.012,irisR,d)); // limbus
  float inIris=smoothstep(irisR+.004,irisR-.004,d);
  col=mix(col,iris,inIris);
  // Pupil with a soft edge that trembles when he talks.
  float pr=pupilR*(1.+.04*SPEAK*sin(t*31.));
  col=mix(col,vec3(0.),smoothstep(pr+.006,pr-.004,d));

  // Wet specular: a hard highlight and a soft sheen, placed by the normal.
  vec3 L=normalize(vec3(-.45,.55,.9));
  float spec=pow(max(0.,dot(normalize(reflect(-L,n)),vec3(0,0,1))),120.);
  col+=vec3(1.)*spec*.9;
  col+=vec3(.6,.7,.9)*pow(max(0.,dot(n,normalize(vec3(.6,-.3,.7)))),30.)*.25;
  col*=.75+.35*n.z;                                        // shading at the edge

  // Lids: an almond opening that narrows to the corners. Anger presses the upper lid down and
  // dips it into a V in the middle; surprise lifts it; boredom and contempt raise the lower lid.
  float W=.47;
  float almond=sqrt(max(0.,1.-uv.x*uv.x/(W*W)));
  float dipV=ANGER*max(0.,BROW)*(.11-.09*abs(uv.x)/W);         // V between the brows
  float hU=(.30+.09*max(0.,-BROW)-.05*LIDS)*almond-dipV;
  float hL=(.24-.07*LIDS-.03*ANGER)*almond;
  hU=mix(hU,.012*almond,BLINK);hL=mix(hL,.012*almond,BLINK);
  float curveU=hU;float curveL=-hL;
  float open=smoothstep(curveU+.010,curveU-.004,uv.y)*smoothstep(curveL-.010,curveL+.004,uv.y);
  // Shadow of the upper lid on the ball, and a thin wet edge on both lids.
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
  //            anger  lids  brow  dilate   iris colour
  calm:       { anger: 0.05, lids: 0.1, brow: 0.2, dilate: 0.1, iris: [0.55, 0.62, 0.66] },
  thinking:   { anger: 0.15, lids: 0.3, brow: 0.3, dilate: 0.0, iris: [0.52, 0.58, 0.62] },
  bored:      { anger: 0.1, lids: 0.9, brow: 0.1, dilate: -0.2, iris: [0.45, 0.5, 0.52] },
  suspicious: { anger: 0.35, lids: 0.6, brow: 0.6, dilate: -0.3, iris: [0.55, 0.5, 0.42] },
  contempt:   { anger: 0.4, lids: 0.75, brow: 0.8, dilate: -0.4, iris: [0.6, 0.48, 0.38] },
  angry:      { anger: 0.65, lids: 0.2, brow: 1.0, dilate: -0.4, iris: [0.7, 0.45, 0.3] },
  furious:    { anger: 1.0, lids: 0.1, brow: 1.0, dilate: -0.7, iris: [0.85, 0.4, 0.22] },
  surprised:  { anger: 0.1, lids: 0.0, brow: -1.0, dilate: 0.8, iris: [0.55, 0.62, 0.7] },
  pleased:    { anger: 0.0, lids: 0.35, brow: -0.2, dilate: 0.5, iris: [0.5, 0.65, 0.6] },
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
  for (const name of ['R', 'T', 'LOOK', 'BLINK', 'ANGER', 'DILATE', 'SPEAK', 'LIDS', 'BROW', 'IRIS'])
    U[name] = gl.getUniformLocation(prog, name);

  // Targets and the smoothed values that chase them.
  const target = { ...MOODS.angry, look: [0, 0] };
  const now = { anger: 0.6, lids: 0.2, brow: 1, dilate: -0.4, iris: [0.7, 0.45, 0.3], look: [0, 0] };
  let intensity = 0.8;
  let blink = 0;
  let blinkAt = 2 + Math.random() * 3;
  let saccade = [0, 0];
  let saccadeAt = 1;
  let speak = 0;
  let speakTarget = 0;
  const start = performance.now();

  const lerp = (a, b, k) => a + (b - a) * k;

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
    // Mood chases its target; intensity scales how far it goes.
    const k = 0.06;
    for (const key of ['anger', 'lids', 'brow', 'dilate'])
      now[key] = lerp(now[key], target[key] * (key === 'brow' ? 1 : intensity), k);
    for (let i = 0; i < 3; i++) now.iris[i] = lerp(now.iris[i], target.iris[i], k * 0.5);
    // Gaze: the target plus tiny saccades and a slow drift.
    if (t > saccadeAt) {
      saccade = [(Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.08];
      saccadeAt = t + 0.4 + Math.random() * 2.2;
    }
    const drift = [Math.sin(t * 0.37) * 0.02, Math.cos(t * 0.23) * 0.015];
    now.look[0] = lerp(now.look[0], target.look[0] + saccade[0] + drift[0], 0.18);
    now.look[1] = lerp(now.look[1], target.look[1] + saccade[1] + drift[1], 0.18);
    // Blinks: fast close, slower open, at uneven intervals; angry eyes blink less.
    if (t > blinkAt) {
      blink = 1;
      blinkAt = t + 2.5 + Math.random() * (5 - 2 * now.anger);
    }
    blink = Math.max(0, blink - (blink > 0.5 ? 0.12 : 0.07));
    const shut = blink > 0.5 ? (1 - blink) * 2 : blink * 2;
    speak = lerp(speak, speakTarget, 0.35);
    speakTarget *= 0.85;

    gl.uniform2f(U.R, w, h);
    gl.uniform1f(U.T, t);
    gl.uniform2f(U.LOOK, now.look[0], now.look[1]);
    gl.uniform1f(U.BLINK, Math.min(1, shut + now.lids * 0.0));
    gl.uniform1f(U.ANGER, now.anger);
    gl.uniform1f(U.DILATE, now.dilate);
    gl.uniform1f(U.SPEAK, speak);
    gl.uniform1f(U.LIDS, now.lids);
    gl.uniform1f(U.BROW, now.brow);
    gl.uniform3f(U.IRIS, now.iris[0], now.iris[1], now.iris[2]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    /** One of MOODS, with how strongly it shows (0..1). */
    mood(name, strength = 0.8) {
      const m = MOODS[name] ?? MOODS.angry;
      Object.assign(target, { anger: m.anger, lids: m.lids, brow: m.brow, dilate: m.dilate, iris: m.iris });
      intensity = Math.max(0.2, Math.min(1, strength));
    },
    /** Where he looks, -1..1 on each axis. */
    lookAt(x, y) {
      target.look = [Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, y))];
    },
    /** Loudness of what he is saying right now, 0..1. */
    speak(level) {
      speakTarget = Math.max(speakTarget, Math.min(1, level * 1.4));
    },
    blink() {
      blink = 1;
    },
    get current() {
      return { ...now, mood: Object.keys(MOODS).find((k) => MOODS[k] === target) };
    },
  };
}
