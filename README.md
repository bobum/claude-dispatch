# Claude Dispatch

Control Claude Code or OpenCode from Slack or Microsoft Teams. Start coding sessions on your desktop and interact with them from your phone.

> **New in v2.1:** Microsoft Teams support + OpenCode integration! See [TEAMS_SETUP.md](./TEAMS_SETUP.md) for Teams setup or [OPENCODE_SETUP.md](./OPENCODE_SETUP.md) for OpenCode.

## Quick Start (AI-Assisted Setup)

**Point an LLM at this README and let it guide you through setup.**

```
Open this project in Claude Code and say:
"Help me set up Claude Dispatch following the README"
```

The agent will walk you through each step interactively, create your config files, and verify everything works.

---

## What This Does

- Start/stop Claude Code or OpenCode instances from Slack
- Send messages to AI from any device
- Get responses back in Slack (no tool output noise)
- Manage multiple project instances simultaneously
- Maintain conversation context across messages
- **OpenCode version**: Choose from 75+ AI providers (OpenAI, Anthropic, Google, local models, etc.)

## Architecture

### Slack Mode (Socket Mode)
```
┌─────────────────────────────────────────────────────────────┐
│                    Your Desktop                              │
│                                                              │
│  ┌──────────────┐      ┌──────────────────────────────────┐ │
│  │ Claude Code  │◄────►│                                  │ │
│  │ Instance 1   │      │       Claude Dispatch            │ │
│  └──────────────┘      │                                  │ │
│                        │  - Spawns Claude per message     │ │
│  ┌──────────────┐      │  - Resumes sessions for context  │ │
│  │ Claude Code  │◄────►│  - Filters to text responses     │ │
│  │ Instance 2   │      │  - Routes Slack ↔ Claude         │ │
│  └──────────────┘      └─────────────┬────────────────────┘ │
│                                      │                      │
└──────────────────────────────────────┼──────────────────────┘
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

### Teams Mode (Bot Framework)
```
┌─────────────────────────────────────────────────────────────┐
│                    Your Desktop                              │
│                                                              │
│  ┌──────────────┐      ┌──────────────────────────────────┐ │
│  │ Claude Code  │◄────►│                                  │ │
│  │ Instance 1   │      │       Claude Dispatch            │ │
│  └──────────────┘      │           (Teams)                │ │
│                        │                                  │ │
│  ┌──────────────┐      │  - HTTP webhook server          │ │
│  │ Claude Code  │◄────►│  - Adaptive Cards for UI        │ │
│  │ Instance 2   │      │  - Routes Teams ↔ Claude        │ │
│  └──────────────┘      └─────────────┬────────────────────┘ │
│                                      │                      │
└──────────────────────────────────────┼──────────────────────┘
                                       │ HTTPS (ngrok/Azure)
                                       ▼
                              ┌─────────────────┐
                              │ Azure Bot Svc   │
                              └────────┬────────┘
                                       │
                                       ▼
                              ┌─────────────────┐
                              │ Microsoft Teams │
                              └─────────────────┘
```

---

## Prerequisites

Before starting, ensure you have:

- [ ] Node.js 18+ installed

**For Slack:**
- [ ] A Slack workspace where you can create apps
- [ ] Admin or app-creation permissions in that workspace

**For Teams:**
- [ ] Microsoft 365 account with Teams access
- [ ] Access to Teams Developer Portal (dev.teams.microsoft.com)
- [ ] See [TEAMS_SETUP.md](./TEAMS_SETUP.md) for full Teams requirements

**For Claude Code version:**
- [ ] Claude Code CLI installed and authenticated (`claude --version` works)

**For OpenCode version:**
- [ ] OpenCode CLI installed (`opencode --version` works)
- [ ] At least one AI provider configured (`opencode auth login`)
- [ ] See [OPENCODE_SETUP.md](./OPENCODE_SETUP.md) for detailed setup

---

## Setup Instructions (Slack)

> **Using Teams instead?** See [TEAMS_SETUP.md](./TEAMS_SETUP.md) for Microsoft Teams setup.

### Step 1: Install Dependencies

```bash
cd claude-dispatch
npm install
```

### Step 2: Create Slack App

1. Go to https://api.slack.com/apps
2. Click "Create New App" → "From scratch"
3. Name: `Claude Dispatch`
4. Select your workspace
5. Click "Create App"

### Step 3: Enable Socket Mode

1. In app settings, go to **Socket Mode** (left sidebar)
2. Toggle **Enable Socket Mode** to ON
3. Click "Generate" to create an app-level token
4. Token name: `socket-token`
5. Add scope: `connections:write`
6. Click "Generate"
7. **Copy the token** (starts with `xapp-`) — this is your `SLACK_APP_TOKEN`

### Step 4: Get Signing Secret

1. Go to **Basic Information** (left sidebar)
2. Scroll to **App Credentials**
3. **Copy the Signing Secret** — this is your `SLACK_SIGNING_SECRET`

### Step 5: Configure Bot Permissions

1. Go to **OAuth & Permissions** (left sidebar)
2. Scroll to **Bot Token Scopes**
3. Add these scopes:
   - `chat:write`
   - `commands`
   - `channels:history`
   - `groups:history`
   - `im:history`
   - `mpim:history`

### Step 6: Install App to Workspace

1. Go to **Install App** (left sidebar)
2. Click "Install to Workspace"
3. Authorize the app
4. **Copy the Bot User OAuth Token** (starts with `xoxb-`) — this is your `SLACK_BOT_TOKEN`

### Step 7: Create Slash Commands

1. Go to **Slash Commands** (left sidebar)
2. Create these 4 commands (leave Request URL blank for each):

| Command | Short Description |
|---------|-------------------|
| `/claude-start` | Start a Claude instance |
| `/claude-stop` | Stop a Claude instance |
| `/claude-list` | List running instances |
| `/claude-send` | Send message to instance |

### Step 8: Enable Event Subscriptions

1. Go to **Event Subscriptions** (left sidebar)
2. Toggle **Enable Events** to ON
3. Expand **Subscribe to bot events**
4. Add these events:
   - `message.channels`
   - `message.groups`
   - `message.im`
   - `message.mpim`
5. Click "Save Changes"

### Step 9: Create Environment File

Create a `.env` file in the project root:

```bash
cp .env.example .env
```

Edit `.env` with your three tokens:

```
SLACK_BOT_TOKEN=xoxb-your-bot-token-here
SLACK_SIGNING_SECRET=your-signing-secret-here
SLACK_APP_TOKEN=xapp-your-app-token-here
```

### Step 10: Start the Bot

```bash
npm start
```

You should see:
```
Claude Dispatch is running
Waiting for Slack commands...
[INFO] socket-mode:SocketModeClient:0 Now connected to Slack
```

---

## Usage

### Set Up a Channel

1. Create or choose a Slack channel for your project (e.g., `#claude-myproject`)
2. Invite the bot to the channel:
   ```
   /invite @Claude Dispatch
   ```

