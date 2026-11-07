// SLOP's voice: the Gemini Live WebSocket, the microphone in, the speaker out. The bridge mints
// a single-use token carrying the persona and tools; the browser only ever sees that token.
//
//   const live = createLive({ onTool, onSaid, onHeard, onLevel, onState });
//   await live.connect();  live.note('[INTERN DONE hero]');  live.close();

const WS =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';

export function createLive({ onTool, onSaid, onHeard, onLevel, onState, onInterrupted }) {
  let socket = null;
  let out = null; // AudioContext for playback
  let analyser = null; // taps the playback so the eye can move with the voice
  let levelBuf = null;
  let playAt = 0;
  let sources = [];
  let mic = null;
  // The resumption handle lives in sessionStorage, so a page refresh continues the same
  // conversation instead of waking him up again.
  const RESUME = `slop-resume:${location.pathname}`;
  let resumeHandle = sessionStorage.getItem(RESUME) || null;
  let ready = false;
  const state = (s, detail) => onState?.(s, detail);

  function playPcm(base64, rate) {
    const raw = atob(base64);
    const samples = new Int16Array(raw.length / 2);
    for (let i = 0; i < samples.length; i++)
      samples[i] = (raw.charCodeAt(2 * i + 1) << 8) | raw.charCodeAt(2 * i);
    const buffer = out.createBuffer(1, samples.length, rate);
    const data = buffer.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < samples.length; i++) {
      data[i] = samples[i] / 32768;
      peak = Math.max(peak, Math.abs(data[i]));
    }
    const node = out.createBufferSource();
    node.buffer = buffer;
    node.connect(analyser);
    playAt = Math.max(playAt, out.currentTime + 0.02);
    node.start(playAt);
    const at = playAt;
    playAt += buffer.duration;
    sources.push(node);
    node.onended = () => (sources = sources.filter((s) => s !== node));
    // Loudness for the eye, at the moment the chunk actually plays.
    setTimeout(() => onLevel?.(peak), Math.max(0, (at - out.currentTime) * 1000));
  }

  function stopPlayback() {
    for (const s of sources) {
      try {
        s.stop();
      } catch {
        // already ended
      }
    }
    sources = [];
    playAt = 0;
  }

  const send = (value) => socket?.readyState === 1 && socket.send(JSON.stringify(value));

  async function startMic() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const ctx = new AudioContext({ sampleRate: 16000 });
    const source = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(2048, 1, 1);
    proc.onaudioprocess = (e) => {
      if (!ready || mic?.muted) return;
      const f = e.inputBuffer.getChannelData(0);
      const pcm = new Int16Array(f.length);
      for (let i = 0; i < f.length; i++) pcm[i] = Math.max(-1, Math.min(1, f[i])) * 32767;
      let bin = '';
      const bytes = new Uint8Array(pcm.buffer);
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      send({ realtimeInput: { audio: { data: btoa(bin), mimeType: 'audio/pcm;rate=16000' } } });
    };
    source.connect(proc);
    proc.connect(ctx.destination);
    mic = { stream, ctx, muted: false };
  }

  async function connect() {
    state('connecting');
    out ||= new AudioContext({ sampleRate: 24000 });
    if (!analyser) {
      analyser = out.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.4;
      analyser.connect(out.destination);
      levelBuf = new Float32Array(analyser.fftSize);
    }
    await out.resume();
    const t = await fetch('api/live-token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json()).error || r.status))));
    socket = new WebSocket(`${WS}?access_token=${encodeURIComponent(t.token)}`);
    socket.onopen = () =>
      send({
        setup: {
          model: `models/${t.model}`,
          ...t.setup,
          ...(resumeHandle ? { sessionResumption: { handle: resumeHandle } } : {}),
        },
      });
    socket.onmessage = async (e) => {
      const m = JSON.parse(typeof e.data === 'string' ? e.data : await e.data.text());
      if (m.setupComplete) {
        ready = true;
        state('live');
        if (!mic) await startMic();
      }
      if (m.sessionResumptionUpdate?.resumable && m.sessionResumptionUpdate.newHandle) {
        resumeHandle = m.sessionResumptionUpdate.newHandle;
        sessionStorage.setItem(RESUME, resumeHandle);
      }
      if (m.error) state('error', m.error.message ?? JSON.stringify(m.error));
      const c = m.serverContent;
      if (c?.interrupted) {
        stopPlayback();
        onInterrupted?.();
      }
      if (c?.inputTranscription?.text) onHeard?.(c.inputTranscription.text);
      if (c?.outputTranscription?.text) onSaid?.(c.outputTranscription.text, false);
      for (const part of c?.modelTurn?.parts ?? [])
        if (part.inlineData?.mimeType?.startsWith('audio/pcm'))
          playPcm(part.inlineData.data, Number(/rate=(\d+)/.exec(part.inlineData.mimeType)?.[1] ?? 24000));
      if (c?.turnComplete) onSaid?.('', true);
      if (m.toolCall) {
        const responses = [];
        for (const call of m.toolCall.functionCalls) {
          let response;
          try {
            response = (await onTool?.(call.name, call.args ?? {})) ?? { ok: true };
          } catch (error) {
            response = { error: error.message };
          }
          responses.push({ id: call.id, name: call.name, response });
        }
        send({ toolResponse: { functionResponses: responses } });
      }
      if (m.goAway) state('goaway', m.goAway.timeLeft);
    };
    socket.onclose = (e) => {
      ready = false;
      // A refused resume (an expired handle) must not loop: start fresh next time.
      if (e.code === 1007 || e.code === 1008) {
        resumeHandle = null;
        sessionStorage.removeItem(RESUME);
      }
      state('closed', `${e.code} ${e.reason}`);
    };
    socket.onerror = () => state('error', 'socket');
  }

  return {
    connect,
    /** Something SLOP should know, without forcing him to answer right now. */
    note(text) {
      send({ clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: false } });
    },
    /** Something that should make him answer. */
    say(text) {
      send({ clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true } });
    },
    /** Loudness of his voice right now, 0..1. Read it every frame. */
    level() {
      if (!analyser) return 0;
      analyser.getFloatTimeDomainData(levelBuf);
      let sum = 0;
      for (let i = 0; i < levelBuf.length; i++) sum += levelBuf[i] * levelBuf[i];
      return Math.min(1, Math.sqrt(sum / levelBuf.length) * 5);
    },
    mute(on) {
      if (mic) mic.muted = on;
    },
    get muted() {
      return Boolean(mic?.muted);
    },
    get open() {
      return ready;
    },
    close() {
      ready = false;
      socket?.close(1000);
      stopPlayback();
    },
  };
}
