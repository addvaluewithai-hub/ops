# Setting SLOP up

Three parts, in this order, because each one gives the next an address:

1. **Google Cloud** (Cloud Shell, about 5 minutes): `slop-media`, the service that makes pictures
   and clips on Vertex AI. It gives you `MEDIA_URL`.
2. **Cloudflare Pages** (the dashboard, about 5 minutes): `slop.pages.dev`, a fixed address that
   always sends you to the bridge. It gives you `PAGES_URL`.
3. **The VPS** (SSH, about 10 minutes): the bridge, which runs Claude Code, serves the live
   preview and opens the tunnel.

Merge the pull request first: Cloud Shell and the VPS clone `main`, and Pages deploys `main`.

**This repository is public.** No token, key or address goes in it, ever.

## Before you start: one token

SLOP uses one shared secret, `SLOP_TOKEN`. Make it once, anywhere (Cloud Shell is fine), and
keep it in your password manager:

```bash
openssl rand -hex 32
```

It goes into four places: Google Secret Manager (part 1), the Pages project (part 2), the VPS
environment file (part 3), and your browser the first time you open SLOP.

---

## Part 1: Google Cloud, `slop-media`

Why a new service: `learn-media` is a Cloud Run **job**. The scheduler starts it once a minute
and it works through new-learn's queue. `slop-media` is a Cloud Run **service**, which answers
the moment it is called. It lives in the same project, bills the same credits and uses Vertex
with no key, like `learn-media`. `learn-media` is not touched.

Open **Cloud Shell** in the project that holds the credits (the same one as `learn-media`) and
paste these lines. The second asks for the token: paste it with Ctrl+Shift+V (nothing shows),
press Enter, and it must print `Created version [1]`.

```bash
gcloud services enable secretmanager.googleapis.com
read -s -p "SLOP_TOKEN: " T; echo; printf %s "$T" | gcloud secrets create SLOP_TOKEN --data-file=- ; unset T
git clone --depth 1 https://github.com/addvaluewithai-hub/ops && bash ops/media/deploy.sh
```

The deploy may ask once to create an image repository; answer `Y`. At the end it prints
`MEDIA_URL=https://slop-media-....run.app`. **Write that address down** for part 3.

**Check that a picture works** (it asks for the token again):

```bash
URL=<the MEDIA_URL>
read -s -p "SLOP_TOKEN: " T; echo
curl -sS -D - -o test.png -X POST "$URL/image" -H "Authorization: Bearer $T" \
  -H 'content-type: application/json' -d '{"prompt":"a furious red eye, macro photo","aspect":"1:1"}' \
  | grep -iE '^(HTTP|x-model|x-ms)'; unset T
```

It should print `HTTP/2 200`, the model that made the picture (`x-model`) and the time it took
in milliseconds (`x-ms`). Open `test.png` from Cloud Shell's editor to look at it.

- **`no image model available`:** the project does not have the default model IDs. Find the
  exact ID of Nano Banana 2 Lite (or whichever image model you want) in Vertex AI → Model
  Garden, then deploy again with it:
  `IMAGE_MODELS=<model-id> bash ops/media/deploy.sh`. A list works too, comma-separated, tried
  in order.
- **Video** uses Veo in `us-central1` (`veo-3.1-fast-generate-001` by default). To pick another:
  `VIDEO_MODEL=<model-id> bash ops/media/deploy.sh`.

**On recording days**, remove the cold start (it costs a little while it is on):

```bash
gcloud run services update slop-media --region=europe-west1 --min-instances=1
# afterwards:
gcloud run services update slop-media --region=europe-west1 --min-instances=0
```

**Updating it later:** `git -C ops pull && bash ops/media/deploy.sh` in Cloud Shell.

---

## Part 2: Cloudflare Pages, `slop.pages.dev`

Why: a `pages.dev` address cannot be pointed at a tunnel, because tunnels need a domain of your
own. So the bridge uses Cloudflare's free quick tunnel, whose `trycloudflare.com` address changes
every time it starts. Each time the bridge starts, it tells this small Pages site its new address.
`slop.pages.dev` is the one address you remember: it asks for your token once and sends you on.

1. **The site.** Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect
   to Git** → `addvaluewithai-hub/ops`. Set:
   - Project name: `slop` (if it is taken, Cloudflare gives you another, such as
     `slop-abc.pages.dev`; use that address everywhere below)
   - Production branch: `main`
   - Framework preset: **None**, build command: *(empty)*
   - **Root directory: `pages`**, build output directory: `public`

   Save and deploy.
2. **The storage.** **Storage & Databases** → **KV** → **Create** a namespace named `slop`.
3. **Bind it.** The `slop` Pages project → **Settings** → **Bindings** → **Add** → **KV namespace**:
   variable name `SLOP_KV`, namespace `slop`.
4. **The token.** The same project → **Settings** → **Variables and Secrets** → **Add** → type
   **Secret**, name `SLOP_TOKEN`, value: your token.
5. **Redeploy** so the binding and the secret take effect: **Deployments** → the latest one →
   **⋯** → **Retry deployment**.
