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

## The stage

Open the bridge (through the Pages address) and press **WAKE HIM**. The browser asks for the
microphone; then he talks. Keys, for the operator, never shown on camera:

| Key | Does |
| --- | --- |
| `O` | operator panel (voice state, mic, what is building, mood) |
| `M` | mute the microphone |
| `S` | show or hide the site |
| `1`–`9` | force a mood (calm, thinking, bored, suspicious, contempt, angry, furious, surprised, pleased) |
| `R` | reconnect the voice |
| `C` | captions on or off |

`bridge/persona.md` is who he is; `bridge/tools.mjs` is what he can do (`set_mood`, `look_at`,
`build`, `show_site`); `bridge/public/eye.js` is his face; `bridge/public/stage.js` wires the
three together. `/check.html` is the plain setup check page.

## Status

- [x] Infrastructure: bridge, slop-media, Pages redirect, setup check page
- [x] The eye: WebGL eyeball with moods, saccades, blinks, audio-reactive pupil
- [x] SLOP's persona and tools on Gemini Live, non-blocking builds with live intern notes
- [ ] Webcam head tracking; SLOP sees screenshots of what the intern built
- [ ] Clips in sections (poster first, Veo after), choreography pass, ship to Pages
