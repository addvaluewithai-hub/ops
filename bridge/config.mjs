// The bridge's settings, all from /etc/slop-bridge.env on the VPS (docs/setup.md, part 2).
import { homedir } from 'node:os';
import { join } from 'node:path';

export function bridgeConfig(env = process.env) {
  return {
    port: Number(env.PORT) || 8787,
    host: env.HOST || '127.0.0.1',
    // One shared secret: the browser login, the media service, the Pages redirect.
    token: env.SLOP_TOKEN || '',
    mediaUrl: (env.MEDIA_URL || '').replace(/\/$/, ''),
    geminiKey: env.GEMINI_API_KEY || '',
    liveModel: env.GEMINI_LIVE_MODEL || 'gemini-3.8-live',
    // A Gemini prebuilt voice. Fenrir is the gravelly one.
    voice: env.SLOP_VOICE || 'Fenrir',
    claudeBin: env.CLAUDE_BIN || 'claude',
    claudeModel: env.CLAUDE_MODEL || 'opus',
    claudeEffort: env.CLAUDE_EFFORT || 'high',
    claudeMaxTurns: Number(env.CLAUDE_MAX_TURNS) || 60,
    claudeTimeoutMs: Number(env.CLAUDE_TIMEOUT_MS) || 15 * 60 * 1000,
    projectsDir: env.PROJECTS_DIR || join(homedir(), 'projects'),
    // quick: a free trycloudflare.com address, announced to the Pages site. off: none.
    tunnel: env.TUNNEL === 'off' ? 'off' : 'quick',
    cloudflaredBin: env.CLOUDFLARED_BIN || 'cloudflared',
    pagesUrl: (env.PAGES_URL || '').replace(/\/$/, ''),
  };
}
