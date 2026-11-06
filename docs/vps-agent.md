# SLOP bridge: setup for the server agent

You are the agent with access to the VPS that already runs New Learn's course builder
(`new-learn-builder`) and `wp-slack-agent`. This file is everything you need to install a third,
separate service beside them: the **SLOP bridge**. It runs Claude Code on request, serves a live
website preview, and makes itself reachable through a Cloudflare quick tunnel (outbound only,
no port opened).

Code: https://github.com/addvaluewithai-hub/ops (public). The bridge is in `bridge/`.

## What the owner gives you (privately, never in a file in a repository)

| Value | What it is |
| --- | --- |
| `SLOP_TOKEN` | The shared secret, a 64-character hex string |
| `MEDIA_URL` | `https://slop-media-....run.app`, the picture service on Google Cloud |
| `GEMINI_API_KEY` | A Gemini API key from Google AI Studio |
| `PAGES_URL` | Optional. `https://slop.pages.dev` unless the owner says otherwise |

## Rules

- **Do not touch `wp-slack-agent` or `new-learn-builder`:** no restarts, no edits, no changes to
  their users, files, logins or services. The only thing you do with the builder is *read* one
  line from `/etc/new-learn-builder.env` (step 5).
- **Never print, log, commit or paste a secret** (`SLOP_TOKEN`, `GEMINI_API_KEY`,
  `CLAUDE_CODE_OAUTH_TOKEN`). Write "done", "ok" or the error text instead. Also leave out IP
  addresses and hostnames, except the `trycloudflare.com` address in step 7.
- **If a command fails,** write its error in the Report and stop at that step. Do not work
  around it and do not edit the bridge's code.

## Steps

1. **Check the machine:**
   ```bash
   node -v; npm -v; uname -m
   ```
   Node must be 22 or newer. Write the three outputs in the Report.

2. **User and folder:**
   ```bash
   sudo useradd --system --create-home --shell /bin/bash slop
   sudo mkdir -p /srv/slop && sudo chown slop: /srv/slop
   ```

3. **The code:**
   ```bash
   sudo -u slop -H git clone --depth 1 https://github.com/addvaluewithai-hub/ops /srv/slop/app
   sudo -u slop -H bash -c 'cd /srv/slop/app && npm ci --omit=dev'
   ls /srv/slop/app/bridge
   ```
   The listing should include `index.mjs` and `slop-bridge.service`.

4. **Claude Code for `slop`** (its own copy in its home, no sudo inside):
   ```bash
   sudo -u slop -H bash -c 'curl -fsSL https://claude.ai/install.sh | bash'
   sudo -u slop -H bash -c '~/.local/bin/claude --version'
   ```
   Write the version in the Report.

5. **cloudflared.** Use `amd64` if step 1 printed `x86_64`, or `arm64` if it printed `aarch64`:
   ```bash
   curl -fsSL -o /tmp/cloudflared.deb \
     https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
   sudo dpkg -i /tmp/cloudflared.deb && cloudflared --version
   ```
   Do not run `cloudflared login` or create a named tunnel: the quick tunnel needs neither.

6. **The environment file** (root only). The second line copies the Claude account token the
   builder already uses. Then put the owner's values in place of the `<...>` (without showing them):
   ```bash
   sudo install -m 600 -o root -g root /dev/null /etc/slop-bridge.env
   sudo grep '^CLAUDE_CODE_OAUTH_TOKEN=' /etc/new-learn-builder.env | sudo tee -a /etc/slop-bridge.env >/dev/null
   sudo bash -c 'cat >> /etc/slop-bridge.env' <<'EOF'
   SLOP_TOKEN=<from the owner>
   MEDIA_URL=<from the owner>
   GEMINI_API_KEY=<from the owner>
   PAGES_URL=https://slop.pages.dev
   CLAUDE_MODEL=sonnet
   EOF
   sudo grep -o '^[A-Z_]*=' /etc/slop-bridge.env
   ```
   The last command lists the six names without their values: `CLAUDE_CODE_OAUTH_TOKEN=`,
   `SLOP_TOKEN=`, `MEDIA_URL=`, `GEMINI_API_KEY=`, `PAGES_URL=`, `CLAUDE_MODEL=`. Write that list
   in the Report. If `CLAUDE_CODE_OAUTH_TOKEN=` is missing (the builder signed in with
   `claude auth login` instead), sign `slop` in the same way:
   `sudo -u slop -H bash -c 'cd /tmp && ~/.local/bin/claude auth login'`. It prints a link: give
   it to the owner to open, and paste the code they send back.

7. **Claude Code works for `slop`,** with exactly the service's environment:
   ```bash
   sudo systemd-run --pipe --wait --quiet --collect --uid=slop --working-directory=/tmp \
     -p EnvironmentFile=/etc/slop-bridge.env -p Environment=HOME=/home/slop \
     /home/slop/.local/bin/claude -p "Reply with the single word OK" --output-format json --max-turns 1 --tools ""
   ```
   The JSON should contain `"result":"OK"` and `"is_error":false`. Write those two fields in the
   Report. If this systemd version rejects `EnvironmentFile` here, write that and go on to step 8:
   the service checks the same thing.

8. **Start the service:**
   ```bash
   sudo cp /srv/slop/app/bridge/slop-bridge.service /etc/systemd/system/
   sudo systemctl daemon-reload && sudo systemctl enable --now slop-bridge
   sleep 15; systemctl is-active slop-bridge
   sudo journalctl -u slop-bridge -n 20 --no-pager
   ```
   It should print `active`, then log lines like:
   ```
   bridge on http://127.0.0.1:8787, project /home/slop/projects/demo
   media on, live on
   bridge at https://<random-words>.trycloudflare.com
   announced to https://slop.pages.dev
   ```
   Copy these lines into the Report (the `trycloudflare.com` address is fine to share with the
   owner). If the owner has not finished Cloudflare Pages yet, the last line reads
   `could not announce to Pages: ...`. That is expected: it works on the next restart once Pages
   is ready (`sudo systemctl restart slop-bridge`).

9. **Tell the owner it is ready.** They open `https://slop.pages.dev`, or directly
   `https://<random-words>.trycloudflare.com/?key=<SLOP_TOKEN>`, and press the three test buttons.

## Later: updating the bridge

When the owner asks:
```bash
sudo -u slop -H git -C /srv/slop/app pull
sudo -u slop -H bash -c 'cd /srv/slop/app && npm ci --omit=dev'
sudo systemctl restart slop-bridge
sudo journalctl -u slop-bridge -n 10 --no-pager
```

## If the log shows an error

| Log says | Meaning |
| --- | --- |
| `SLOP_TOKEN is not set` | Step 6: the line is missing from the environment file |
| `Not logged in`, `Failed to authenticate` | The Claude token is missing or expired (step 6) |
| `hit your session limit`, `weekly limit` | The Claude account's usage limit, shared with the builder; wait |
| `could not announce to Pages: pages said 401` | `SLOP_TOKEN` differs between this server and Cloudflare Pages |
| `media 401` | `SLOP_TOKEN` differs between this server and Google Cloud |
| `cloudflared exited ...; again in ...` | It retries by itself. If it never shows an address, check `curl -sI https://api.trycloudflare.com` |

## Report (fill in and send back to the owner)

| Step | Result (no secrets, IPs or hostnames) |
| --- | --- |
| 1 | |
| 2 | |
| 3 | |
| 4 | |
| 5 | |
| 6 | |
| 7 | |
| 8 | |
| 9 | |
