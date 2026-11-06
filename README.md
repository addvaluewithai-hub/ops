# S.L.O.P.

*Spec-Less Output Prevention.* An angry floating eye that builds websites by talking to you
(Gemini Live) and bossing an intern around (Claude Code). It refuses vague specs, hates AI slop,
and keeps arguing with you while the intern codes, so you never sit and wait. Section by
section, the site appears live next to him.

A YouTube experiment, not a product.

## How it fits together

```
Browser ── Gemini Live (voice, tools)
   │
   └── ops-6yu.pages.dev ──► https://<random>.trycloudflare.com ──► VPS: bridge/
                          (Cloudflare quick tunnel, no open port)   ├─ claude -p, started instantly, streamed
                                                                    ├─ /site/: the website, live preview
                                                                    └─► Cloud Run: media/ (slop-media)
                                                                          ├─ /image → Nano Banana on Vertex
                                                                          └─ /video → Veo on Vertex
```

| Folder | What | Where it runs |
| --- | --- | --- |
| `bridge/` | HTTP and WebSocket server. Runs Claude Code per section, serves and live-reloads the site, fills `<img data-gen>` pictures, mints Gemini Live tokens, keeps the tunnel up | The VPS, as user `slop` |
| `media/` | Pictures and clips on Vertex AI. No key: the service account signs in | Cloud Run service `slop-media` |
| `pages/` | `ops-6yu.pages.dev`: remembers where the bridge is and sends you there | Cloudflare Pages |
| `docs/setup.md` | **Setting it all up, step by step** | |

## The website being built

One folder per project (`~/projects/<name>` on the VPS): `site.json` (section order),
`tokens.css` (design system), `sections/<id>.html` (one file per section, so sections build in
parallel and edits stay local), `scripts.js` (scroll choreography), `img/`, `video/`. Plain HTML,
GSAP and ScrollTrigger. The intern's rules, including the anti-slop list, are in
`bridge/intern.md`.

## Develop

```bash
npm install
npm test
SLOP_TOKEN=dev TUNNEL=off PROJECTS_DIR=/tmp/slop npm run bridge   # then open http://127.0.0.1:8787/?key=dev
```

## Status

- [x] Infrastructure: bridge, slop-media, Pages redirect, setup check page
- [ ] The eye: WebGL eyeball, moods, webcam tracking
- [ ] SLOP's persona and tools on Gemini Live (build, edit, images, mood), non-blocking with live progress notes
- [ ] Clips in sections (poster first, Veo after), choreography pass, ship to Pages
