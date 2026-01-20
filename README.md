<div align="center">

# 🚀 Open Dispatch

### Control AI Coding Assistants from Anywhere

**Slack** · **Microsoft Teams** · **75+ AI Providers** · **Works from Your Phone**

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
CONTEXT: Bridge app connecting chat platforms (Slack/Teams) to AI coding assistants (OpenCode/Claude)

SETUP FLOW:
1. Ask user: "Which chat platform? (Slack or Teams)"
2. Ask user: "Which AI backend? (OpenCode for 75+ providers, or Claude Code)"
3. Verify prerequisites are installed (see Prerequisites section)
4. Guide through platform-specific setup (create app, get tokens)
5. Create .env file with collected credentials
6. Run appropriate start command
7. Test with /od-start command in chat

KEY COMMANDS:
- npm start                    → Slack + Claude Code
- npm run start:opencode       → Slack + OpenCode (RECOMMENDED)
- npm run start:teams          → Teams + Claude Code
- npm run start:teams:opencode → Teams + OpenCode

SLASH COMMANDS (in chat):
- /od-start <name> <path>  → Start instance
- /od-stop <name>          → Stop instance
- /od-list                 → List instances
- /od-send <name> <msg>    → Send to specific instance

TROUBLESHOOTING:
- "appToken" error → Missing SLACK_APP_TOKEN in .env
- No response → Bot not invited to channel, or /od-start not run
- "Instance not found" → Bot restarted, run /od-start again

SUCCESS CRITERIA: User can /od-start an instance and send messages from their phone
```

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| **📱 Mobile Control** | Start coding sessions on desktop, interact from your phone |
| **🔌 75+ AI Providers** | OpenAI, Anthropic, Google, Groq, Ollama, Azure, AWS Bedrock... |
| **💬 Slack & Teams** | Native support for both platforms with rich UI |
| **🔄 Session Persistence** | Conversation context maintained across messages |
| **📦 Multi-Project** | Run multiple instances simultaneously |
| **🎯 Smart Routing** | Messages route to correct project based on channel |
| **🧹 Clean Output** | Only text responses—no tool call noise |

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
<td width="50%" valign="top">

### 🟢 Slack + OpenCode
**Best for most users**

75+ AI providers, easy setup

```bash
npm run start:opencode
```

📖 [Full Slack Setup](#slack-setup)
📖 [OpenCode Setup](./OPENCODE_SETUP.md)

</td>
<td width="50%" valign="top">

### 🔵 Teams + OpenCode
**For Microsoft shops**

Same power, Teams UI

```bash
npm run start:teams:opencode
```

📖 [Full Teams Setup](./TEAMS_SETUP.md)
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

### Slash Commands

| Command | Example | Description |
|---------|---------|-------------|
| `/od-start` | `/od-start api ~/projects/api` | Start instance named "api" in that directory |
| `/od-stop` | `/od-stop api` | Stop the "api" instance |
| `/od-list` | `/od-list` | Show all running instances |
| `/od-send` | `/od-send api add tests` | Send message to "api" from any channel |

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
│  ┌─────────────┐         │  • Maintains session context       ││
│  │  OpenCode   │◄───────►│  • Filters to text responses       ││
│  │ Instance 2  │         │  • Routes chat ↔ AI                ││
│  └─────────────┘         └──────────────┬─────────────────────┘│
│                                         │                      │
└─────────────────────────────────────────┼──────────────────────┘
                                          │
                         Socket Mode (Slack) / HTTPS (Teams)
                                          │
                                          ▼
                                 ┌─────────────────┐
                                 │  Slack / Teams  │
                                 └────────┬────────┘
                                          │
                                          ▼
                                 ┌─────────────────┐
                                 │   YOUR PHONE    │
                                 │   📱            │
                                 └─────────────────┘
```

### How It Works

1. **Start**: `/od-start` creates a session ID and binds channel → project
2. **Message**: Your chat message is sent to Open Dispatch
3. **Spawn**: Open Dispatch spawns `opencode` (or `claude`) with session resume
4. **Process**: AI processes your message with full conversation context
5. **Filter**: Tool calls are filtered out, only text responses returned
6. **Reply**: Clean response appears in your chat

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
│   ├── bot.js              # Slack + Claude Code
│   ├── opencode-bot.js     # Slack + OpenCode
│   ├── teams-bot.js        # Teams + Claude Code
│   ├── teams-opencode-bot.js # Teams + OpenCode
│   ├── claude-core.js      # Shared instance logic
│   └── opencode-core.js    # OpenCode-specific logic
├── tests/
│   └── opencode-core.test.js  # 40+ tests
├── teams-manifest/         # Teams app manifest
├── .env.example           # Config template
├── OPENCODE_SETUP.md      # OpenCode guide
├── TEAMS_SETUP.md         # Teams guide
└── package.json
```

---

## 🧪 Testing

```bash
npm test
```

40+ tests covering:
- Instance lifecycle
- Output parsing (JSON, ndjson, plaintext)
- Message chunking
- Error handling

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
