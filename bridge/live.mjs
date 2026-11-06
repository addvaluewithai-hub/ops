// Gemini Live tokens, the same way new-learn does it (apps/platform/server/providers/gemini/
// live.ts): the bridge holds GEMINI_API_KEY and mints a single-use token with the session's
// setup locked in; the browser opens the Live WebSocket with that token and never sees the key.

/** Gemini's function declarations spell JSON Schema types in capitals. */
export function geminiSchema(value) {
  if (Array.isArray(value)) return value.map(geminiSchema);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, inner] of Object.entries(value))
    out[key] =
      key === 'type' && typeof inner === 'string'
        ? inner.toUpperCase()
        : key === 'enum' || key === 'required'
          ? inner
          : geminiSchema(inner);
  return out;
}

/**
 * The bidi setup. Tools are NON_BLOCKING unless marked blocking: SLOP keeps talking while the
 * intern builds, and the result arrives later as a note.
 */
export function liveSetup({ instruction, voice = 'Fenrir', tools = [] }) {
  return {
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
    },
    systemInstruction: { parts: [{ text: instruction }] },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    // Long recording takes: the server compresses old turns instead of ending the session.
    contextWindowCompression: { slidingWindow: {} },
    sessionResumption: {},
    ...(tools.length
      ? {
          tools: [
            {
              functionDeclarations: tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                behavior: tool.blocking ? 'BLOCKING' : 'NON_BLOCKING',
                parameters: geminiSchema(tool.parameters),
              })),
            },
          ],
        }
      : {}),
  };
}

export async function mintLiveToken({ key, model, setup }, fetcher = fetch) {
  if (!key) throw new Error('GEMINI_API_KEY is not set');
  const response = await fetcher('https://generativelanguage.googleapis.com/v1beta/auth_tokens', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      uses: 1,
      expireTime: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      newSessionExpireTime: new Date(Date.now() + 60 * 1000).toISOString(),
      bidiGenerateContentSetup: { model: `models/${model}`, ...setup },
    }),
  });
  if (!response.ok)
    throw new Error(`live token: ${response.status} ${(await response.text()).slice(0, 200)}`);
  const token = await response.json();
  if (typeof token.name !== 'string') throw new Error('live token: no token in the reply');
  return { token: token.name, model, setup };
}
