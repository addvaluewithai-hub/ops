# slop-media (docs/setup.md, part 1): Node built-ins only, a non-root user, no keys.
FROM node:22-bookworm-slim
RUN useradd --create-home --shell /bin/bash media
USER media
WORKDIR /home/media
COPY --chown=media:media google.mjs vertex.mjs server.mjs ./
ENV NODE_ENV=production
CMD ["node", "server.mjs"]