### Start an Instance

In the channel where you invited the bot:
```
/claude-start myproject C:\path\to\project
```

The bot will confirm and bind to that channel. All messages in that channel now go to Claude.

### Chat with Claude

Just type normally in the channel:
```
What files are in this project?
```

Claude responds in the same channel.

### List Running Instances

```
/claude-list
```

Shows all active instances with message counts and uptime.

### Send to Specific Instance

From any channel:
```
/claude-send myproject Add error handling to the API
```

### Stop an Instance

```
/claude-stop myproject
```

---

## Running as a Service

To keep Claude Dispatch running after logout:

### Using PM2

```bash
npm install -g pm2
pm2 start src/bot.js --name claude-dispatch
pm2 save
pm2 startup
```

### Using Windows Task Scheduler

Create a task that runs `node C:\path\to\claude-dispatch\src\bot.js` at login.

---

## Troubleshooting

### "You must provide an appToken"
Your `.env` file is missing `SLACK_APP_TOKEN` or it's not being loaded. Verify:
- `.env` exists in project root
- Token starts with `xapp-`
- No extra spaces or quotes around the value

### Bot doesn't respond to messages
1. Check the bot is invited to the channel
2. Verify Event Subscriptions are enabled with message events
3. Check that `/claude-start` was run in that channel

### "Instance not found"
The instance was stopped or the bot was restarted. Instances don't persist across bot restarts. Run `/claude-start` again.

### Claude responses are slow
Each message spawns a new Claude process and resumes the session. This takes 2-5 seconds. The "Thinking..." indicator shows while processing.

---

## How It Works

1. `/claude-start` creates a session ID and binds a channel to a project directory
2. When you message the channel, the bot spawns `claude` with `--resume <session-id>`
3. Your message is sent as JSON via stdin
4. Claude's response is parsed from stdout (stream-json format)
5. Only text responses are forwarded to Slack (tool calls are filtered)
6. Session persistence means Claude remembers the conversation

---

## Running Teams Bot

For Microsoft Teams, use the Teams-specific entry point:

```bash
# Install dependencies (includes Teams SDK)
npm install

# Start Teams bot
npm run start:teams
```

You'll also need ngrok for local development:
```bash
ngrok http 3978
```

Then update your Teams Developer Portal bot messaging endpoint with the ngrok URL.

See [TEAMS_SETUP.md](./TEAMS_SETUP.md) for complete Teams setup instructions.

---

## Running OpenCode Version

For OpenCode instead of Claude Code:

```bash
# Install dependencies
npm install

# Start OpenCode bot
npm run start:opencode
```

The OpenCode version uses different slash commands to avoid conflicts:
- `/opencode-start` instead of `/claude-start`
- `/opencode-stop` instead of `/claude-stop`
- `/opencode-list` instead of `/claude-list`
- `/opencode-send` instead of `/claude-send`

See [OPENCODE_SETUP.md](./OPENCODE_SETUP.md) for complete setup instructions.

---

## Choosing Between Claude Code and OpenCode

| Feature | Claude Code | OpenCode |
|---------|-------------|----------|
| AI Providers | Anthropic only | 75+ (OpenAI, Anthropic, Google, etc.) |
| Local Models | No | Yes (Ollama) |
| Pricing | Claude pricing | Your chosen provider |
| Session Storage | Claude's cache | Local SQLite |
| Setup Complexity | Lower | Slightly higher |

---

## License

MIT