6. **Check:** `curl -s https://slop.pages.dev/api/bridge` prints `{"url":""}`. The URL is empty
   until the bridge runs.

---

## Part 3: the VPS, the bridge

Same server as new-learn's builder, beside it: its own user `slop`, its own service
`slop-bridge`, its own folder `/srv/slop`. It **never touches** `new-learn-builder` or
`wp-slack-agent`. It reads one line from the builder's environment file (step 5) and changes
nothing there.

1. **User and folder:**
   ```bash
   sudo useradd --system --create-home --shell /bin/bash slop
   sudo mkdir -p /srv/slop && sudo chown slop: /srv/slop
   ```
2. **The code** (Node 22 is already on the server for the builder):
   ```bash
   sudo -u slop -H git clone --depth 1 https://github.com/addvaluewithai-hub/ops /srv/slop/app
   sudo -u slop -H bash -c 'cd /srv/slop/app && npm ci --omit=dev'
   ```
3. **Claude Code for `slop`** (its own copy, in its home):
   ```bash
   sudo -u slop -H bash -c 'curl -fsSL https://claude.ai/install.sh | bash'
   sudo -u slop -H bash -c '~/.local/bin/claude --version'
   ```
4. **cloudflared** (`uname -m` says `x86_64` → `amd64`, `aarch64` → `arm64`):
   ```bash
   curl -fsSL -o /tmp/cloudflared.deb \
     https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
   sudo dpkg -i /tmp/cloudflared.deb && cloudflared --version
   ```
   There is no `cloudflared login` and no Cloudflare account setup: a quick tunnel needs neither.
5. **The environment file.** Create it, readable by root only:
   ```bash
   sudo install -m 600 -o root -g root /dev/null /etc/slop-bridge.env
   sudo grep '^CLAUDE_CODE_OAUTH_TOKEN=' /etc/new-learn-builder.env | sudo tee -a /etc/slop-bridge.env >/dev/null
   sudo nano /etc/slop-bridge.env
   ```
   The second line copies the Claude account token the builder already uses. Then add these
   lines in nano (Ctrl+O, Enter, Ctrl+X to save):
   ```
   SLOP_TOKEN=<your token>
   MEDIA_URL=<the MEDIA_URL from part 1>
   PAGES_URL=https://slop.pages.dev
   GEMINI_API_KEY=<from aistudio.google.com/apikey, the same kind of key new-learn uses>
   CLAUDE_MODEL=sonnet
   ```
   `sudo grep -c . /etc/slop-bridge.env` should print `6`. If the builder signs in with
   `claude auth login` instead of a token, the grep line adds nothing (it prints `5`); then sign
   in once for `slop`: `sudo -u slop -H bash -c 'cd /tmp && ~/.local/bin/claude auth login'`.
6. **Claude Code works for `slop`**, with exactly the service's environment:
   ```bash
   sudo systemd-run --pty --wait --uid=slop --working-directory=/tmp \
     -p EnvironmentFile=/etc/slop-bridge.env -p Environment=HOME=/home/slop \
     /home/slop/.local/bin/claude -p "Reply with the single word OK" --output-format json --max-turns 1 --tools ""
   ```
   The JSON should have `"result":"OK"` and `"is_error":false`.
7. **Start the service:**
   ```bash
   sudo cp /srv/slop/app/bridge/slop-bridge.service /etc/systemd/system/
   sudo systemctl daemon-reload && sudo systemctl enable --now slop-bridge
   sudo journalctl -u slop-bridge -n 20 --no-pager
   ```
   Within about ten seconds the log should show:
   ```
   bridge on http://127.0.0.1:8787, project /home/slop/projects/demo
   media on, live on
   bridge at https://<random-words>.trycloudflare.com
   announced to https://slop.pages.dev
   ```
8. **Open `https://slop.pages.dev`** and type your token once. It takes you to the setup check
   page. Press the three buttons:
   - **Wake him up**: you hear one rude sentence (Gemini Live works).
   - **Generate**: a picture appears, with the time it took (Vertex works).
   - **Build the wireframe**, then **Then build the hero**: the preview on the right fills in
     live, grey boxes first (Claude Code works). The hero's picture fills in a few seconds
     after the hero itself.

**Updating the bridge later:**
```bash
sudo -u slop -H git -C /srv/slop/app pull
sudo -u slop -H bash -c 'cd /srv/slop/app && npm ci --omit=dev'
sudo systemctl restart slop-bridge
```

**If something fails**, `sudo journalctl -u slop-bridge -n 50 --no-pager` shows why. Common ones:
- `Not logged in` / `Failed to authenticate`: the Claude token is missing or expired (step 5).
- `hit your session limit` / `weekly limit`: SLOP shares the Claude account's limits with
  new-learn's builder.
- `could not announce to Pages: pages said 401`: `SLOP_TOKEN` differs between the VPS and Pages.
- `media 401`: `SLOP_TOKEN` differs between the VPS and Secret Manager.
- `cloudflared exited`: it retries by itself. If it keeps failing, check the server can reach
  `https://api.trycloudflare.com`.
