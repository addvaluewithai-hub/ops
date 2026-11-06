# Setting SLOP up

Three parts, in this order:

1. **Google Cloud**: one command in Cloud Shell. It gives you `MEDIA_URL` and `SLOP_TOKEN`.
2. **Cloudflare Pages**: `ops-6yu.pages.dev`, the fixed address that always finds the bridge.
3. **The VPS**: send `docs/vps-agent.md` to the server agent, with three values.

**This repository is public.** No token, key or address goes in it, ever.

---

## Part 1: Google Cloud (one command)

Open **Cloud Shell** in the project that holds the credits (the same one as `learn-media`) and
paste:

```bash
rm -rf ops && git clone --depth 1 https://github.com/addvaluewithai-hub/ops && bash ops/media/setup.sh
```

It does everything:
- Makes `SLOP_TOKEN` (only the first time) and keeps it in Secret Manager.
- Deploys `slop-media`, a Cloud Run **service** beside `learn-media`. It uses the same project,
  the same credits and keyless Vertex, and `learn-media` is not touched. If it asks once to
  create an image repository, answer `Y`.
- Makes one test picture.
- Ends with a box showing whether the picture worked, plus **`MEDIA_URL`** and **`SLOP_TOKEN`**.
  Keep both in your password manager.

Running it again is safe: it downloads a fresh copy of the code, keeps the token and redeploys.

- **Image models**, tried in this order (IDs from Google Cloud's model pages):
  `gemini-3.1-flash-lite-image` (Nano Banana 2 Lite, the fastest, 1K only),
  `gemini-3.1-flash-image` (Nano Banana 2, up to 4K), then `gemini-2.5-flash-image`. The box
  shows which one made the test picture. To choose others:
  `IMAGE_MODELS=<id>,<id> bash ops/media/setup.sh`.
- **Picture `FAILED` with `IMAGE_SAFETY`:** Google's filter refused that prompt. Pictures of
  gore, real people or weapons are refused; the intern is told to avoid them.
- **Video** uses Veo in `us-central1` (`veo-3.1-fast-generate-001` by default). To change it:
  `VIDEO_MODEL=<model-id> bash ops/media/setup.sh`.
- **Recording days:** turn off the cold start (it costs a little while it is on):
  `gcloud run services update slop-media --region=europe-west1 --min-instances=1`, and
  afterwards the same command with `--min-instances=0`.

---

## Part 2: Cloudflare Pages, `ops-6yu.pages.dev`

Why it exists: a `pages.dev` address cannot point at a tunnel (tunnels need a domain you own).
So the bridge uses Cloudflare's free quick tunnel, whose `trycloudflare.com` address changes on
every start. Each time the bridge starts, it tells this small Pages site its new address.
`ops-6yu.pages.dev` is the one address you remember: it asks for your token once and sends you on.

Merge the pull request first, because Pages deploys `main`.

1. **The site.** **Workers & Pages** → **Create** → **Pages** → **Connect to Git** →
   `addvaluewithai-hub/ops`. Set:
   - Project name: `slop` (if it is taken you get something like `slop-abc.pages.dev`; tell the
     VPS agent that address as `PAGES_URL`)
   - Production branch: `main`
   - Framework preset: **None**, build command: *(empty)*
   - **Root directory: `pages`**, **build output directory: `public`** (left empty, the page
     answers 404 at `/` and shows up at `/public/` instead)
2. **Storage.** **Storage & Databases** → **KV** → **Create** a namespace named `slop`.
3. **Bind it.** The Pages project → **Settings** → **Bindings** → **Add** → **KV namespace**:
   variable name **`SLOP_KV`**, namespace `slop`.
4. **The token.** **Settings** → **Variables and Secrets** → **Add** → type **Secret**, name
   **`SLOP_TOKEN`**, value: the token from part 1.
5. **Redeploy** so the binding and the secret take effect: **Deployments** → latest → **⋯** →
   **Retry deployment**.
6. **Check:** `https://ops-6yu.pages.dev/api/bridge` shows `{"url":""}` until the bridge runs.

---

## Part 3: the VPS

Send the server agent the file **[`docs/vps-agent.md`](vps-agent.md)** and, privately:
`SLOP_TOKEN` and `MEDIA_URL` from part 1, your `GEMINI_API_KEY` (from aistudio.google.com/apikey),
and `PAGES_URL` if it is not `https://ops-6yu.pages.dev`.

The file has the rules (it never touches `new-learn-builder` or `wp-slack-agent`), the nine
steps, what each one should print, and a report table to send back to you.

---

## Done: the setup check

Open `https://ops-6yu.pages.dev`, type the token once, and press the three buttons:

- **Wake him up**: one rude sentence out loud. Gemini Live works.
- **Generate**: a picture and how long it took. Vertex works.
- **Build the wireframe**, then **Then build the hero**: the preview on the right fills in live,
  grey boxes first, and the hero's picture lands a few seconds after the hero. Claude Code works.
