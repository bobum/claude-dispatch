# Sprite Setup Guide

This guide explains how to set up **Sprites** for running AI agents in isolated, ephemeral micro-VMs.

## What are Sprites?

Sprites are ephemeral micro-VMs that:
- **Auto-sleep** when idle (you only pay for compute used)
- Provide **isolated environments** per job
- Support **persistent sessions** (wake on demand)
- Run on [Fly.io Machines](https://fly.io/docs/machines/)

## Prerequisites

- A [Fly.io](https://fly.io) account
- Fly CLI installed (`brew install flyctl` or see [docs](https://fly.io/docs/hands-on/install-flyctl/))
- A Docker image with your agent tools (Claude Code, OpenCode, etc.)

## Step 1: Get Fly.io API Token

```bash
# Login to Fly.io
fly auth login

# Create an API token
fly tokens create deploy -x 999999h

# Copy the token - this is your SPRITE_API_TOKEN
```

Save the token in your `.env` file:
```bash
SPRITE_API_TOKEN=your-fly-api-token
```

## Step 2: Create Your Agent Image

Create a Dockerfile with the tools your agents need:

```dockerfile
# Example: Node.js agent with Claude Code
FROM node:20-slim

# Install git and basic tools
RUN apt-get update && apt-get install -y git curl && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Set up workspace
WORKDIR /workspace

# Default command (for persistent mode)
CMD ["tail", "-f", "/dev/null"]
```

Build and push to Fly.io registry:
```bash
# Login to Fly registry
fly auth docker

# Build and push
docker build -t registry.fly.io/your-app/agent:latest .
docker push registry.fly.io/your-app/agent:latest
```

## Step 3: Configure Open Dispatch

Add to your `.env`:
```bash
# Required: Fly.io API token
SPRITE_API_TOKEN=your-fly-api-token

# Optional: Custom API URL (default uses Fly Machines API)
# SPRITE_API_URL=https://api.machines.dev/v1

# Optional: Your default agent image
SPRITE_BASE_IMAGE=registry.fly.io/your-app/agent:latest

# Optional: Preferred region (default: iad)
SPRITE_REGION=iad

# Optional: Agent type - 'claude' or 'opencode'
SPRITE_AGENT_TYPE=claude
```

## Step 4: Run with Sprite Backend

Start Open Dispatch with the Sprite backend:
```bash
# You'll need to create a sprite-bot.js entry point
# or modify an existing bot to use sprite-core
node src/your-sprite-bot.js
```

## Usage

### One-Shot Jobs (`/od-run`)

Run a single task in a fresh Sprite:
```
/od-run --repo github.com/user/project "run the tests"
/od-run --image my-custom-agent:v1 --repo github.com/user/project "lint the code"
```

Options:
- `--repo <url>` - GitHub repository to clone
- `--branch <name>` - Branch to checkout (default: main)
- `--image <image>` - Docker image to use (overrides default)

### Persistent Sessions (`/od-start --persistent`)

Start a long-running Sprite that maintains state:
```
/od-start mybot --repo github.com/user/project --persistent
```

Then send messages:
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

## How It Works

### One-Shot Mode

```
/od-run "task"
    │
    ▼
┌─────────────┐
│ Spawn Sprite│ ← Fresh VM with your image
└─────────────┘
    │
    ▼
┌─────────────┐
│ Clone repo  │
│ Run command │
│ Stream logs │
└─────────────┘
    │
    ▼
┌─────────────┐
│ Collect     │
│ artifacts   │
└─────────────┘
    │
    ▼
┌─────────────┐
│ Terminate   │
└─────────────┘
```

### Persistent Mode

```
/od-start --persistent
    │
    ▼
┌─────────────┐
│ Spawn Sprite│ ← Long-running VM
│ Clone repo  │
│ Keep alive  │
└─────────────┘
    │
    ▼
"message 1" ──► Wake → Execute → Sleep
    │
"message 2" ──► Wake → Execute → Sleep
    │
"message 3" ──► Wake → Execute → Sleep
    │
/od-stop ─────► Terminate
```

## Custom Images

### Minimal Agent Image

```dockerfile
FROM alpine:latest

RUN apk add --no-cache git bash curl nodejs npm

# Install your agent CLI
RUN npm install -g opencode

WORKDIR /workspace
CMD ["tail", "-f", "/dev/null"]
```

### Full-Featured Image with Playwright

```dockerfile
FROM mcr.microsoft.com/playwright:v1.40.0-focal

RUN npm install -g @anthropic-ai/claude-code

# Pre-install browsers
RUN npx playwright install chromium

WORKDIR /workspace
CMD ["tail", "-f", "/dev/null"]
```

### Python Agent Image

```dockerfile
FROM python:3.11-slim

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*
RUN pip install opencode-cli

WORKDIR /workspace
CMD ["tail", "-f", "/dev/null"]
```

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SPRITE_API_TOKEN` | Yes | - | Fly.io API token |
| `SPRITE_API_URL` | No | `https://api.machines.dev/v1` | Machines API URL |
| `SPRITE_BASE_IMAGE` | No | `open-dispatch/agent:latest` | Default Docker image |
| `SPRITE_REGION` | No | `iad` | Fly.io region |
| `SPRITE_AGENT_TYPE` | No | `claude` | Agent CLI: `claude` or `opencode` |

## Troubleshooting

### "No API token provided"

Set `SPRITE_API_TOKEN` in your `.env` file.

### "Failed to spawn Sprite"

- Check your Fly.io token is valid: `fly auth whoami`
- Verify the image exists: `fly image show your-image`
- Check region availability: `fly platform regions`

### "Sprite exec error"

- Ensure your image has the required tools installed
- Check the command syntax
- Verify the repo URL is accessible

### Sprite not waking

- Check Sprite status: the orchestrator logs will show wake attempts
- Sprites may be stopped if they exceed idle timeout
- Use `/od-list` to see active instances

## Cost Optimization

- **Use one-shot mode** for independent tasks
- **Use persistent mode** for multi-step conversations
- Sprites auto-sleep after 30 minutes of inactivity
- Choose the smallest image that meets your needs
- Use regional images for faster cold starts

## Security Notes

- API tokens have full access to your Fly.io account
- Never commit tokens to version control
- Use environment variables or secrets management
- Consider using scoped tokens when available
- Sprites have network access - be mindful of what repos you clone
