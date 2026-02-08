# microclaw

TypeScript reimplementation of nanobot core flows using Claude Agent SDK V2.

## Current State

This repository includes a working local runtime with:
- real Telegram inbound/outbound integration (Bot API long polling)
- real Discord inbound/outbound integration (`discord.js` gateway client)
- Claude SDK V2 multi-turn session handling with session resume persistence
- tool calling through an in-process MCP server backed by local TypeScript tools
- unit test suite for core runtime behavior

## Implemented vs Pending

| Area | Status | Notes |
|---|---|---|
| Config loading/validation | Implemented | `zod` schema + `.env` mapping |
| Session persistence | Implemented | JSON map: `conversation_key -> session_id` |
| Agent loop | Implemented | Inbound -> Claude turn -> outbound |
| Claude SDK V2 sessioning | Implemented | create/resume + streaming result handling |
| Tool calling | Implemented | MCP server generated from `ToolRegistry` |
| Telegram adapter | Implemented | Long polling + sendMessage |
| Discord adapter | Implemented | Gateway message events + channel send |
| Unit tests | Implemented | Bus, session store, allow-list, tool registry, agent loop, telegram |
| `spawn` subagents | Out of scope | Deferred by PRD |
| cron/heartbeat | Out of scope | Deferred by PRD |
| media ingestion | Out of scope | Text-only v1 |

## Architecture

```text
Telegram/Discord adapters
        |
        v
    MessageBus (inbound)
        |
        v
      AgentLoop
        |
        v
    ClaudeClient (SDK V2 session)
        |
        v
 MCP tool server (from ToolRegistry)
        |
        v
    local tool modules
        |
        v
    MessageBus (outbound)
        |
        v
Telegram/Discord send
```

## Runtime Contracts

### Conversation key
- Format: `channel:chat_id`
- Examples: `telegram:123456789`, `discord:1122334455`

### Session persistence
- File: `MICROCLAW_SESSION_STORE_PATH`
- Data shape:

```json
{
  "telegram:123456": {
    "sessionId": "...",
    "updatedAt": "2026-02-08T12:00:00.000Z"
  }
}
```

### Tool context per turn
Each tool executes with:
- `workspace`
- `channel`
- `chatId`

This allows the `message` tool to route back to the active conversation by default.

## Modules and Responsibilities

### `/Users/mg/workspace/microclaw/src/index.ts`
Bootstraps config, session store, tools, channel manager, and agent loop.

### `/Users/mg/workspace/microclaw/src/core/agent-loop.ts`
Main processing loop. Reads inbound events, executes one Claude turn, emits outbound response.

### `/Users/mg/workspace/microclaw/src/core/claude-client.ts`
Claude SDK V2 wrapper for:
- session create/resume
- per-conversation in-memory session cache
- stream parsing
- MCP tool server attachment

### `/Users/mg/workspace/microclaw/src/core/mcp-server.ts`
Converts registered TypeScript tools into SDK MCP tools via `createSdkMcpServer`.

### `/Users/mg/workspace/microclaw/src/channels/telegram.ts`
Telegram Bot API polling loop (`getUpdates`) and outbound `sendMessage`.

### `/Users/mg/workspace/microclaw/src/channels/discord.ts`
Discord gateway adapter via `discord.js`, consumes `messageCreate`, posts outbound channel messages.

### `/Users/mg/workspace/microclaw/src/tools/*`
v1 tool implementations:
- `read_file`
- `write_file`
- `edit_file`
- `list_dir`
- `exec`
- `web_search`
- `web_fetch`
- `message`

## Test-First Workflow

Per your requirement, implementation now follows test-first order for each task:
1. add/adjust unit tests
2. implement or refactor code
3. run test suite
4. run build/typecheck

### Current tests
- `/Users/mg/workspace/microclaw/tests/bus.test.ts`
- `/Users/mg/workspace/microclaw/tests/session-store.test.ts`
- `/Users/mg/workspace/microclaw/tests/channel-base.test.ts`
- `/Users/mg/workspace/microclaw/tests/tool-registry.test.ts`
- `/Users/mg/workspace/microclaw/tests/agent-loop.test.ts`
- `/Users/mg/workspace/microclaw/tests/telegram.test.ts`

## Setup

1. Copy env template:
```bash
cp /Users/mg/workspace/microclaw/.env.example /Users/mg/workspace/microclaw/.env
```

2. Fill required values in `.env`:
- Telegram token and/or Discord token
- allow lists as needed
- workspace path
- optional Brave search key

3. Install and validate:
```bash
cd /Users/mg/workspace/microclaw
npm install
npm run test:run
npm run build
```

4. Run:
```bash
npm run dev
```

## Operational Notes

- Channel adapters reply to every text message from allowed senders.
- If allow list is empty for a channel, all senders are allowed.
- Model is fixed to `claude-sonnet-4-5` per PRD decision.
- Permissions are configured to bypass checks in SDK session options, matching your v1 full-permission requirement.

## Known Limitations

- No media/file attachment ingestion yet.
- No cron/heartbeat orchestration.
- No subagent spawn behavior.
- Tool output formatting is intentionally plain text in v1.

## Next Implementation Targets

1. Add unit tests for Discord adapter behavior with mocked gateway events.
2. Add tool safety guardrails and workspace boundary enforcement tests.
3. Add end-to-end acceptance harness for Telegram file-summary flow.
