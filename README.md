<div align="center">

# 🚀 Open Dispatch

### Control AI Coding Assistants from Anywhere

**Slack** · **Microsoft Teams** · **Discord** · **75+ AI Providers** · **Fly.io Sprites** · **Works from Your Phone**

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js 18+](https://img.shields.io/badge/Node.js-18+-brightgreen.svg)](https://nodejs.org)
[![OpenCode Compatible](https://img.shields.io/badge/OpenCode-Compatible-blue.svg)](https://github.com/opencode-ai/opencode)

---

*Run agents locally or spin up isolated cloud VMs on [Fly.io](https://fly.io). Control everything from chat.*

[Quick Start](#-quick-start) · [Deployment Modes](#-deployment-modes) · [Sprites](#sprite-architecture-cloud-mode) · [Features](#-features) · [Output Formatters](#-output-formatters) · [Setup](#-setup-choose-your-path) · [Commands](#-commands) · [Architecture](#-architecture)

</div>

---

## 🤖 Agent Instructions

> **LLM AGENTS: Read this section first. These are your instructions for helping users set up Open Dispatch.**

```yaml
TASK: Help user set up Open Dispatch
CONTEXT: Bridge app connecting chat platforms (Slack/Teams/Discord) to AI coding assistants (OpenCode/Claude)
         Two deployment modes — LOCAL (Node.js server, agents on user's machine) or SPRITE (container on Fly.io, agents in cloud VMs)
         These modes are mutually exclusive per deployment. Do NOT try to mix them.

SETUP FLOW:
1. Ask user: "Which deployment mode?"
   - LOCAL MODE: Agents run on your machine. Install with npm, run as Node.js server.
   - SPRITE MODE: Agents run in cloud VMs on Fly.io. Deploy OD as container, agents in Sprites.
2. Ask user: "Which chat platform? (Slack, Teams, or Discord)"
3. For LOCAL: Ask "Which AI backend? (OpenCode for 75+ providers, or Claude Code)"
4. Verify prerequisites are installed (see Prerequisites section)
5. Guide through platform-specific setup (create app, get tokens)
6. For SPRITES: Guide through Fly.io setup (see SPRITE_SETUP.md)
7. Create .env file with collected credentials (LOCAL) or set Fly secrets (SPRITE)
8. Run appropriate start command
9. Test with /od-start (LOCAL) or /od-run (SPRITE)

KEY COMMANDS - LOCAL MODE (Node.js on user's machine):
- npm start                      → Slack + Claude Code
- npm run start:opencode         → Slack + OpenCode (RECOMMENDED)
- npm run start:teams            → Teams + Claude Code
- npm run start:teams:opencode   → Teams + OpenCode
- npm run start:discord          → Discord + Claude Code
- npm run start:discord:opencode → Discord + OpenCode

KEY COMMANDS - SPRITE MODE (container on Fly.io):
- npm run start:sprite           → Any provider (set CHAT_PROVIDER=slack|teams|discord)
- fly deploy                     → Deploy to Fly.io

SLASH COMMANDS (in chat):
LOCAL MODE:
- /od-start <name> <path>  → Start local instance bound to channel
- /od-stop <name>          → Stop instance
- /od-list                 → List instances
- /od-send <name> <msg>    → Send to specific instance

SPRITE MODE:
- /od-run [options] <task> → One-shot: spawn VM, run task, terminate
  Options: --repo <url>, --branch <name>, --image <docker-image>
- /od-start <name> --repo <url> --persistent → Persistent VM session
- /od-jobs                 → List recent Sprite jobs

OUTPUT FORMATTERS (Sprite mode only):
- Formatters filter raw agent CLI output so only conversational text reaches chat
- Set OUTPUT_FORMATTER=<name> env var in your Sprite image entrypoint
- Included formatter: "opencode" — strips tool markers, model headers, metadata
- Formatters live at /usr/local/bin/formatters/<name>.js inside the sidecar
- Pipeline: agent stdout → tee (Fly logs) → formatter → output-relay.js → webhooks → chat
- To create a custom formatter: write a Node.js script that reads stdin line-by-line,
  filters/transforms lines, and writes to stdout. Place at formatters/<name>.js in the sidecar dir.
- If OUTPUT_FORMATTER is not set, all raw agent output streams to chat (default behavior)

TROUBLESHOOTING:
LOCAL MODE:
- "appToken" error → Missing SLACK_APP_TOKEN in .env
- No response → Bot not invited to channel, or /od-start not run
- "Instance not found" → Bot restarted, run /od-start again
- Discord slash commands not showing → Wait up to 1 hour for global commands
SPRITE MODE:
- "Missing required env vars" → Set FLY_API_TOKEN, FLY_SPRITE_APP, SPRITE_IMAGE, CHAT_PROVIDER
- Sprite spawn failed → Check image exists, Fly.io token valid
- No output streaming → Check webhook health, ensure same Fly.io org for 6PN networking

SUCCESS CRITERIA:
- Local: User can /od-start and send messages from phone
- Sprites: User can /od-run a task and see streamed results in chat
```

---

## 🔀 Deployment Modes

Open Dispatch has **two deployment modes**. Choose the one that fits your workflow — they use the same codebase but serve different use cases.

### Local Mode — Node.js on your machine

**For:** Individual developers who want to control AI agents running on their own desktop/laptop/VM from chat while AFK.

```
YOU (laptop/desktop/VM)
┌────────────────────────────────────────────────┐
│                                                │
│  Open Dispatch          Claude Code / OpenCode │
│  (Node.js server)  ───► (local CLI processes)  │
│       │                                        │
└───────┼────────────────────────────────────────┘
        │ Socket Mode / HTTPS / Gateway
        ▼
  Slack / Teams / Discord
        │
        ▼
     Your Phone 📱
```

- Install with `npm install` — no Docker, no Fly.io, no cloud account needed
- Agents run as local processes with full access to your filesystem
- Perfect for: "start a coding session, go grab lunch, guide it from your phone"

```bash
npm install
npm run start:opencode    # or: npm start, npm run start:teams, etc.
```

### Sprite Mode — Deployed to Fly.io

**For:** Teams and platforms that need isolated, parallel cloud execution — spin up multiple AI agents in ephemeral VMs to tackle tasks concurrently.

```
Fly.io Private Network (6PN)
┌────────────────────────────────────────────────┐
│                                                │
│  Open Dispatch (container)                     │
│  ┌─────────────────┐  ┌────────────────────┐   │
│  │ Bot Engine       │  │ Webhook Server     │   │
│  │ (chat ↔ jobs)    │  │ (:8080)            │   │
│  └────────┬────────┘  └────────▲───────────┘   │
│           │                    │                │
│     ┌─────┼────────────────────┤                │
│     │     │                    │                │
│  ┌──▼──┐ ┌▼────┐ ┌─────┐     │                │
│  │Sprite│ │Sprite│ │Sprite│ ───┘ (webhooks)    │
│  │Job A │ │Job B │ │Job C │                     │
│  └──────┘ └─────┘ └─────┘                      │
│  (ephemeral Fly Machines)                       │
└────────────────────────────────────────────────┘
         │
   Slack / Teams / Discord
```

- Open Dispatch runs as a **container on Fly.io** alongside the Sprites it orchestrates
- Sprites are ephemeral Fly Machines — each job gets a clean VM, auto-destroyed on completion
- Agents stream output back to chat in real-time via HTTP webhooks over Fly.io's private network
- Perfect for: CI/CD, parallel test runs, team-wide coding automation

```bash
fly deploy                # Deploy OD to Fly.io
npm run start:sprite      # Or run locally for development
```

### Which mode should I use?

| | Local Mode | Sprite Mode |
|---|---|---|
| **Install** | `npm install` on any machine | `fly deploy` to Fly.io |
| **Agents run** | As local CLI processes | In ephemeral cloud VMs |
| **Filesystem** | Full access to your local files | Clones repos from GitHub |
| **Parallelism** | Limited by your machine | Spin up as many Sprites as needed |
| **Cost** | Free (your hardware) | Fly.io usage-based billing |
| **Best for** | Solo dev, AFK coding | Teams, CI/CD, parallel execution |
| **Requires** | Node.js 18+, AI CLI installed | Fly.io account, Docker image |

> **Important:** These modes are mutually exclusive per deployment. Local mode runs agents on your machine. Sprite mode runs agents in cloud VMs. You cannot mix them in a single instance — but you can run both separately if needed.

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| **📱 Mobile Control** | Start coding sessions on desktop, interact from your phone |
| **🔌 75+ AI Providers** | OpenAI, Anthropic, Google, Groq, Ollama, Azure, AWS Bedrock... |
| **💬 Slack, Teams & Discord** | Native support for all three platforms with rich UI |
| **⚡ Real-time Streaming** | Responses stream to chat as they're generated |
| **🔄 Session Persistence** | Conversation context maintained across messages |
| **📦 Multi-Project** | Run multiple instances simultaneously |
| **🎯 Smart Routing** | Messages route to correct project based on channel |
| **🔌 Pluggable Architecture** | Easy to add new chat platforms via ChatProvider interface |
| **☁️ Sprite Cloud Execution** | Run agents in isolated micro-VMs on Fly.io |
| **💤 Auto-Sleep** | Sprites hibernate when idle, wake on demand (pay only for compute used) |
| **🔧 Output Formatters** | Optional pipeline filters that extract clean conversational text from raw agent CLI output |

---

## 🏃 Quick Start

### 30-Second Overview

```bash
# 1. Clone & install
git clone https://github.com/bobum/open-dispatch.git
cd open-dispatch
npm install

# 2. Create .env with your tokens (see Setup section)
cp .env.example .env

# 3. Start (pick your combo)
npm run start:opencode    # Slack + OpenCode (recommended)

# 4. In Slack, start a session
/od-start myproject /path/to/code

# 5. Chat normally—AI responds in channel
```

**That's it.** Now you can message your AI from anywhere.

---

## 🛠 Setup: Choose Your Path

<table>
<tr>
<td width="33%" valign="top">

### 🟢 Slack + OpenCode
**Best for most users**

75+ AI providers, easy setup

```bash
npm run start:opencode
```

📖 [Full Slack Setup](#slack-setup)
📖 [OpenCode Setup](./OPENCODE_SETUP.md)

</td>
<td width="33%" valign="top">

### 🔵 Teams + OpenCode
**For Microsoft shops**

Same power, Teams UI

```bash
npm run start:teams:opencode
```

📖 [Full Teams Setup](./TEAMS_SETUP.md)
📖 [OpenCode Setup](./OPENCODE_SETUP.md)

</td>
<td width="33%" valign="top">

### 🟣 Discord + OpenCode
**For Discord communities**

Slash commands & embeds

```bash
npm run start:discord:opencode
```

📖 [Full Discord Setup](./DISCORD_SETUP.md)
📖 [OpenCode Setup](./OPENCODE_SETUP.md)

</td>
</tr>
<tr>
<td valign="top">

### ⚪ Slack + Claude Code
**Anthropic-only, simpler**

```bash
npm start
```

📖 [Full Slack Setup](#slack-setup)

</td>
<td valign="top">

### ⚪ Teams + Claude Code
**Anthropic-only, Teams UI**

```bash
npm run start:teams
```

📖 [Full Teams Setup](./TEAMS_SETUP.md)

</td>
<td valign="top">

### ⚪ Discord + Claude Code
**Anthropic-only, Discord UI**

```bash
npm run start:discord
```

📖 [Full Discord Setup](./DISCORD_SETUP.md)

</td>
</tr>
</table>

---

## 📋 Prerequisites

### Required for All Setups

- [ ] **Node.js 18+** — `node --version`
- [ ] **npm** — `npm --version`

### For OpenCode (Recommended)

- [ ] **OpenCode CLI** — `opencode --version`
- [ ] **AI Provider configured** — `opencode auth login`
- [ ] See [OPENCODE_SETUP.md](./OPENCODE_SETUP.md) for provider setup

### For Claude Code

- [ ] **Claude Code CLI** — `claude --version`
- [ ] Already authenticated with Anthropic

### For Slack

- [ ] Slack workspace with app creation permissions

### For Teams

- [ ] Microsoft 365 account with Teams
- [ ] ngrok or Azure for webhook endpoint
- [ ] See [TEAMS_SETUP.md](./TEAMS_SETUP.md)

### For Discord

- [ ] Discord account with server admin permissions
- [ ] See [DISCORD_SETUP.md](./DISCORD_SETUP.md)

### For Sprite Mode (in addition to chat platform prerequisites)

- [ ] [Fly.io](https://fly.io) account
- [ ] Fly CLI installed — `fly version`
- [ ] Fly app created for Sprites — `fly apps create my-sprites`
- [ ] Docker image built with sidecar installed — see [SPRITE_SETUP.md](./SPRITE_SETUP.md)
- [ ] Fly API token — `fly tokens create deploy -x 999999h`

---

## 🔧 Slack Setup

### Step 1: Create Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. **Create New App** → **From scratch**
3. Name: `Open Dispatch`
4. Select your workspace → **Create App**

### Step 2: Enable Socket Mode

1. **Socket Mode** (sidebar) → Toggle **ON**
2. **Generate** app-level token
   - Name: `socket-token`
   - Scope: `connections:write`
3. 📋 Copy token (starts with `xapp-`) → This is `SLACK_APP_TOKEN`

### Step 3: Get Signing Secret

1. **Basic Information** (sidebar)
2. **App Credentials** section
3. 📋 Copy **Signing Secret** → This is `SLACK_SIGNING_SECRET`

### Step 4: Add Bot Permissions

1. **OAuth & Permissions** (sidebar)
2. **Bot Token Scopes** → Add:
   - `chat:write`
   - `commands`
   - `channels:history`
   - `groups:history`
   - `im:history`
   - `mpim:history`

### Step 5: Install to Workspace

1. **Install App** (sidebar)
2. **Install to Workspace** → Authorize
3. 📋 Copy **Bot User OAuth Token** (starts with `xoxb-`) → This is `SLACK_BOT_TOKEN`

### Step 6: Create Slash Commands

1. **Slash Commands** (sidebar)
2. Create these 4 commands:

| Command | Description |
|---------|-------------|
| `/od-start` | Start an AI instance |
| `/od-stop` | Stop an AI instance |
| `/od-list` | List running instances |
| `/od-send` | Send message to instance |

> **Note:** Leave Request URL blank for all (Socket Mode handles it)

### Step 7: Enable Events

1. **Event Subscriptions** (sidebar) → Toggle **ON**
2. **Subscribe to bot events** → Add:
   - `message.channels`
   - `message.groups`
   - `message.im`
   - `message.mpim`
3. **Save Changes**

### Step 8: Configure & Run

```bash
# Create config
cp .env.example .env

# Edit .env with your tokens:
SLACK_BOT_TOKEN=xoxb-your-token
SLACK_SIGNING_SECRET=your-secret
SLACK_APP_TOKEN=xapp-your-token

# Start
npm run start:opencode
```

### Step 9: Test It

```bash
# In Slack:
/invite @Open Dispatch          # Invite bot to channel
/od-start myproject /path/to/code   # Start instance
"What files are in this project?"   # Chat normally!
```

---

## 💻 Commands

### Local Mode Commands

| Command | Example | Description |
|---------|---------|-------------|
| `/od-start` | `/od-start api ~/projects/api` | Start instance named "api" in that directory |
| `/od-stop` | `/od-stop api` | Stop the "api" instance |
| `/od-list` | `/od-list` | Show all running instances |
| `/od-send` | `/od-send api add tests` | Send message to "api" from any channel |

### Sprite Mode Commands (Cloud VMs)

| Command | Example | Description |
|---------|---------|-------------|
| `/od-run` | `/od-run --repo github.com/user/proj "run tests"` | One-shot job in fresh Sprite |
| `/od-run` | `/od-run --image my-agent:v1 --repo ... "task"` | One-shot with custom image |
| `/od-start` | `/od-start bot --repo github.com/user/proj --persistent` | Persistent Sprite session |
| `/od-jobs` | `/od-jobs` | List recent Sprite jobs |

**Sprite Options:**
- `--repo <url>` - GitHub repository to clone
- `--branch <name>` - Branch to checkout (default: main)
- `--image <image>` - Docker image to use
- `--persistent` - Keep Sprite alive for multiple messages

### Chat Messages

Once an instance is started in a channel, just type normally:

```
What's the project structure?
Add error handling to the main function
Run the tests and fix any failures
```

The AI responds in the same channel.

---

## 🏗 Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         YOUR DESKTOP                            │
│                                                                 │
│  ┌─────────────┐         ┌────────────────────────────────────┐│
│  │  OpenCode   │◄───────►│                                    ││
│  │ Instance 1  │         │         OPEN DISPATCH              ││
│  └─────────────┘         │                                    ││
│                          │  • Spawns AI per message           ││
│  ┌─────────────┐         │  • Streams responses in real-time  ││
│  │  OpenCode   │◄───────►│  • Maintains session context       ││
│  │ Instance 2  │         │  • Routes chat ↔ AI                ││
│  └─────────────┘         └──────────────┬─────────────────────┘│
│                                         │                      │
└─────────────────────────────────────────┼──────────────────────┘
                                          │
                    Socket Mode (Slack) / HTTPS (Teams) / Gateway (Discord)
                                          │
                                          ▼
                              ┌───────────────────────┐
                              │ Slack / Teams / Discord│
                              └───────────┬───────────┘
                                          │
                                          ▼
                                 ┌─────────────────┐
                                 │   YOUR PHONE    │
                                 │   📱            │
                                 └─────────────────┘
```

### Provider Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Entry Points                           │
├─────────────────────────────────────────────────────────────┤
│  discord-bot.js │ discord-opencode-bot.js                   │
│  bot.js         │ opencode-bot.js                           │
│  teams-bot.js   │ teams-opencode-bot.js                     │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│                      bot-engine.js                          │
│  (Platform-agnostic command handling & message routing)     │
└────────────────────────────┬────────────────────────────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
┌───────▼───────┐   ┌────────▼────────┐  ┌───────▼───────┐
│ SlackProvider │   │ DiscordProvider │  │ TeamsProvider │
│  (@slack/bolt)│   │   (discord.js)  │  │  (botbuilder) │
└───────────────┘   └─────────────────┘  └───────────────┘
```

### How It Works (Local Mode)

1. **Start**: `/od-start` creates a session ID and binds channel → project
2. **Message**: Your chat message is sent to Open Dispatch
3. **Spawn**: Open Dispatch spawns `opencode` (or `claude`) with session resume
4. **Process**: AI processes your message with full conversation context
5. **Filter**: Tool calls are filtered out, only text responses returned
6. **Reply**: Clean response appears in your chat

### Sprite Architecture (Cloud Mode)

For scalable, isolated execution, Open Dispatch supports **Sprites** — ephemeral Fly Machines that run agents in clean environments. Open Dispatch acts as a **relay**: it routes messages between chat and agents, but does not store files, build images, or run agents itself. Output streams back via HTTP webhooks over Fly.io's private network (6PN).

```
Fly.io Private Network (6PN / WireGuard mesh)
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│  OPEN DISPATCH (open-dispatch.internal)                        │
│  ┌──────────────────┐  ┌───────────────────────────────────┐   │
│  │ bot-engine.js     │  │ Webhook Server (:8080)            │   │
│  │                   │  │                                   │   │
│  │ onMessage() ◄─────┼──│ POST /webhooks/logs    ← output  │   │
│  │ (streams to chat) │  │ POST /webhooks/status  ← done    │   │
│  │                   │  │ POST /webhooks/artifacts← PRs etc│   │
│  └──────┬───────────┘  │ GET  /health                      │   │
│         │               └───────────────▲──────────────────┘   │
│         ▼                               │                      │
│  Slack / Teams / Discord                │ HTTP (private net)   │
│                                         │                      │
│  SPRITE MACHINES (ephemeral)            │                      │
│  ┌──────────────────────────────────────┼───┐                  │
│  │ sprite-reporter (sidecar)            │   │                  │
│  │  1. git clone repo                   │   │                  │
│  │  2. Run agent (claude / opencode)    │   │                  │
│  │  3. stdout → POST /webhooks/logs ────┘   │                  │
│  │  4. On exit → POST /webhooks/status      │                  │
│  │  5. PRs/artifacts → POST /webhooks/artifacts                │
│  └──────────────────────────────────────────┘                  │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

**How Sprite execution works:**
1. User runs `/od-run --repo owner/project "run the tests"` in chat
2. Open Dispatch creates a Job with a unique ID and per-job auth token
3. Sprite Orchestrator spawns a Fly Machine via the [Machines API](https://fly.io/docs/machines/api/)
4. The Sprite's sidecar (`sprite-reporter`) clones the repo and runs the agent
5. Agent output streams back to Open Dispatch via `/webhooks/logs` (buffered, batched)
6. Open Dispatch relays each chunk to the chat channel in real-time
7. When done, Sprite POSTs to `/webhooks/status` — the job Promise resolves
8. Sprite auto-destroys; artifacts (PR URLs, test logs) are delivered to chat

**Benefits of Sprites:**
- **Isolation**: Each job runs in its own VM — no state pollution
- **Scalability**: Spin up as many parallel jobs as needed
- **Cost**: Usage-based billing, Machines auto-destroy when done
- **Security**: Per-job auth tokens, private network communication, no shared secrets
- **Clean environments**: Fresh clone, no dependency conflicts between jobs

📖 **Full setup guide:** [SPRITE_SETUP.md](./SPRITE_SETUP.md)

---

## 🔧 Output Formatters

When Sprites run AI agents, the raw CLI output often includes tool-call markers, model headers, shell command blocks, and metadata alongside the agent's actual conversational response. **Output formatters** are optional pipeline filters that strip this noise so only clean, conversational text reaches your chat channel.

### How It Works

```
Agent CLI (opencode/claude)
    │
    ▼
  stdout
    │
    ├──► tee /dev/stderr (raw output preserved in Fly.io logs)
    │
    ▼
  Formatter (optional — filters lines in real time)
    │
    ▼
  output-relay.js (batches and POSTs to /webhooks/logs)
    │
    ▼
  Open Dispatch → Chat (Slack / Teams / Discord)
```

Formatters process lines **as they arrive** (streaming mode), so progress updates still flow to chat in real time. They do not buffer the entire output.

### Enabling a Formatter

Set the `OUTPUT_FORMATTER` environment variable in your Sprite image before the sidecar runs:

```bash
# In your Sprite entrypoint script, before calling sprite-reporter:
export OUTPUT_FORMATTER=opencode
exec /usr/local/bin/sprite-reporter
```

If `OUTPUT_FORMATTER` is not set, the formatter step is skipped entirely and raw output streams through unchanged (the default behavior).

### Included Formatters

#### `opencode` — OpenCode CLI Output Filter

**File:** `sidecar/formatters/opencode.js`

Extracts clean conversational text from [OpenCode](https://opencode.ai) CLI output. Handles two modes:

| Mode | Input | How It Works |
|------|-------|-------------|
| **JSON format** | `opencode run --format json -- "task"` | Parses `{"response": "..."}` lines and extracts the text |
| **Default format** | `opencode run -- "task"` | Heuristic line-by-line filter (see below) |

**What gets stripped (default format):**

| Pattern | Example | Why |
|---------|---------|-----|
| Model/build markers | `> build · gemini-3-pro-preview` | Internal metadata |
| Tool call markers | `→ Read file src/index.js` | Agent tool usage, not conversation |
| Shell commands | `$ ls -F` + indented output | Command execution output |
| Log lines | `[workspace-setup] Loading...` | Internal process logs |
| Metadata | `Tokens: 1234`, `Duration: 5.2s`, `Cost: $0.01` | Session stats |

**What passes through:** Everything else — the agent's actual conversational prose, markdown, code blocks, and explanations.

**Example:**

Raw OpenCode output:
```
> build · gemini-2.5-pro
→ Read file package.json
→ Read file src/index.js
This is a Node.js Express application that serves a REST API
for managing user accounts. It uses PostgreSQL for storage
and includes JWT authentication.
Tokens: 3847
Duration: 12.4s
```

After `opencode` formatter:
```
This is a Node.js Express application that serves a REST API
for managing user accounts. It uses PostgreSQL for storage
and includes JWT authentication.
```

### Writing a Custom Formatter

A formatter is a Node.js script that reads from stdin and writes to stdout. It must process lines **as they arrive** (streaming) — do not buffer all input before producing output, or the webhook relay will starve and jobs will time out.

**Template:**

```javascript
#!/usr/bin/env node
'use strict';
const { createInterface } = require('readline');

const rl = createInterface({
  input: process.stdin,
  crlfDelay: Infinity
});

rl.on('line', (line) => {
  // Your filtering logic here.
  // Call process.stdout.write(line + '\n') for lines you want to keep.
  // Simply return (don't write) for lines you want to strip.

  const trimmed = line.trim();

  // Example: skip lines that start with "DEBUG:"
  if (/^DEBUG:/.test(trimmed)) return;

  // Pass everything else through
  process.stdout.write(line + '\n');
});
```

**Steps to add a custom formatter:**

1. Create your script at `sidecar/formatters/<name>.js`
2. The sidecar Dockerfile already copies the entire `formatters/` directory:
   ```dockerfile
   COPY formatters/ /sidecar/formatters/
   ```
3. Rebuild the sidecar image
4. Set `OUTPUT_FORMATTER=<name>` in your Sprite environment

**Important rules for formatters:**
- **Stream, don't buffer.** Process each line in the `rl.on('line')` handler and write immediately. Never collect all lines and process on `close` — this blocks the downstream relay.
- **Preserve line endings.** Always append `\n` when writing to stdout.
- **Fail open.** If your filter logic encounters unexpected input, pass it through rather than dropping it. Missing output is worse than extra output.
- **No side effects.** Formatters should be pure stdin→stdout filters. Don't make HTTP calls, write files, or depend on external state.

### Formatter Quick Reference

| Environment Variable | Value | Effect |
|---------------------|-------|--------|
| `OUTPUT_FORMATTER` not set | — | No filtering, raw agent output streams to chat |
| `OUTPUT_FORMATTER=opencode` | `opencode` | Strips OpenCode tool markers, headers, metadata |
| `OUTPUT_FORMATTER=myfilter` | `myfilter` | Uses custom `formatters/myfilter.js` |

---

## ⚡ Deployment

### Local Mode: Running as a Service

For local mode, Open Dispatch is just a Node.js server. Keep it running in the background:

**PM2 (Recommended)**
```bash
npm install -g pm2
pm2 start src/opencode-bot.js --name open-dispatch
pm2 save
pm2 startup
```

**systemd (Linux)**
```ini
# /etc/systemd/system/open-dispatch.service
[Unit]
Description=Open Dispatch
After=network.target

[Service]
Type=simple
User=youruser
WorkingDirectory=/path/to/open-dispatch
ExecStart=/usr/bin/node src/opencode-bot.js
Restart=on-failure
EnvironmentFile=/path/to/open-dispatch/.env

[Install]
WantedBy=multi-user.target
```

**Windows Task Scheduler**
```
node C:\path\to\open-dispatch\src\opencode-bot.js
```

### Sprite Mode: Deploying to Fly.io

Sprite mode requires Open Dispatch to run on Fly.io so Sprites can reach it over the private network. The included `Dockerfile` and `fly.toml` handle this.

**Step 1: Create the Fly app**
```bash
cd open-dispatch
fly auth login
fly launch --no-deploy    # Creates app, review fly.toml
```

**Step 2: Set secrets**

These are stored encrypted by Fly.io and injected as env vars at runtime. Never commit them to `.env` in the container.

```bash
# Chat provider credentials (pick your platform)
fly secrets set CHAT_PROVIDER=slack
fly secrets set SLACK_BOT_TOKEN=xoxb-your-token
fly secrets set SLACK_SIGNING_SECRET=your-secret
fly secrets set SLACK_APP_TOKEN=xapp-your-token

# Fly.io Sprite config
fly secrets set FLY_API_TOKEN=$(fly tokens create deploy -x 999999h)
fly secrets set FLY_SPRITE_APP=your-sprite-app-name
fly secrets set SPRITE_IMAGE=registry.fly.io/your-app/agent:latest

# Passed through to Sprites for agent use
fly secrets set GH_TOKEN=your-github-token
fly secrets set ANTHROPIC_API_KEY=your-anthropic-key
```

**Step 3: Update fly.toml for Sprite mode**

The default `fly.toml` runs `bot.js` (local mode). For Sprite mode, you need to change the entry point and expose the webhook port:

```toml
app = "open-dispatch"
primary_region = "iad"

[build]
  dockerfile = "Dockerfile"

[env]
  NODE_ENV = "production"

# Health check on the webhook server
[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = "off"
  auto_start_machines = true
  min_machines_running = 1
  processes = ["app"]

[[vm]]
  memory = "512mb"
  cpu_kind = "shared"
  cpus = 1
```

And override the Dockerfile CMD:
```toml
[processes]
  app = "node src/sprite-bot.js"
```

**Step 4: Deploy**
```bash
fly deploy
```

**Step 5: Verify**
```bash
# Check OD is healthy
fly status
fly logs

# Test webhook server
fly ssh console -C "curl -s http://localhost:8080/health"
```

**Step 6: Build your Sprite agent image**

Sprites need a Docker image with your AI tools and the Open-Dispatch sidecar installed.
See [SPRITE_SETUP.md](./SPRITE_SETUP.md) for full instructions.

```dockerfile
# Pull sidecar scripts from Open-Dispatch
FROM ghcr.io/bobum/open-dispatch/sidecar:latest AS sidecar

# Your agent base image
FROM node:22-bookworm
COPY --from=sidecar /sidecar/ /usr/local/bin/
RUN npm install -g @anthropic-ai/claude-code
RUN apt-get update && apt-get install -y git curl jq && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/sprite-reporter"]
```

```bash
# Build and push to Fly registry
fly auth docker
docker build -t registry.fly.io/your-sprite-app/agent:latest .
docker push registry.fly.io/your-sprite-app/agent:latest
```

**That's it.** Run `/od-run --repo owner/project "run the tests"` in chat and watch output stream back in real-time.

---

## 🔍 Troubleshooting

### Local Mode

| Problem | Solution |
|---------|----------|
| `"You must provide an appToken"` | Check `.env` has `SLACK_APP_TOKEN` starting with `xapp-` |
| Bot doesn't respond | 1) Invite bot to channel 2) Run `/od-start` in that channel |
| `"Instance not found"` | Bot was restarted. Run `/od-start` again |
| Slow responses | Normal — each message spawns a process. ~2-5 sec |
| Teams webhook fails | Check ngrok is running and URL updated in Dev Portal |
| `/od-run` says "requires Sprite backend" | You're in local mode. Use `/od-start` instead, or switch to Sprite mode |

### Sprite Mode

| Problem | Solution |
|---------|----------|
| `"Missing required env vars"` | Set `CHAT_PROVIDER`, `FLY_API_TOKEN`, `FLY_SPRITE_APP`, `SPRITE_IMAGE` |
| "Failed to spawn Sprite" | Check Fly token (`fly auth whoami`), image exists, region available |
| Sprite output not appearing in chat | Check webhook health: `curl http://open-dispatch.internal:8080/health` |
| Sprites can't reach Open Dispatch | Both apps must be in the same Fly.io org (6PN requires same org) |
| Job timed out | Default timeout is 10 min. Check if agent command is hanging. See Fly logs: `fly logs -a your-sprite-app` |
| Auth errors on webhooks | Job tokens are per-job HMAC tokens. Check sidecar has `JOB_TOKEN` env var |
| Formatter not found | Check `OUTPUT_FORMATTER` value matches a file at `/usr/local/bin/formatters/<name>.js`. Rebuild sidecar image. |
| Job times out with formatter | Formatter must stream line-by-line. If it buffers all input before output, the webhook relay starves. See [Output Formatters](#-output-formatters). |

---

## 🎯 Supported AI Providers (OpenCode)

OpenCode supports **75+ providers**. Popular ones:

| Provider | Models |
|----------|--------|
| **Anthropic** | Claude 3.5 Sonnet, Claude 3 Opus/Sonnet/Haiku |
| **OpenAI** | GPT-4o, GPT-4 Turbo, o1 |
| **Google** | Gemini 2.0, Gemini 1.5 Pro |
| **Groq** | Llama 3, Mixtral (ultra-fast) |
| **AWS Bedrock** | Claude, Titan, Llama |
| **Azure OpenAI** | GPT-4, GPT-3.5 |
| **Ollama** | Any local model |

Configure in `.env`:
```bash
OPENCODE_MODEL=anthropic/claude-sonnet-4-20250514
```

---

## 📁 Project Structure

```
open-dispatch/
├── src/
│   ├── providers/
│   │   ├── chat-provider.js    # Base ChatProvider interface
│   │   ├── slack-provider.js   # Slack implementation
│   │   ├── teams-provider.js   # Teams implementation
│   │   ├── discord-provider.js # Discord implementation
│   │   └── index.js            # Provider exports
│   ├── bot-engine.js           # Platform-agnostic bot logic
│   ├── bot.js                  # Slack + Claude Code
│   ├── opencode-bot.js         # Slack + OpenCode
│   ├── teams-bot.js            # Teams + Claude Code
│   ├── teams-opencode-bot.js   # Teams + OpenCode
│   ├── discord-bot.js          # Discord + Claude Code
│   ├── discord-opencode-bot.js # Discord + OpenCode
│   ├── claude-core.js          # Claude CLI integration
│   ├── opencode-core.js        # OpenCode CLI integration
│   ├── sprite-core.js          # Sprite (ephemeral VM) integration
│   ├── sprite-orchestrator.js  # Fly Machines API orchestration
│   ├── sprite-bot.js           # Provider-agnostic Sprite entry point
│   ├── webhook-server.js       # Receives output from Sprites via webhooks
│   └── job.js                  # Job tracking for Sprite executions
├── sidecar/
│   ├── sprite-reporter.sh      # Sprite entry point (clone, run, report)
│   ├── output-relay.js         # Buffered stdout → webhook relay
│   ├── formatters/             # Optional output formatters (set OUTPUT_FORMATTER)
│   │   └── opencode.js         # OpenCode CLI output → clean conversational text
│   └── Dockerfile              # Sidecar image for COPY --from=
├── tests/
│   ├── chat-provider.test.js   # Provider architecture tests
│   ├── job.test.js             # Job tracking tests
│   ├── opencode-core.test.js   # Core logic tests
│   ├── sprite-core.test.js     # Sprite core tests
│   ├── sprite-integration.test.js # Sprite integration tests
│   ├── sprite-slow.test.js     # Sprite slow/E2E tests
│   ├── webhook-server.test.js  # Webhook server tests
│   └── opencode-formatter.test.js # Output formatter tests
├── teams-manifest/             # Teams app manifest
├── .env.example               # Config template
├── OPENCODE_SETUP.md          # OpenCode guide
├── TEAMS_SETUP.md             # Teams guide
├── DISCORD_SETUP.md           # Discord guide
├── SPRITE_SETUP.md            # Sprite (cloud VM) guide
└── package.json
```

---

## 🧪 Testing

```bash
npm test
```

220+ tests covering:
- Instance lifecycle
- Output parsing (JSON, ndjson, plaintext)
- Message chunking
- Error handling
- Provider architecture
- Event handling
- Sprite orchestration, webhooks, and job tracking
- Output formatter filtering (JSON extraction, heuristic filtering, streaming)

---

## 🤝 Contributing

1. Fork the repo
2. Create feature branch (`git checkout -b feature/awesome`)
3. Commit changes (`git commit -m 'Add awesome feature'`)
4. Push (`git push origin feature/awesome`)
5. Open Pull Request

---

## 📜 License

MIT © [bobum](https://github.com/bobum)

---

<div align="center">

**Built for the [OpenCode](https://github.com/opencode-ai/opencode) community**

⭐ Star this repo if you find it useful!

[Report Bug](https://github.com/bobum/open-dispatch/issues) · [Request Feature](https://github.com/bobum/open-dispatch/issues)

</div>
