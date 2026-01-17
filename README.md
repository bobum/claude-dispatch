# Claude Dispatch

Manage and communicate with Claude Code instances via Slack. Start Claude Code sessions on your desktop and interact with them from your phone—without permission prompts or tool output noise.

## Features

- Start/stop Claude Code instances from Slack
- Route messages to specific project instances
- Filter output to only show Claude's conversational responses (no tool spam)
- Manage multiple concurrent instances
- Works with Slack's Socket Mode (no public URL needed)

## Prerequisites

- Node.js 18+
- Claude Code CLI installed and authenticated
- A Slack workspace where you can create apps

## Slack App Setup

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and create a new app
2. Choose "From scratch" and name it (e.g., "Claude Dispatch")

### Enable Socket Mode

1. Go to **Socket Mode** in the sidebar
2. Enable Socket Mode
3. Create an app-level token with `connections:write` scope
4. Save this as `SLACK_APP_TOKEN`

### Bot Token Scopes

1. Go to **OAuth & Permissions**
2. Under **Bot Token Scopes**, add:
   - `chat:write`
   - `commands`
   - `channels:history`
   - `groups:history`
   - `im:history`
   - `mpim:history`

### Slash Commands

1. Go to **Slash Commands**
2. Create these commands:

| Command | Request URL | Description |
|---------|-------------|-------------|
| `/claude-start` | (leave blank for Socket Mode) | Start a Claude instance |
| `/claude-stop` | (leave blank for Socket Mode) | Stop a Claude instance |
| `/claude-list` | (leave blank for Socket Mode) | List running instances |
| `/claude-send` | (leave blank for Socket Mode) | Send message to specific instance |

### Event Subscriptions

1. Go to **Event Subscriptions**
2. Enable Events
3. Under **Subscribe to bot events**, add:
   - `message.channels`
   - `message.groups`
   - `message.im`
   - `message.mpim`

### Install the App

1. Go to **Install App**
2. Install to your workspace
3. Copy the **Bot User OAuth Token** as `SLACK_BOT_TOKEN`
4. Copy the **Signing Secret** from **Basic Information** as `SLACK_SIGNING_SECRET`

## Installation

```bash
git clone https://github.com/Bobum/claude-dispatch.git
cd claude-dispatch
npm install
```

Create a `.env` file:

```bash
cp .env.example .env
# Edit .env with your Slack credentials
```

## Usage

### Start the service

```bash
npm start
```

Keep this running on your desktop (consider using PM2 or running as a Windows service for persistence).

### Slack Commands

**Start an instance:**
```
/claude-start gridiron C:\projects\gridiron
```

**Send a message (if not in the instance's channel):**
```
/claude-send gridiron Add the player fatigue system
```

**List running instances:**
```
/claude-list
```

**Stop an instance:**
```
/claude-stop gridiron
```

### Workflow

1. Create a Slack channel for your project (e.g., `#claude-gridiron`)
2. In that channel, run `/claude-start gridiron C:\path\to\gridiron`
3. Type messages normally—they go to Claude
4. Claude's responses appear in the channel
5. Tool executions happen silently in the background

## Running as a Windows Service

To keep Claude Dispatch running after logout, use PM2:

```bash
npm install -g pm2
pm2 start src/bot.js --name claude-dispatch
pm2 save
pm2 startup
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Your Windows Desktop                  │
│                                                          │
│  ┌──────────────┐      ┌─────────────────────────────┐  │
│  │ Claude Code  │◄────►│                             │  │
│  │ Instance 1   │      │      Claude Dispatch        │  │
│  └──────────────┘      │                             │  │
│                        │  - Spawns/manages instances │  │
│  ┌──────────────┐      │  - Filters JSON output      │  │
│  │ Claude Code  │◄────►│  - Routes Slack messages    │  │
│  │ Instance 2   │      │                             │  │
│  └──────────────┘      └─────────────┬───────────────┘  │
│                                      │                   │
└──────────────────────────────────────┼───────────────────┘
                                       │ Socket Mode
                                       ▼
                              ┌─────────────────┐
                              │   Slack API     │
                              └────────┬────────┘
                                       │
                                       ▼
                              ┌─────────────────┐
                              │   Your Phone    │
                              └─────────────────┘
```

## License

MIT
