// The way in from the internet without opening a port: cloudflared makes an outbound
// connection and Cloudflare gives it a free https://<random>.trycloudflare.com address. That
// address changes on every restart, so the bridge tells the Pages site (slop.pages.dev), which
// always redirects to the current one.
import { spawn } from 'node:child_process';

export const TUNNEL_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

export async function announce({ pagesUrl, token }, url, fetcher = fetch) {
  if (!pagesUrl) return false;
  const response = await fetcher(`${pagesUrl}/api/bridge`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  if (!response.ok) throw new Error(`pages said ${response.status}`);
  return true;
}

/** Runs cloudflared for as long as the bridge runs; onUrl gets each new address. */
export function startTunnel(config, onUrl, spawner = spawn) {
  let stopped = false;
  let child;
  let delay = 2000;
  const launch = () => {
    child = spawner(
      config.cloudflaredBin,
      ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${config.port}`],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let seen = '';
    const read = (chunk) => {
      const url = TUNNEL_URL.exec(String(chunk))?.[0];
      if (url && url !== seen) {
        seen = url;
        delay = 2000;
        onUrl(url);
      }
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    child.once('error', (error) => console.error(`cloudflared: ${error.message}`));
    child.once('close', (code) => {
      if (stopped) return;
      console.error(`cloudflared exited ${code}; again in ${delay / 1000}s`);
      setTimeout(launch, delay);
      delay = Math.min(delay * 2, 60_000);
    });
  };
  launch();
  return () => {
    stopped = true;
    child?.kill('SIGTERM');
  };
}
