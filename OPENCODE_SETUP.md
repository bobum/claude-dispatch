# OpenCode Setup Guide for Claude Dispatch

This guide walks you through setting up Claude Dispatch to work with OpenCode instead of Claude Code.

## Overview

OpenCode is an open-source AI coding agent that runs in your terminal. It supports multiple AI providers (OpenAI, Anthropic, Google, AWS Bedrock, and more) and provides a similar CLI experience to Claude Code.

## Prerequisites

- Node.js 18+ installed
- A Slack workspace where you can create apps
- Admin or app-creation permissions in that workspace
- API key for your preferred AI provider (OpenAI, Anthropic, etc.)

## Step 1: Install OpenCode

Choose your preferred installation method:

### macOS (Homebrew)
```bash
brew install anomalyco/tap/opencode
```

### Windows (Scoop)
```bash
scoop bucket add extras
scoop install extras/opencode
```

### Windows (Chocolatey)
```bash
choco install opencode
```

### npm (Any Platform)
```bash
npm install -g opencode-ai@latest
```

### Quick Install Script (macOS/Linux)
```bash
curl -fsSL https://opencode.ai/install | bash
```

### Verify Installation
```bash
opencode --version
```

## Step 2: Configure AI Provider

OpenCode supports multiple AI providers. Configure your preferred one:

```bash
opencode auth login
```

This will prompt you to select a provider and enter your API key. Credentials are stored in `~/.local/share/opencode/auth.json`.

### Supported Providers
- OpenAI (GPT-4, GPT-4o, o1, etc.)
- Anthropic (Claude 3.5, Claude 3, etc.)
- Google (Gemini)
- AWS Bedrock
- Azure OpenAI
- Groq
- OpenRouter
- Local models (Ollama, etc.)

### Verify Authentication
```bash
opencode auth list
```

## Step 3: Set Up Slack App

Follow the standard Slack setup from the main README:

1. Go to https://api.slack.com/apps
2. Create a new app with Socket Mode enabled
3. Add required bot scopes: `chat:write`, `commands`, `channels:history`, `groups:history`, `im:history`, `mpim:history`
4. Create slash commands: `/opencode-start`, `/opencode-stop`, `/opencode-list`, `/opencode-send`
5. Enable Event Subscriptions with message events

## Step 4: Configure Environment

Create a `.env` file:

```bash
cp .env.example .env
```

Edit with your Slack credentials:

```env
# Slack Configuration
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_APP_TOKEN=xapp-your-app-token

# OpenCode Configuration (optional)
OPENCODE_MODEL=anthropic/claude-sonnet-4-20250514
```

## Step 5: Install Dependencies

```bash
npm install
```

## Step 6: Start the Bot

```bash
npm run start:opencode
```

You should see:
```
OpenCode Dispatch is running
Waiting for Slack commands...
```

## Usage

### Commands

The OpenCode version uses slightly different command names to avoid conflicts:

| Command | Description |
|---------|-------------|
| `/opencode-start <name> <path>` | Start an OpenCode instance |
| `/opencode-stop <name>` | Stop an instance |
| `/opencode-list` | List running instances |
| `/opencode-send <name> <msg>` | Send to specific instance |

### Starting an Instance

```
/opencode-start myproject C:\path\to\project
```

### Chatting

Once started, messages in the channel are sent to OpenCode:

```
What files are in this project?
```

### Listing Instances

```
/opencode-list
```

### Stopping

```
/opencode-stop myproject
```

## Architecture Differences

### Claude Code vs OpenCode

| Aspect | Claude Code | OpenCode |
|--------|-------------|----------|
| Session Resume | `--resume <id>` | `--session <id>` or `--continue` |
| JSON Output | `--output-format stream-json` | `--format json` |
| JSON Input | `--input-format stream-json` | Via prompt argument |
| Permissions | `--dangerously-skip-permissions` | Auto-approved in non-interactive |
| Server Mode | N/A | `opencode serve` / `opencode acp` |

### How It Works

1. `/opencode-start` creates a session and binds a channel to a project
2. Messages spawn `opencode run` with the prompt
3. Session continuity via `--session <id>` flag
4. JSON output is parsed and sent back to Slack
5. Only text responses are forwarded (tool calls filtered)

## Choosing a Model

You can specify which model to use via environment variable:

```env
OPENCODE_MODEL=anthropic/claude-sonnet-4-20250514
```

Or configure in OpenCode's config file (`~/.config/opencode/config.json`):

```json
{
  "model": "anthropic/claude-sonnet-4-20250514"
}
```

### Popular Model Options

- `anthropic/claude-sonnet-4-20250514` - Claude Sonnet 4
- `openai/gpt-4o` - GPT-4o
- `openai/o1` - OpenAI o1
- `google/gemini-2.0-flash` - Gemini 2.0 Flash

## Troubleshooting

### "opencode: command not found"
Ensure OpenCode is installed and in your PATH:
```bash
which opencode  # macOS/Linux
where opencode  # Windows
```

### "No authenticated providers"
Run `opencode auth login` and configure at least one provider.

### Session not resuming
OpenCode sessions are stored in SQLite. Ensure the data directory is writable:
- Default: `~/.local/share/opencode/` (Linux/macOS)
- Windows: `%LOCALAPPDATA%\opencode\`

### Slow responses
Each message spawns a new process. For better performance, consider:
1. Using a faster model (e.g., GPT-4o-mini)
2. Running OpenCode in server mode (advanced)

### Bot doesn't respond
1. Check that OpenCode works standalone: `opencode run -p "Hello"`
2. Verify Slack credentials in `.env`
3. Check that the bot is invited to the channel

## Advanced: Server Mode

For better performance, you can run OpenCode as a persistent server:

```bash
opencode serve --port 4096
```

Then connect via the attach URL. This avoids process spawn overhead per message.

## Comparison with Claude Dispatch

| Feature | Claude Version | OpenCode Version |
|---------|---------------|------------------|
| AI Provider | Anthropic only | 75+ providers |
| Local Models | No | Yes (Ollama) |
| Cost | Claude pricing | Your chosen provider |
| Session Storage | Claude's cache | Local SQLite |
| Tool Execution | Claude Code tools | OpenCode tools |

## Resources

- [OpenCode Documentation](https://opencode.ai/docs/)
- [OpenCode GitHub](https://github.com/opencode-ai/opencode)
- [OpenCode Models](https://opencode.ai/docs/models/)
- [OpenCode Providers](https://opencode.ai/docs/providers/)
