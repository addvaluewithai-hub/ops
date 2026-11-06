// Who may drive the bridge. The tunnel address is public, and the bridge runs Claude Code on
// the VPS, so everything except /health needs the SLOP_TOKEN: once as /?key=..., which leaves
// a cookie holding only a hash of it, or as a Bearer header for scripts.
import { createHash, timingSafeEqual } from 'node:crypto';

const COOKIE = 'slop';
const hash = (token) => createHash('sha256').update(`slop:${token}`).digest('hex');

function same(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

export function cookieOf(header, name = COOKIE) {
  for (const part of String(header ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return '';
}

export function allowed(req, token) {
  if (!token) return false;
  const bearer = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  if (bearer && same(bearer, token)) return true;
  const cookie = cookieOf(req.headers.cookie);
  return Boolean(cookie) && same(cookie, hash(token));
}

/** The Set-Cookie for a correct ?key=. Secure when the request came in over HTTPS. */
export function loginCookie(req, token) {
  const https =
    req.headers['x-forwarded-proto'] === 'https' || Boolean(req.headers['cf-connecting-ip']);
  return `${COOKIE}=${hash(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${https ? '; Secure' : ''}`;
}

export const keyMatches = (given, token) => Boolean(token && given && same(given, token));
