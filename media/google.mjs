// Google Cloud access tokens without any key (docs/worker-cloud-run.md): inside Cloud Run the
// metadata server hands out the job's service-account token. For a run outside Google Cloud a
// service-account JSON file (GOOGLE_APPLICATION_CREDENTIALS) or a ready token
// (GOOGLE_ACCESS_TOKEN) works too. Node built-ins only.
import { createSign } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
let cached = { token: '', expires: 0 };

export async function accessToken(env = process.env, fetcher = fetch) {
  if (cached.token && Date.now() < cached.expires - 60_000) return cached.token;
  if (env.GOOGLE_ACCESS_TOKEN) return env.GOOGLE_ACCESS_TOKEN;
  const got = env.GOOGLE_APPLICATION_CREDENTIALS
    ? await fromKeyFile(env.GOOGLE_APPLICATION_CREDENTIALS, fetcher)
    : await fromMetadata(fetcher);
  cached = { token: got.access_token, expires: Date.now() + got.expires_in * 1000 };
  return cached.token;
}

async function fromMetadata(fetcher) {
  const response = await fetcher(
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
    { headers: { 'Metadata-Flavor': 'Google' } },
  );
  if (!response.ok) throw new Error(`metadata server: ${response.status}`);
  return response.json();
}

async function fromKeyFile(path, fetcher) {
  const key = JSON.parse(await readFile(path, 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: key.client_email,
    scope: SCOPE,
    aud: key.token_uri,
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(key.private_key, 'base64url');
  const response = await fetcher(key.token_uri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }),
  });
  if (!response.ok) throw new Error(`token exchange: ${response.status}`);
  return response.json();
}

/** For tests: forget the cached token. */
export const forgetToken = () => (cached = { token: '', expires: 0 });
