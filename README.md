<div align="center">

# 🚀 Open Dispatch

### Control AI Coding Assistants from Anywhere

**Slack** · **Microsoft Teams** · **Discord** · **75+ AI Providers** · **Works from Your Phone**

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js 18+](https://img.shields.io/badge/Node.js-18+-brightgreen.svg)](https://nodejs.org)
[![OpenCode Compatible](https://img.shields.io/badge/OpenCode-Compatible-blue.svg)](https://github.com/opencode-ai/opencode)

---

*Start a coding session on your desktop. Guide it from your phone.*

[Quick Start](#-quick-start) · [Features](#-features) · [Setup](#-setup-choose-your-path) · [Commands](#-commands) · [Architecture](#-architecture)

</div>

---

## 🤖 Agent Instructions

> **LLM AGENTS: Read this section first. These are your instructions for helping users set up Open Dispatch.**

```yaml
TASK: Help user set up Open Dispatch
CONTEXT: Bridge app connecting chat platforms (Slack/Teams/Discord) to AI coding assistants (OpenCode/Claude)
         Supports LOCAL mode (agents run on user's machine) and CLOUD mode (agents run in Sprites on Fly.io)

SETUP FLOW:
1. Ask user: "Which chat platform? (Slack, Teams, or Discord)"
2. Ask user: "Which execution mode? (Local for desktop, or Sprites for cloud VMs)"
3. Ask user: "Which AI backend? (OpenCode for 75+ providers, or Claude Code)"
4. Verify prerequisites are installed (see Prerequisites section)
5. Guide through platform-specific setup (create app, get tokens)
6. For Sprites: Guide through Fly.io setup (see SPRITE_SETUP.md)
7. Create .env file with collected credentials
8. Run appropriate start command
9. Test with /od-start or /od-run command in chat

KEY COMMANDS:
- npm start                      → Slack + Claude Code (local)
- npm run start:opencode         → Slack + OpenCode (local, RECOMMENDED)
- npm run start:teams            → Teams + Claude Code (local)
- npm run start:teams:opencode   → Teams + OpenCode (local)
- npm run start:discord          → Discord + Claude Code (local)
- npm run start:discord:opencode → Discord + OpenCode (local)
- npm run start:sprite           → Any provider + Sprite cloud VMs (set CHAT_PROVIDER)

SLASH COMMANDS (in chat):
LOCAL MODE:
- /od-start <name> <path>  → Start local instance bound to channel
- /od-stop <name>          → Stop instance
- /od-list                 → List instances
- /od-send <name> <msg>    → Send to specific instance

SPRITE MODE (cloud VMs):
- /od-run [options] <task> → One-shot: spawn VM, run task, terminate
  Options: --repo <url>, --branch <name>, --image <docker-image>
- /od-start <name> --repo <url> --persistent → Persistent VM session
- /od-jobs                 → List recent Sprite jobs

TROUBLESHOOTING:
- "appToken" error → Missing SLACK_APP_TOKEN in .env
- No response → Bot not invited to channel, or /od-start not run
- "Instance not found" → Bot restarted, run /od-start again
- Discord slash commands not showing → Wait up to 1 hour for global commands
- "No API token" for Sprites → Set FLY_API_TOKEN (Fly.io token)
- Sprite spawn failed → Check image exists, Fly.io token valid

SUCCESS CRITERIA:
- Local: User can /od-start and send messages from phone
- Sprites: User can /od-run a task and see streamed results
```

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

For scalable, isolated execution, Open Dispatch supports **Sprites**—ephemeral micro-VMs that run agents in clean environments:

```
┌─────────────────────────────────────────────────────────────────┐
│                       CLOUD DEPLOYMENT                          │
│                                                                 │
│  ┌────────────────────────────────────────────────────────────┐│
│  │              OPEN DISPATCH (Orchestrator)                   ││
│  │                                                            ││
│  │  • Receives commands from Slack/Teams/Discord              ││
│  │  • Creates Jobs with unique IDs                            ││
│  │  • Spawns Sprites via API                                  ││
│  │  • Streams logs back to chat                               ││
│  │  • Collects artifacts (screenshots, videos, logs)          ││
│  └────────────────────────────┬───────────────────────────────┘│
│                               │                                 │
│       ┌───────────────────────┼───────────────────────┐        │
│       │                       │                       │        │
│  ┌────▼─────┐           ┌─────▼────┐           ┌─────▼────┐   │
│  │ Sprite 1 │           │ Sprite 2 │           │ Sprite 3 │   │
│  │ (Job A)  │           │ (Job B)  │           │ (Job C)  │   │
│  │ isolated │           │ isolated │           │ isolated │   │
│  └──────────┘           └──────────┘           └──────────┘   │
│                                                                 │
│  Sprites: Ephemeral micro-VMs on Fly.io                        │
│  • Auto-sleep when idle (usage-based billing)                  │
│  • Clean environment per job                                   │
│  • Runs Playwright tests, AI agents, etc.                      │
└─────────────────────────────────────────────────────────────────┘
```

**Benefits of Sprites:**
- **Isolation**: Each job runs in its own VM—no state pollution
- **Scalability**: Trivial to run parallel jobs
- **Cost**: Pay only for compute used (auto-sleep when idle)
- **Clean environments**: No dependency conflicts between jobs

---

## ⚡ Running as a Service

### PM2 (Recommended)

```bash
npm install -g pm2
pm2 start src/opencode-bot.js --name open-dispatch
pm2 save
pm2 startup
```

### Windows Task Scheduler

Create task running at login:
```
node C:\path\to\open-dispatch\src\opencode-bot.js
```

### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
CMD ["npm", "run", "start:opencode"]
```

---

## 🔍 Troubleshooting

| Problem | Solution |
|---------|----------|
| `"You must provide an appToken"` | Check `.env` has `SLACK_APP_TOKEN` starting with `xapp-` |
| Bot doesn't respond | 1) Invite bot to channel 2) Run `/od-start` in that channel |
| `"Instance not found"` | Bot was restarted. Run `/od-start` again |
| Slow responses | Normal—each message spawns process. ~2-5 sec |
| Teams webhook fails | Check ngrok is running and URL updated in Dev Portal |

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
│   └── Dockerfile              # Sidecar image for COPY --from=
├── tests/
│   ├── opencode-core.test.js   # Core logic tests
│   └── chat-provider.test.js   # Provider architecture tests
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

63 tests covering:
- Instance lifecycle
- Output parsing (JSON, ndjson, plaintext)
- Message chunking
- Error handling
- Provider architecture
- Event handling

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
