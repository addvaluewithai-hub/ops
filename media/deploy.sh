#!/usr/bin/env bash
# Deploys slop-media as a Cloud Run SERVICE (docs/setup.md, part 1). Run from Cloud Shell in
# the project that holds the credits (the same one as learn-media):  bash ops/media/deploy.sh
# It never prints a secret; the SLOP_TOKEN secret is created before (see the doc).
# Optional: MIN_INSTANCES=1 (no cold start, for recording days), IMAGE_MODELS, VIDEO_MODEL.
set -euo pipefail
PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project)}"
REGION="${REGION:-europe-west1}"
SERVICE="${SERVICE:-slop-media}"
SA_NAME="${SA_NAME:-slop-media}"
SA="$SA_NAME@$PROJECT_ID.iam.gserviceaccount.com"
MIN_INSTANCES="${MIN_INSTANCES:-0}"
cd "$(dirname "$0")"

echo "== APIs"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com aiplatform.googleapis.com --project="$PROJECT_ID"

echo "== Service account $SA"
gcloud iam service-accounts describe "$SA" --project="$PROJECT_ID" >/dev/null 2>&1 \
  || gcloud iam service-accounts create "$SA_NAME" --project="$PROJECT_ID" --display-name="SLOP media"
for role in roles/aiplatform.user roles/secretmanager.secretAccessor; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$SA" --role="$role" --quiet >/dev/null
done

echo "== The build account may build from source (new projects do not grant it)"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
  --role=roles/cloudbuild.builds.builder --quiet >/dev/null

echo "== The secret SLOP_TOKEN must exist (see the doc)"
gcloud secrets describe SLOP_TOKEN --project="$PROJECT_ID" >/dev/null

# "^;^" makes ";" the separator, because IMAGE_MODELS is a comma-separated list.
VARS="^;^GCP_PROJECT_ID=$PROJECT_ID"
if [ -n "${IMAGE_MODELS:-}" ]; then VARS="$VARS;IMAGE_MODELS=$IMAGE_MODELS"; fi
if [ -n "${VIDEO_MODEL:-}" ]; then VARS="$VARS;VIDEO_MODEL=$VIDEO_MODEL"; fi

echo "== Service $SERVICE (min instances: $MIN_INSTANCES)"
# Public URL, but every route except /health checks the SLOP_TOKEN bearer itself.
gcloud run deploy "$SERVICE" --source . --project="$PROJECT_ID" --region="$REGION" \
  --service-account="$SA" --allow-unauthenticated \
  --memory=512Mi --cpu=1 --cpu-boost --concurrency=40 --timeout=300 \
  --min-instances="$MIN_INSTANCES" --max-instances=4 \
  --set-env-vars="$VARS" \
  --set-secrets="SLOP_TOKEN=SLOP_TOKEN:latest"

URL="$(gcloud run services describe "$SERVICE" --project="$PROJECT_ID" --region="$REGION" --format='value(status.url)')"
echo "== Done. MEDIA_URL=$URL"
echo "   Check:  curl -s $URL/health   (should print {\"ok\":true})"
