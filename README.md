# Claude Telegram Channel

Connect [Claude Code](https://claude.ai/code) to a Telegram group topic (forum thread) via MCP.

Each project gets its own Telegram topic. Claude reads your messages, thinks, and replies — all from inside your project's working directory. No SSH. No terminal babysitting.

Inspired by the official [Discord plugin](https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/discord).

---

## How it works

```
You → Telegram topic → routing bot → queue file → MCP server → Claude Code → Telegram topic → You
```

- One MCP server instance per project, each watching its own topic
- A **routing bot** holds the single `getUpdates` long-poll and writes incoming messages to per-topic queue files at `/tmp/tg-queue-{THREAD_ID}.jsonl`
- The MCP server tails its queue file and fires `notifications/claude/channel` events into Claude
- This avoids `409 Conflict` errors that occur when multiple processes poll the same bot token
- Claude replies using the `send_message` tool
- Sessions persist in tmux — no SSH needed

---

## Prerequisites

- [Bun](https://bun.sh) — `curl -fsSL https://bun.sh/install | bash`
- A Telegram bot token (from [@BotFather](https://t.me/BotFather))
- A Telegram **Supergroup** with **Topics** enabled
- The [routing bot](https://github.com/shaike1/tmux-telegram) running to fan out messages

> **Critical: bun must be in system PATH**
>
> Claude Code spawns MCP servers with a minimal environment. If bun is only in `~/.bun/bin` (the default install location), the MCP server will fail to start silently.
>
> Fix:
> ```bash
> sudo ln -sf ~/.bun/bin/bun /usr/local/bin/bun
> ```
> Then verify: `which bun` should return `/usr/local/bin/bun`.

---

## Quick Setup

### 1. Create a Telegram bot

Open [@BotFather](https://t.me/BotFather), send `/newbot`, follow the steps, copy the token.

### 2. Set up your Supergroup

- Create a Telegram group → Settings → **Topics: Enable**
- Add your bot as **Admin** with "Manage Topics" permission
- Disable bot privacy mode: BotFather → `/mybots` → your bot → **Bot Settings → Group Privacy → Turn off**

### 3. Get your Chat ID and Thread ID

Add the bot to the group, send a message in the topic you want to use, then:
```bash
curl "https://api.telegram.org/bot<TOKEN>/getUpdates"
```
Look for `chat.id` (a negative number) and `message_thread_id`.

### 4. Configure credentials

Create `~/.claude/channels/telegram/.env`:
```env
TELEGRAM_BOT_TOKEN=your_token_here
TELEGRAM_CHAT_ID=-1001234567890
```

`TELEGRAM_THREAD_ID` is set per-project in `.mcp.json` (see below), since each project uses a different topic.

### 5. Start the routing bot

The routing bot must be running to fan messages into queue files. See the [tmux-telegram](https://github.com/shaike1/tmux-telegram) companion project.

### 6. Add to your project

In your project folder, create `.mcp.json`:
```json
{
  "mcpServers": {
    "telegram": {
      "command": "bun",
      "args": ["run", "--cwd", "/path/to/claude-telegram-channel", "--silent", "start"],
      "env": {
        "TELEGRAM_THREAD_ID": "YOUR_THREAD_ID"
      }
    }
  }
}
```

Replace `/path/to/claude-telegram-channel` with the absolute path where you cloned this repo, and `YOUR_THREAD_ID` with the `message_thread_id` for this project's topic.

### 7. Add CLAUDE.md to your project

Create a `CLAUDE.md` in your project root to tell Claude how to behave:

```markdown
# Claude Telegram Channel

You are connected to a Telegram topic via the `telegram` MCP server.
This is your primary communication channel with the user.

## Behavior

When you receive a message (via tmux or notifications/claude/channel):
1. Call `typing` immediately so the user sees you're working
2. Read the message and respond in the same topic using `send_message`
3. Keep responses concise — this is chat, not a document
4. Use HTML formatting: `<b>bold</b>`, `<i>italic</i>`, `<code>inline code</code>`, `<pre>code block</pre>`

## Formatting rules

- Short answers: plain text or `<code>` for commands/values
- Code snippets: always wrap in `<pre>`
- Lists: use `•` bullets, not markdown `-`
- Never use markdown (`**`, `_`, backtick fences) — Telegram uses HTML mode
- Split very long responses into multiple `send_message` calls

## Important

- Always respond via `send_message` — never leave a message unanswered
- If you're unsure what the user wants, ask in the topic
```

### 8. Launch Claude

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

## Multi-project setup

For managing multiple projects across multiple servers from one Telegram group, the [tmux-telegram](https://github.com/shaike1/tmux-telegram) companion bot:

- Runs the routing bot that fans `getUpdates` into per-topic queue files
- Creates one Telegram topic per project automatically
- Provisions tmux sessions on remote servers via SSH
- Auto-resumes Claude sessions on restart
- Discovers existing Claude project history with `/discover`

Each project's MCP server simply reads its own `/tmp/tg-queue-{THREAD_ID}.jsonl` file — no direct Telegram polling, no conflicts.

---

## Troubleshooting

### MCP server fails to start (no errors shown)

**Symptom:** The `telegram` MCP tool never appears in Claude, or Claude immediately says the tool is unavailable.

**Cause:** `bun` is not in the system PATH that Claude Code uses when spawning MCP servers.

**Fix:**
```bash
sudo ln -sf ~/.bun/bin/bun /usr/local/bin/bun
which bun  # should show /usr/local/bin/bun
```

### 409 Conflict errors

**Symptom:** Messages are not delivered, or you see `409: Conflict: terminated by other getUpdates request` in logs.

**Cause:** Two processes are both calling `getUpdates` with the same bot token. This happens if you accidentally run the old direct-polling version of this server alongside the routing bot.

**Fix:** Make sure only the routing bot polls `getUpdates`. The MCP server in this repo reads queue files only — it never calls `getUpdates`.

### Messages not arriving

**Symptom:** You send a message in Telegram but Claude doesn't respond.

**Checklist:**
1. Is the routing bot running? Check `tmux ls` or your process manager.
2. Does the queue file exist? `ls /tmp/tg-queue-*.jsonl`
3. Is `TELEGRAM_THREAD_ID` in `.mcp.json` correct for this topic?
4. Did you restart Claude after adding/changing `.mcp.json`?

---

## Security

- Only you should be in the Telegram group (or use a private group)
- The bot token is stored in `~/.claude/channels/telegram/.env` — never commit it
- Queue files in `/tmp/` are local to the machine — they don't expose credentials

---

## License

MIT
