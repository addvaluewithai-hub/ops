// Starts the SLOP bridge on the VPS (docs/setup.md, part 2): the server over every site in
// PROJECTS_DIR, and the tunnel that makes it reachable.
import { mkdir } from 'node:fs/promises';
import { bridgeConfig } from './config.mjs';
import { mediaClient } from './media.mjs';
import { createBridge } from './server.mjs';
import { announce, startTunnel } from './tunnel.mjs';

const config = bridgeConfig();
if (!config.token) {
  console.error('SLOP_TOKEN is not set (see docs/setup.md); refusing to start.');
  process.exit(1);
}
await mkdir(config.projectsDir, { recursive: true });

const { server, broadcast, state } = createBridge({ config, projectsDir: config.projectsDir, media: mediaClient(config) });

server.listen(config.port, config.host, () => {
  console.log(`bridge on http://${config.host}:${config.port}, sites in ${config.projectsDir}`);
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
