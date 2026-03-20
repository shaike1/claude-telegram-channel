# Claude Telegram Channel

Connect [Claude Code](https://claude.ai/code) to a Telegram group topic (forum thread) via MCP.

Each project gets its own Telegram topic. Claude reads your messages, thinks, and replies — all from inside your project's working directory.

Inspired by the official [Discord plugin](https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/discord).

---

## How it works

```
You → Telegram topic → MCP server → Claude Code → MCP server → Telegram topic → You
```

- One MCP server instance per project
- Claude receives your messages as `notifications/claude/channel` events
- Claude replies using the `send_message` tool
- Sessions persist in tmux — no SSH needed

---

## Prerequisites

- [Bun](https://bun.sh) — `curl -fsSL https://bun.sh/install | bash`
- A Telegram bot token (from [@BotFather](https://t.me/BotFather))
- A Telegram **Supergroup** with **Topics** enabled

---

## Quick Setup

### 1. Create a Telegram bot

Open [@BotFather](https://t.me/BotFather), send `/newbot`, follow the steps, copy the token.

### 2. Set up your Supergroup

- Create a Telegram group → Settings → **Topics: Enable**
- Add your bot as **Admin** with "Manage Topics" permission
- Disable bot privacy mode: BotFather → `/mybots` → your bot → **Bot Settings → Group Privacy → Turn off**

### 3. Get your Chat ID and Thread ID

Add the bot to the group, send a message, then:
```bash
curl "https://api.telegram.org/bot<TOKEN>/getUpdates"
```
Look for `chat.id` (negative number) and `message_thread_id`.

### 4. Configure

Create `~/.claude/channels/telegram/.env`:
```env
TELEGRAM_BOT_TOKEN=your_token_here
TELEGRAM_CHAT_ID=-1001234567890
```

### 5. Add to your project

In your project folder, create `.mcp.json`:
```json
{
  "mcpServers": {
    "telegram": {
      "command": "bun",
      "args": ["run", "--cwd", "/path/to/claude-telegram-channel", "--shell=bun", "--silent", "start"],
      "env": {
        "TELEGRAM_THREAD_ID": "YOUR_THREAD_ID"
      }
    }
  }
}
```

### 6. Launch Claude

```bash
cd /your/project
claude
```

Claude loads the MCP server automatically, connects to your Telegram topic, and starts listening.

---

## Tools available to Claude

| Tool | Description |
|------|-------------|
| `send_message` | Send text to the topic (HTML supported: `<b>`, `<i>`, `<code>`, `<pre>`) |
| `edit_message` | Edit a previously sent message |
| `typing` | Show typing indicator (~5s) |
| `fetch_messages` | Get recent message history from this session |

---

## Multi-project setup (optional)

For managing multiple projects across multiple servers from one Telegram group, see [tmux-bridge](https://github.com/shaicake/tmux-telegram-bridge) — a companion bot that:

- Creates one topic per project automatically
- Provisions tmux sessions on remote servers via SSH
- Auto-resumes Claude sessions on restart
- Discovers existing Claude project history with `/discover`

---

## Security

- Only you should be in the Telegram group (or use a private group)
- The bot token is stored in `~/.claude/channels/telegram/.env` — never commit it
- Claude will not send files from its config directory

---

## License

MIT
