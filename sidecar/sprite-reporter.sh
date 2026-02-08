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
#   OPENCODE_AUTH_JSON  — OpenCode auth.json contents (for Copilot/provider auth)
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

WORKDIR="${WORKDIR:-/workspace}"
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

# Inject OpenCode auth credentials (for Copilot, API keys, etc.)
if [ -n "${OPENCODE_AUTH_JSON:-}" ]; then
  OPENCODE_AUTH_DIR="${HOME}/.local/share/opencode"
  mkdir -p "$OPENCODE_AUTH_DIR"
  echo "$OPENCODE_AUTH_JSON" > "$OPENCODE_AUTH_DIR/auth.json"
  chmod 600 "$OPENCODE_AUTH_DIR/auth.json"
  echo "[sprite-reporter] OpenCode auth credentials injected"
fi

# ---------------------------------------------------------------------------
# Run agent command, relay output via webhooks
# ---------------------------------------------------------------------------

echo "[sprite-reporter] Executing: ${COMMAND}"

# Optional output formatter — set OUTPUT_FORMATTER to enable.
# Formatters transform raw agent CLI output into clean conversational text
# before it reaches the webhook relay. Included formatters:
#   opencode  — extracts response from OpenCode's --format json output
# Custom formatters: place a script at /usr/local/bin/formatters/<name>.js
FORMATTER_PATH=""
if [ -n "${OUTPUT_FORMATTER:-}" ]; then
  FORMATTER_PATH="/usr/local/bin/formatters/${OUTPUT_FORMATTER}.js"
  if [ -f "$FORMATTER_PATH" ]; then
    echo "[sprite-reporter] Using output formatter: ${OUTPUT_FORMATTER}"
  else
    echo "[sprite-reporter] WARNING: Formatter '${OUTPUT_FORMATTER}' not found at ${FORMATTER_PATH}"
    FORMATTER_PATH=""
  fi
fi

# Pipe agent stdout through optional formatter, then output-relay.js for
# webhook delivery. Also tee to stdout so Fly.io built-in logs capture raw output.
EXIT_CODE=0
if command -v node >/dev/null 2>&1 && [ -f /usr/local/bin/output-relay.js ]; then
  # Use Node.js relay for buffered webhook delivery
  if [ -n "$FORMATTER_PATH" ]; then
    eval "$COMMAND" 2>&1 | tee /dev/stderr | node "$FORMATTER_PATH" | node /usr/local/bin/output-relay.js || EXIT_CODE=$?
  else
    eval "$COMMAND" 2>&1 | tee /dev/stderr | node /usr/local/bin/output-relay.js || EXIT_CODE=$?
  fi
else
  # Fallback: line-by-line curl (slower, no buffering)
  if [ -n "$FORMATTER_PATH" ]; then
    eval "$COMMAND" 2>&1 | node "$FORMATTER_PATH" | while IFS= read -r line; do
      echo "$line"
      post_log "$line"
    done || EXIT_CODE=$?
  else
    eval "$COMMAND" 2>&1 | while IFS= read -r line; do
      echo "$line"
      post_log "$line"
    done || EXIT_CODE=$?
  fi
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
