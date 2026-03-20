#!/usr/bin/env bun
/**
 * Telegram channel for Claude Code.
 *
 * MCP server that connects Claude Code to a Telegram topic (forum thread).
 * One instance per project — each knows its chat_id + thread_id.
 *
 * Config (env or ~/.claude/channels/telegram/.env):
 *   TELEGRAM_BOT_TOKEN  — bot token
 *   TELEGRAM_CHAT_ID    — supergroup chat id (negative number)
 *   TELEGRAM_THREAD_ID  — forum topic thread id
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

// ── config ────────────────────────────────────────────────────────────────────

const ENV_FILE = join(homedir(), '.claude', 'channels', 'telegram', '.env')

try {
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = line.match(/^(\w+)=(.*)$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
  }
} catch {}

const TOKEN     = process.env.TELEGRAM_BOT_TOKEN
const CHAT_ID   = process.env.TELEGRAM_CHAT_ID
const THREAD_ID = process.env.TELEGRAM_THREAD_ID ? parseInt(process.env.TELEGRAM_THREAD_ID) : undefined

if (!TOKEN || !CHAT_ID || !THREAD_ID) {
  process.stderr.write(
    `telegram channel: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TELEGRAM_THREAD_ID required\n` +
    `  set in ${ENV_FILE} or as environment variables\n`
  )
  process.exit(1)
}

const BASE = `https://api.telegram.org/bot${TOKEN}`

// ── telegram helpers ──────────────────────────────────────────────────────────

async function tg(method: string, body: Record<string, unknown> = {}): Promise<unknown> {
  const r = await fetch(`${BASE}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return r.json()
}

async function sendMessage(text: string, replyTo?: number): Promise<number[]> {
  const chunks = text.match(/.{1,4000}/gs) ?? [text]
  const ids: number[] = []
  for (const chunk of chunks) {
    const body: Record<string, unknown> = {
      chat_id: CHAT_ID,
      message_thread_id: THREAD_ID,
      text: chunk,
      parse_mode: 'HTML',
    }
    if (replyTo) { body.reply_to_message_id = replyTo; replyTo = undefined }
    const res = await tg('sendMessage', body) as { ok: boolean; result: { message_id: number } }
    if (res.ok) ids.push(res.result.message_id)
  }
  return ids
}

async function editMessage(messageId: number, text: string): Promise<boolean> {
  const res = await tg('editMessageText', {
    chat_id: CHAT_ID,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
  }) as { ok: boolean }
  return res.ok
}

async function sendTyping(): Promise<void> {
  await tg('sendChatAction', {
    chat_id: CHAT_ID,
    message_thread_id: THREAD_ID,
    action: 'typing',
  })
}

// ── MCP server ────────────────────────────────────────────────────────────────

const mcp = new Server(
  { name: 'telegram-channel', version: '0.1.0' },
  {
    capabilities: {
      tools: {},
      experimental: { 'claude/channel': {} },  // enables notifications/claude/channel
    },
  }
)

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'send_message',
      description: 'Send a message to the Telegram topic. Supports HTML: <b>, <i>, <code>, <pre>.',
      inputSchema: {
        type: 'object',
        required: ['text'],
        properties: {
          text:     { type: 'string',  description: 'Message text (HTML supported)' },
          reply_to: { type: 'integer', description: 'Optional message_id to reply to' },
        },
      },
    },
    {
      name: 'edit_message',
      description: 'Edit a message the bot previously sent.',
      inputSchema: {
        type: 'object',
        required: ['message_id', 'text'],
        properties: {
          message_id: { type: 'integer' },
          text:       { type: 'string' },
        },
      },
    },
    {
      name: 'typing',
      description: 'Show a typing indicator in the topic (lasts ~5s).',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'fetch_messages',
      description: 'Get recent messages from this topic (up to last 50 stored).',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'integer', default: 20, description: 'Max messages to return' },
        },
      },
    },
  ],
}))

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params

  if (name === 'send_message') {
    const ids = await sendMessage(String(args?.text ?? ''), args?.reply_to as number | undefined)
    return { content: [{ type: 'text', text: `Sent. message_ids: ${ids.join(', ')}` }] }
  }

  if (name === 'edit_message') {
    const ok = await editMessage(Number(args?.message_id), String(args?.text ?? ''))
    return { content: [{ type: 'text', text: ok ? 'Edited.' : 'Failed to edit.' }] }
  }

  if (name === 'typing') {
    await sendTyping()
    return { content: [{ type: 'text', text: 'Typing indicator sent.' }] }
  }

  if (name === 'fetch_messages') {
    const limit = Number(args?.limit ?? 20)
    const recent = messageHistory.slice(-limit)
    const lines = recent.map(m =>
      `[${m.ts}] ${m.user} (id:${m.message_id}): ${m.text}`
    )
    return { content: [{ type: 'text', text: lines.join('\n') || 'No messages yet.' }] }
  }

  return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] }
})

// ── message history (in-memory, last 100) ────────────────────────────────────

type TgMessage = {
  message_id: number
  user: string
  text: string
  ts: string
}

const messageHistory: TgMessage[] = []

// ── Telegram poller ───────────────────────────────────────────────────────────

let lastUpdateId = 0

async function poll(): Promise<void> {
  while (true) {
    try {
      const res = await fetch(`${BASE}/getUpdates?offset=${lastUpdateId + 1}&timeout=10&allowed_updates=["message"]`, {
        signal: AbortSignal.timeout(15_000),
      })
      const data = await res.json() as {
        ok: boolean
        result: Array<{
          update_id: number
          message?: {
            message_id: number
            from?: { first_name?: string; is_bot?: boolean }
            chat: { id: number }
            message_thread_id?: number
            text?: string
            date: number
          }
        }>
      }

      if (!data.ok) { await Bun.sleep(2000); continue }

      for (const update of data.result) {
        lastUpdateId = update.update_id
        const msg = update.message
        if (!msg) continue

        // Only our topic, non-bot messages
        if (
          msg.chat.id !== parseInt(CHAT_ID!) ||
          msg.message_thread_id !== THREAD_ID ||
          msg.from?.is_bot
        ) continue

        const text = msg.text ?? ''
        if (!text) continue

        const user = msg.from?.first_name ?? 'user'
        const ts   = new Date(msg.date * 1000).toISOString()

        // Store in history
        messageHistory.push({ message_id: msg.message_id, user, text, ts })
        if (messageHistory.length > 100) messageHistory.shift()

        // Notify Claude — this triggers a new LLM turn
        void mcp.notification({
          method: 'notifications/claude/channel',
          params: {
            content: text,
            meta: {
              chat_id:    CHAT_ID,
              thread_id:  String(THREAD_ID),
              message_id: msg.message_id,
              user,
              ts,
            },
          },
        })

        process.stderr.write(`[telegram] ${user}: ${text}\n`)
      }
    } catch (err) {
      process.stderr.write(`[telegram] poll error: ${err}\n`)
      await Bun.sleep(2000)
    }
  }
}

// ── main ──────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport()
await mcp.connect(transport)

// Start polling after connecting
void poll()

process.stderr.write(`[telegram] MCP server ready — listening on topic ${THREAD_ID} in chat ${CHAT_ID}\n`)
