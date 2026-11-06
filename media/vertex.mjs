// Pictures and clips on Vertex AI (docs/setup.md, part 1). Called by server.mjs with a
// service-account token; no key anywhere. Model IDs come from the environment and are tried
// in order, so a model the project does not have yet falls through to the next one.

const host = (region) =>
  region === 'global' ? 'aiplatform.googleapis.com' : `${region}-aiplatform.googleapis.com`;

const modelUrl = ({ project, region, model }, verb) =>
  `https://${host(region)}/v1/projects/${project}/locations/${region}/publishers/google/models/${model}:${verb}`;

const ASPECTS = new Set(['1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']);
export const aspectOf = (value) => (ASPECTS.has(value) ? value : '16:9');

async function post(url, token, body, fetcher) {
  return fetcher(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** One picture from a prompt. Returns { bytes, mimeType, model }. */
export async function generateImage(
  { prompt, aspect, project, region, models },
  { token, fetcher = fetch },
) {
  const errors = [];
  for (const model of models) {
    const response = await post(
      modelUrl({ project, region, model }, 'generateContent'),
      token,
      {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ['IMAGE'],
          imageConfig: { aspectRatio: aspectOf(aspect) },
        },
      },
      fetcher,
    );
    // 404: the project does not have this model; try the next one.
    if (response.status === 404) {
      errors.push(`${model}: 404`);
      continue;
    }
    if (!response.ok)
      throw new Error(`image ${model}: ${response.status} ${(await response.text()).slice(0, 300)}`);
    const data = await response.json();
    const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    if (!part) {
      const reason = data.candidates?.[0]?.finishReason ?? data.promptFeedback?.blockReason;
      throw new Error(`image ${model}: no picture in the reply${reason ? ` (${reason})` : ''}`);
    }
    return {
      bytes: Buffer.from(part.inlineData.data, 'base64'),
      mimeType: part.inlineData.mimeType || 'image/png',
      model,
    };
  }
  throw new Error(`no image model available: ${errors.join(', ')}`);
}

/**
 * Starts one clip. Veo is a long-running operation: this returns its name at once and
 * videoStatus() is asked until it is done. `image` (base64) makes the first frame.
 */
export async function startVideo(
  { prompt, image, imageType, aspect, seconds, project, region, model },
  { token, fetcher = fetch },
) {
  const instance = { prompt };
  if (image) instance.image = { bytesBase64Encoded: image, mimeType: imageType || 'image/png' };
  const response = await post(
    modelUrl({ project, region, model }, 'predictLongRunning'),
    token,
    {
      instances: [instance],
      parameters: {
        aspectRatio: aspect === '9:16' ? '9:16' : '16:9',
        durationSeconds: Math.min(8, Math.max(4, Number(seconds) || 8)),
        sampleCount: 1,
        generateAudio: false,
      },
    },
    fetcher,
  );
  if (!response.ok)
    throw new Error(`video ${model}: ${response.status} ${(await response.text()).slice(0, 300)}`);
  const data = await response.json();
  if (typeof data.name !== 'string') throw new Error(`video ${model}: no operation in the reply`);
  return { op: data.name };
}

/** Where a clip is: { done: false } or { done: true, bytes, mimeType }. */
export async function videoStatus({ op, project, region, model }, { token, fetcher = fetch }) {
  const response = await post(
    modelUrl({ project, region, model }, 'fetchPredictOperation'),
    token,
    { operationName: op },
    fetcher,
  );
  if (!response.ok)
    throw new Error(`video status: ${response.status} ${(await response.text()).slice(0, 300)}`);
  const data = await response.json();
  if (!data.done) return { done: false };
  if (data.error) throw new Error(`video failed: ${data.error.message ?? 'unknown error'}`);
  const video = data.response?.videos?.[0];
  if (!video?.bytesBase64Encoded) {
    const filtered = data.response?.raiMediaFilteredReasons?.join('; ');
    throw new Error(`video: no clip in the reply${filtered ? ` (${filtered})` : ''}`);
  }
  return {
    done: true,
    bytes: Buffer.from(video.bytesBase64Encoded, 'base64'),
    mimeType: video.mimeType || 'video/mp4',
  };
}
