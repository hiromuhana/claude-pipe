import type { CommandDefinition, CommandContext, CommandResult } from '../types.js'

/**
 * Formats a conversation key like "discord:12345" into a readable label.
 */
function formatKey(key: string): string {
  const [channel, id] = key.split(':', 2)
  if (!channel || !id) return key
  return `${channel} #${id.length > 8 ? id.slice(-8) : id}`
}

/**
 * Formats an ISO timestamp as a relative time string (e.g. "2h ago").
 */
function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 0) return 'just now'
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

/**
 * /new  (aliases: /newsession, /new_session, /reset, /reset_session, /session_new)
 * Starts a fresh Claude session for the current chat.
 */
export function sessionNewCommand(
  startNewSession: (conversationKey: string) => Promise<void>
): CommandDefinition {
  return {
    name: 'session_new',
    category: 'session',
    description: 'Start a new Claude session for this chat',
    usage: '/session_new — clears conversation history and starts fresh',
    aliases: ['new', 'newsession', 'new_session', 'reset', 'reset_session'],
    permission: 'user',
    async execute(ctx: CommandContext): Promise<CommandResult> {
      await startNewSession(ctx.conversationKey)
      return { content: 'Started a new session for this chat.' }
    }
  }
}

/**
 * /session_list
 * Lists active sessions.
 */
export function sessionListCommand(
  listSessions: () => Array<{ key: string; updatedAt: string; topic?: string }>
): CommandDefinition {
  return {
    name: 'session_list',
    category: 'session',
    description: 'List active sessions',
    aliases: [],
    permission: 'admin',
    async execute(): Promise<CommandResult> {
      const sessions = listSessions()
      if (sessions.length === 0) {
        return { content: 'No active sessions.' }
      }
      const lines = sessions.map((s, i) => {
        const label = s.topic ? `"${s.topic}"` : formatKey(s.key)
        const time = formatRelativeTime(s.updatedAt)
        return `${i + 1}. ${label}  _(${time})_`
      })
      return { content: `**Active sessions (${sessions.length}):**\n${lines.join('\n')}` }
    }
  }
}

/**
 * /session_info
 * Shows info about the current chat's session.
 */
export function sessionInfoCommand(
  getSession: (conversationKey: string) => { sessionId: string; updatedAt: string; topic?: string } | undefined
): CommandDefinition {
  return {
    name: 'session_info',
    category: 'session',
    description: 'Show session info for the current chat',
    aliases: [],
    permission: 'user',
    async execute(ctx: CommandContext): Promise<CommandResult> {
      const session = getSession(ctx.conversationKey)
      if (!session) {
        return { content: 'No active session for this chat.' }
      }
      const time = formatRelativeTime(session.updatedAt)
      const lines = [
        '**Session info:**',
        `• Topic: ${session.topic ? `"${session.topic}"` : '(none)'}`,
        `• Session ID: \`${session.sessionId}\``,
        `• Last active: ${time}`
      ]
      return { content: lines.join('\n') }
    }
  }
}

/**
 * /session_delete
 * Deletes the current chat's session.
 */
export function sessionDeleteCommand(
  deleteSession: (conversationKey: string) => Promise<void>
): CommandDefinition {
  return {
    name: 'session_delete',
    category: 'session',
    description: 'Delete the session for the current chat',
    aliases: [],
    permission: 'user',
    async execute(ctx: CommandContext): Promise<CommandResult> {
      await deleteSession(ctx.conversationKey)
      return { content: 'Session deleted for this chat.' }
    }
  }
}
