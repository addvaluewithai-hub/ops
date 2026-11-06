// Starts the SLOP bridge on the VPS (docs/setup.md, part 2): the server, the file watcher
// that drives the live preview, and the tunnel that makes it reachable.
import { join } from 'node:path';
import { bridgeConfig } from './config.mjs';
import { mediaClient } from './media.mjs';
import { createBridge } from './server.mjs';
import { ensureProject, watchProject } from './site.mjs';
import { announce, startTunnel } from './tunnel.mjs';

const config = bridgeConfig();
if (!config.token) {
  console.error('SLOP_TOKEN is not set (see docs/setup.md); refusing to start.');
  process.exit(1);
}
const dir = join(config.projectsDir, config.project);
await ensureProject(dir);

const { server, broadcast, state } = createBridge({ config, dir, media: mediaClient(config) });
watchProject(dir, (path) => broadcast({ type: 'file', path }));

server.listen(config.port, config.host, () => {
  console.log(`bridge on http://${config.host}:${config.port}, project ${dir}`);
  console.log(`media ${config.mediaUrl ? 'on' : 'OFF (MEDIA_URL)'}, live ${config.geminiKey ? 'on' : 'OFF (GEMINI_API_KEY)'}`);
});

if (config.tunnel === 'quick')
  startTunnel(config, (url) => {
    state.tunnelUrl = url;
    console.log(`bridge at ${url}`);
    broadcast({ type: 'tunnel', url });
    announce(config, url)
      .then((sent) => sent && console.log(`announced to ${config.pagesUrl}`))
      .catch((error) => console.error(`could not announce to Pages: ${error.message}`));
  });
