#!/usr/bin/env bash
# Everything on Google Cloud in one go (docs/setup.md, part 1). Run from Cloud Shell in the
# project that holds the credits:
#   git clone --depth 1 https://github.com/addvaluewithai-hub/ops 2>/dev/null || git -C ops pull; bash ops/media/setup.sh
# 1. makes SLOP_TOKEN (once) and keeps it in Secret Manager
# 2. deploys slop-media (deploy.sh)
# 3. makes one test picture
# 4. prints the two values the rest of the setup needs: MEDIA_URL and SLOP_TOKEN
# Safe to run again: it keeps the existing token and redeploys.
set -euo pipefail
export PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"
export REGION="${REGION:-europe-west1}"
SERVICE="${SERVICE:-slop-media}"
[ -n "$PROJECT_ID" ] || { echo "No project selected: gcloud config set project <id>"; exit 1; }
echo "== Project $PROJECT_ID"

gcloud services enable secretmanager.googleapis.com --project="$PROJECT_ID"
if gcloud secrets describe SLOP_TOKEN --project="$PROJECT_ID" >/dev/null 2>&1; then
  echo "== SLOP_TOKEN already exists; keeping it"
else
  echo "== Making SLOP_TOKEN"
  openssl rand -hex 32 | tr -d '\n' | gcloud secrets create SLOP_TOKEN --data-file=- --project="$PROJECT_ID"
fi

bash "$(dirname "$0")/deploy.sh"

URL="$(gcloud run services describe "$SERVICE" --project="$PROJECT_ID" --region="$REGION" --format='value(status.url)')"
TOKEN="$(gcloud secrets versions access latest --secret=SLOP_TOKEN --project="$PROJECT_ID")"

echo "== Reaching the service"
HEALTH="$(curl -sS --max-time 60 "$URL/health" || true)"
if [ "$HEALTH" != '{"ok":true}' ]; then
  echo "Cloud Run itself refuses calls (it answered: $(echo "$HEALTH" | grep -o '<title>[^<]*' | sed 's/<title>//'))."
  echo "The organisation policy probably does not allow a public service. Send this output to Claude:"
  gcloud run services describe "$SERVICE" --project="$PROJECT_ID" --region="$REGION" \
    --format='value(metadata.annotations)' | tr ';' '\n' | grep -i invoker || true
  gcloud resource-manager org-policies list --project="$PROJECT_ID" --format='value(constraint)' 2>/dev/null | grep -iE 'run|iam' || true
  exit 1
fi
echo "   ok"

echo "== Test picture (the first one also wakes the service up)"
set +e
CODE="$(curl -sS --max-time 120 -D /tmp/slop-headers -o slop-test.png -w '%{http_code}' \
  -X POST "$URL/image" -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"prompt":"macro photo of a single furious bloodshot eye floating in pure black, wet, red veins, hard rim light","aspect":"1:1"}')"
set -e
if [ "$CODE" = "200" ]; then
  MODEL="$(grep -i '^x-model:' /tmp/slop-headers | cut -d' ' -f2 | tr -d '\r')"
  MS="$(grep -i '^x-ms:' /tmp/slop-headers | cut -d' ' -f2 | tr -d '\r')"
  PICTURE="ok: $MODEL in ${MS} ms (open slop-test.png in the Cloud Shell editor)"
else
  PICTURE="FAILED ($CODE): $(head -c 400 slop-test.png)"
  if grep -q 'no image model available' slop-test.png 2>/dev/null; then
    PICTURE="$PICTURE
   Find the image model's ID in Vertex AI > Model Garden, then run:
   IMAGE_MODELS=<model-id> bash ops/media/setup.sh"
  fi
fi

cat <<EOF

================================================================
 Picture:  $PICTURE

 Keep these two values private. They go to the VPS agent, and
 SLOP_TOKEN also goes into Cloudflare Pages.

 MEDIA_URL=$URL
 SLOP_TOKEN=$TOKEN
================================================================
EOF
