#!/usr/bin/env bash
# =============================================================================
# sprite-reporter.sh — Open-Dispatch Sidecar Entry Point
#
# Runs inside a Sprite (Fly Machine). Clones a repo, executes an agent command,
# and POSTs output back to Open-Dispatch via HTTP webhooks over Fly.io 6PN.
#
# Required env vars (injected by Open-Dispatch at spawn time):
#   JOB_ID              — Unique job identifier
#   JOB_TOKEN           — Job-scoped auth token for webhook validation
#   OPEN_DISPATCH_URL   — Webhook base URL (e.g., http://open-dispatch.internal:8080)
#   COMMAND             — Agent command to execute
#
# Optional env vars:
#   REPO                — GitHub repo to clone (owner/repo)
#   BRANCH              — Git branch (default: main)
#   GH_TOKEN            — GitHub token (for private repos and gh CLI)
#   ANTHROPIC_API_KEY   — For Claude-based agents
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

post_log() {
  local text="$1"
  curl -sf -X POST "${OPEN_DISPATCH_URL}/webhooks/logs" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${JOB_TOKEN}" \
    -d "$(jq -n --arg jobId "$JOB_ID" --arg text "$text" '{jobId: $jobId, text: $text}')" \
    >/dev/null 2>&1 || true
}

post_status() {
  local status="$1"
  local exit_code="${2:-0}"
  local error="${3:-}"
  curl -sf -X POST "${OPEN_DISPATCH_URL}/webhooks/status" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${JOB_TOKEN}" \
    -d "$(jq -n \
      --arg jobId "$JOB_ID" \
      --arg status "$status" \
      --argjson exitCode "$exit_code" \
      --arg error "$error" \
      '{jobId: $jobId, status: $status, exitCode: $exitCode, error: $error}')" \
    >/dev/null 2>&1 || true
}

post_artifact() {
  local name="$1"
  local url="$2"
  local type="${3:-url}"
  curl -sf -X POST "${OPEN_DISPATCH_URL}/webhooks/artifacts" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${JOB_TOKEN}" \
    -d "$(jq -n \
      --arg jobId "$JOB_ID" \
      --arg name "$name" \
      --arg url "$url" \
      --arg type "$type" \
      '{jobId: $jobId, artifacts: [{name: $name, url: $url, type: $type}]}')" \
    >/dev/null 2>&1 || true
}

# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

if [ -z "${JOB_ID:-}" ] || [ -z "${JOB_TOKEN:-}" ] || [ -z "${OPEN_DISPATCH_URL:-}" ]; then
  echo "[sprite-reporter] ERROR: Missing required env vars (JOB_ID, JOB_TOKEN, OPEN_DISPATCH_URL)"
  exit 1
fi

if [ -z "${COMMAND:-}" ]; then
  post_status "failed" 1 "No COMMAND specified"
  echo "[sprite-reporter] ERROR: No COMMAND specified"
  exit 1
fi

echo "[sprite-reporter] Job ${JOB_ID} starting"
post_status "running" 0

# ---------------------------------------------------------------------------
# Clone repository (if REPO is set)
# ---------------------------------------------------------------------------

WORKDIR="/workspace"
mkdir -p "$WORKDIR"

if [ -n "${REPO:-}" ]; then
  echo "[sprite-reporter] Cloning ${REPO} (branch: ${BRANCH:-main})"
  post_log "Cloning ${REPO} (branch: ${BRANCH:-main})..."

  CLONE_URL="https://github.com/${REPO}.git"
  if [ -n "${GH_TOKEN:-}" ]; then
    CLONE_URL="https://x-access-token:${GH_TOKEN}@github.com/${REPO}.git"
  fi

  if ! git clone --depth 1 --branch "${BRANCH:-main}" "$CLONE_URL" "$WORKDIR" 2>&1; then
    post_status "failed" 1 "Failed to clone ${REPO}"
    echo "[sprite-reporter] ERROR: Clone failed"
    exit 1
  fi

  echo "[sprite-reporter] Clone complete"
  post_log "Clone complete. Running agent..."
fi

cd "$WORKDIR"

# Configure git for the agent
git config --global user.email "sprite@open-dispatch.dev"
git config --global user.name "Open-Dispatch Sprite"

# Make GH_TOKEN available to gh CLI
if [ -n "${GH_TOKEN:-}" ]; then
  export GITHUB_TOKEN="$GH_TOKEN"
fi

# ---------------------------------------------------------------------------
# Run agent command, relay output via webhooks
# ---------------------------------------------------------------------------

echo "[sprite-reporter] Executing: ${COMMAND}"

# Pipe agent stdout through output-relay.js for webhook delivery
# Also tee to stdout so Fly.io built-in logs capture everything
EXIT_CODE=0
if command -v node >/dev/null 2>&1 && [ -f /usr/local/bin/output-relay.js ]; then
  # Use Node.js relay for buffered webhook delivery
  eval "$COMMAND" 2>&1 | tee /dev/stderr | node /usr/local/bin/output-relay.js || EXIT_CODE=$?
else
  # Fallback: line-by-line curl (slower, no buffering)
  eval "$COMMAND" 2>&1 | while IFS= read -r line; do
    echo "$line"
    post_log "$line"
  done || EXIT_CODE=$?
  # Capture exit code from the command, not the while loop
  EXIT_CODE=${PIPESTATUS[0]}
fi

# ---------------------------------------------------------------------------
# Report final status
# ---------------------------------------------------------------------------

if [ "$EXIT_CODE" -eq 0 ]; then
  echo "[sprite-reporter] Job ${JOB_ID} completed successfully"
  post_status "completed" 0
else
  echo "[sprite-reporter] Job ${JOB_ID} failed with exit code ${EXIT_CODE}"
  post_status "failed" "$EXIT_CODE" "Agent exited with code ${EXIT_CODE}"
fi

exit "$EXIT_CODE"
