# Sprite Setup Guide

This guide explains how to set up **Sprites** for running AI agents in isolated, ephemeral cloud VMs on [Fly.io](https://fly.io).

## What are Sprites?

Sprites are ephemeral Fly Machines that:
- Provide **isolated environments** per job (no state pollution between tasks)
- Support **one-shot jobs** (spawn, run, terminate) and **persistent sessions** (wake on demand)
- Stream agent output **back to chat in real-time** via HTTP webhooks
- Run on [Fly.io Machines](https://fly.io/docs/machines/) with usage-based billing

## Architecture Overview

```
           Fly.io Private Network (6PN)
┌──────────────────────────────────────────────────────────┐
│                                                          │
│  OPEN-DISPATCH (open-dispatch.internal)                  │
│  ┌────────────────┐  ┌──────────────────────────────┐    │
│  │ bot-engine      │  │ Webhook Server (:8080)       │    │
│  │ onMessage() ◄───┼──│ POST /webhooks/logs          │    │
│  │ callback        │  │ POST /webhooks/status        │    │
│  └──────┬─────────┘  │ POST /webhooks/artifacts     │    │
│         │             │ GET  /health                  │    │
│         ▼             └──────────────▲───────────────┘    │
│  chatProvider                        │                    │
│  .sendLongMessage()                  │ HTTP (private net) │
│                                      │                    │
│  SPRITE MACHINE (ephemeral)          │                    │
│  ┌───────────────────────────────────┼─────┐              │
│  │ sprite-reporter (sidecar)         │     │              │
│  │  1. Clone repo                    │     │              │
│  │  2. Run agent (claude/opencode)   │     │              │
│  │  3. stdout → POST /webhooks/logs ─┘     │              │
│  │  4. On exit → POST /webhooks/status     │              │
│  │  5. Artifacts → POST /webhooks/artifacts│              │
│  └─────────────────────────────────────────┘              │
└──────────────────────────────────────────────────────────┘
         │
    Slack / Teams / Discord (via Socket Mode / HTTPS / Gateway)
```

**How it works:**
1. User runs `/od-run <task>` in any chat provider
2. Open-Dispatch creates a Job with a unique ID and auth token
3. Open-Dispatch spawns a Fly Machine via the [Machines API](https://fly.io/docs/machines/api/)
4. The Sprite's sidecar (`sprite-reporter`) clones the repo and runs the agent
5. Agent output is POSTed to Open-Dispatch's webhook server over Fly.io's private network
6. Open-Dispatch relays output to the chat channel in real-time
7. When the agent finishes, the Sprite reports final status and auto-destroys

## Prerequisites

- A [Fly.io](https://fly.io) account
- Fly CLI installed (`brew install flyctl` or see [docs](https://fly.io/docs/hands-on/install-flyctl/))
- A Docker image with your agent tools and the Open-Dispatch sidecar installed

## Step 1: Create a Fly App for Sprites

```bash
# Login to Fly.io
fly auth login

# Create an app for your Sprites (this is just a namespace — no deployment yet)
fly apps create my-sprites
```

## Step 2: Get a Fly.io API Token

```bash
# Create a deploy token scoped to your app
fly tokens create deploy -x 999999h

# Copy the token — this is your FLY_API_TOKEN
```

## Step 3: Build Your Agent Image with Sidecar

Open-Dispatch publishes a **sidecar image** containing the webhook relay scripts.
Install it into your agent image using multi-stage Docker build:

```dockerfile
# Pull the sidecar scripts
FROM ghcr.io/bobum/open-dispatch/sidecar:latest AS sidecar

# Your agent base image
FROM node:22-bookworm

# Install the sidecar (sprite-reporter + output-relay.js)
COPY --from=sidecar /sidecar/ /usr/local/bin/

# Install your agent tools
RUN npm install -g @anthropic-ai/claude-code

# Install any other dependencies your agents need
RUN apt-get update && apt-get install -y git curl jq && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

# Use sprite-reporter as the entry point
ENTRYPOINT ["/usr/local/bin/sprite-reporter"]
```

Build and push to Fly.io registry:
```bash
fly auth docker
docker build -t registry.fly.io/my-sprites/agent:latest .
docker push registry.fly.io/my-sprites/agent:latest
```

## Step 4: Deploy Open-Dispatch to Fly.io

Open-Dispatch itself also runs as a Fly Machine. It needs to be on the same
Fly.io private network (6PN) as the Sprites so they can communicate via
`.internal` DNS.

```bash
cd open-dispatch
fly launch   # Creates app and fly.toml
fly deploy
```

## Step 5: Configure Environment

Add to your `.env` (or set as Fly secrets):

```bash
# Required: Chat provider
CHAT_PROVIDER=slack   # or: teams, discord

# Required: Fly.io Sprite config
FLY_API_TOKEN=your-fly-api-token
FLY_SPRITE_APP=my-sprites
SPRITE_IMAGE=registry.fly.io/my-sprites/agent:latest

# Optional: Webhook URL (default uses Fly.io private networking)
# OPEN_DISPATCH_URL=http://open-dispatch.internal:8080

# Per-provider config (see platform setup guides)
# Slack:   SLACK_BOT_TOKEN, SLACK_APP_TOKEN, SLACK_SIGNING_SECRET
# Teams:   TEAMS_APP_ID, TEAMS_APP_PASSWORD
# Discord: DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID

# Passed through to Sprites automatically:
# GH_TOKEN=your-github-token
# ANTHROPIC_API_KEY=your-anthropic-key
```

## Step 6: Run

```bash
npm run start:sprite
```

This starts:
- The chat provider (Slack/Teams/Discord) connection
- The webhook server on port 8080 (receives output from Sprites)
- The stale job reaper (cleans up timed-out jobs every 60s)

## Usage

### One-Shot Jobs (`/od-run`)

Run a single task in a fresh Sprite:
```
/od-run --repo owner/project "run the tests"
/od-run --image my-custom:v1 --repo owner/project "lint the code"
/od-run --branch feature-x --repo owner/project "fix the failing tests"
```

Options:
- `--repo <owner/repo>` - GitHub repository to clone
- `--branch <name>` - Branch to checkout (default: main)
- `--image <image>` - Docker image (overrides SPRITE_IMAGE)

### Persistent Sessions (`/od-start --persistent`)

Start a long-running Sprite that maintains state between messages:
```
/od-start mybot --repo owner/project --persistent
```

Then chat normally:
```
"run the tests"
"fix the failing tests"
"commit the changes"
```

Stop when done:
```
/od-stop mybot
```

### List Jobs (`/od-jobs`)

View recent job history:
```
/od-jobs
```

## Webhook Endpoints

The webhook server runs on port 8080 and exposes these endpoints:

| Endpoint | Method | Body | Purpose |
|----------|--------|------|---------|
| `/health` | GET | — | Liveness check for Fly.io |
| `/webhooks/logs` | POST | `{jobId, text}` | Real-time agent output |
| `/webhooks/status` | POST | `{jobId, status, exitCode, error}` | Job state transitions |
| `/webhooks/artifacts` | POST | `{jobId, artifacts: [{name, url, type}]}` | PR URLs, test logs, etc. |

All webhook calls require `Authorization: Bearer <JOB_TOKEN>` — a per-job token
generated by Open-Dispatch and passed to the Sprite at spawn time.

## Sidecar Scripts

The sidecar image contains two scripts:

**`sprite-reporter`** (Bash) — Entry point for Sprite Machines:
1. Validates required env vars (`JOB_ID`, `JOB_TOKEN`, `OPEN_DISPATCH_URL`, `COMMAND`)
2. Clones the repo (if `REPO` is set)
3. Runs the agent command
4. Pipes output through `output-relay.js`
5. Reports final status to `/webhooks/status`

**`output-relay.js`** (Node.js) — Buffered output relay:
- Reads agent stdout line-by-line
- Buffers output for 500ms or 20 lines
- POSTs chunks to `/webhooks/logs`
- Passes through to stdout for Fly.io log capture

## Custom Agent Images

### Claude Code Agent
```dockerfile
FROM ghcr.io/bobum/open-dispatch/sidecar:latest AS sidecar
FROM node:22-bookworm

COPY --from=sidecar /sidecar/ /usr/local/bin/
RUN npm install -g @anthropic-ai/claude-code
RUN apt-get update && apt-get install -y git curl jq && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/sprite-reporter"]
```

### OpenCode Agent
```dockerfile
FROM ghcr.io/bobum/open-dispatch/sidecar:latest AS sidecar
FROM golang:1.22-bookworm

COPY --from=sidecar /sidecar/ /usr/local/bin/
RUN go install github.com/opencode-ai/opencode@latest
RUN apt-get update && apt-get install -y git curl jq nodejs && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/sprite-reporter"]
```

### .NET API Agent (with database access)
```dockerfile
FROM ghcr.io/bobum/open-dispatch/sidecar:latest AS sidecar
FROM mcr.microsoft.com/dotnet/sdk:10.0-bookworm-slim

COPY --from=sidecar /sidecar/ /usr/local/bin/
RUN apt-get update && apt-get install -y git curl jq nodejs npm && rm -rf /var/lib/apt/lists/*
RUN npm install -g @anthropic-ai/claude-code
WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/sprite-reporter"]
```

## Environment Variables Reference

### Open-Dispatch (host)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CHAT_PROVIDER` | Yes | — | Chat platform: `slack`, `teams`, `discord` |
| `FLY_API_TOKEN` | Yes | — | Fly.io API token |
| `FLY_SPRITE_APP` | Yes | — | Fly app name for Sprite Machines |
| `SPRITE_IMAGE` | Yes | — | Default Docker image for Sprites |
| `OPEN_DISPATCH_URL` | No | `http://open-dispatch.internal:8080` | Webhook callback URL |
| `WEBHOOK_PORT` | No | `8080` | Webhook server listen port |
| `FLY_REGION` | No | `iad` | Preferred Fly.io region |
| `SPRITE_AGENT_TYPE` | No | `claude` | Agent CLI: `claude` or `opencode` |

### Sprite (injected automatically)

| Variable | Description |
|----------|-------------|
| `JOB_ID` | Unique job identifier |
| `JOB_TOKEN` | Auth token for webhook calls |
| `OPEN_DISPATCH_URL` | Webhook base URL |
| `REPO` | GitHub repo to clone (owner/repo) |
| `BRANCH` | Git branch |
| `COMMAND` | Agent command to execute |
| `GH_TOKEN` | GitHub token (passed through from host) |
| `ANTHROPIC_API_KEY` | Anthropic key (passed through from host) |
| `DATABASE_URL` | Database URL (passed through if set on host) |

## Troubleshooting

### "Missing required env vars"
Set `FLY_API_TOKEN`, `FLY_SPRITE_APP`, `SPRITE_IMAGE`, and `CHAT_PROVIDER` in your `.env`.

### "Failed to spawn Sprite"
- Check your Fly.io token: `fly auth whoami`
- Verify the image exists: `fly image show your-image`
- Check region availability: `fly platform regions`

### Sprites can't reach Open-Dispatch
- Ensure both Open-Dispatch and Sprites are in the same Fly.io organization
- Fly.io 6PN (private networking) requires apps in the same org
- Check the webhook URL uses `.internal` DNS

### Agent output not appearing in chat
- Check `/health` endpoint: `curl http://open-dispatch.internal:8080/health`
- Verify the sidecar is installed: the Sprite image must have `/usr/local/bin/sprite-reporter`
- Check Fly.io logs: `fly logs -a your-sprite-app`

### Job timed out
- Default timeout is 10 minutes
- The stale job reaper runs every 60 seconds
- Check if the agent command is hanging

## Security Notes

- **Job tokens are per-job**: Each Sprite gets a unique HMAC token valid only for its job
- **Private networking**: Webhooks travel over Fly.io 6PN (WireGuard mesh), not the public internet
- **No shared secrets**: Sprites cannot access other jobs' data
- API tokens and secrets are injected via env vars, never baked into images
- Use `GH_TOKEN` with minimal required scopes
