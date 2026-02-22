import type { ChannelName } from '../../core/types.js'
import type { CommandDefinition, CommandResult } from '../types.js'

const COMPACT_PROMPT = [
  'Summarize our conversation so far concisely.',
  'Include: key decisions made, code changes discussed or applied,',
  'current state, and any pending tasks.',
  'Max 300 words. Output ONLY the summary with no preamble or commentary.'
].join(' ')

const COMPACT_SEED_PREFIX =
  '[Context carried over from previous conversation]\n\n'

const COMPACT_SEED_SUFFIX =
  '\n\n[End of context. Continue naturally from the next user message without acknowledging this summary.]'

/**
 * /clear (aliases: cls)
 * Clears conversation history and starts a fresh session.
 */
export function clearCommand(
  startNewSession: (conversationKey: string) => Promise<void>
): CommandDefinition {
  return {
    name: 'clear',
    category: 'utility',
    description: 'Clear conversation history',
    usage: '/clear — clears all conversation history for this chat',
    aliases: ['cls'],
    permission: 'user',
    async execute(ctx): Promise<CommandResult> {
      await startNewSession(ctx.conversationKey)
      return { content: 'Conversation cleared.' }
    }
  }
}

/**
 * /compact
 * Summarizes the current conversation, clears the session,
 * and seeds a new session with the summary as context.
 */
export function compactCommand(
  startNewSession: (conversationKey: string) => Promise<void>,
  runTurn: (
    conversationKey: string,
    prompt: string,
    channel: ChannelName,
    chatId: string
  ) => Promise<string>
): CommandDefinition {
  return {
    name: 'compact',
    category: 'utility',
    description: 'Summarize conversation and continue with reduced context',
    usage: '/compact — compresses conversation history while preserving key context',
    aliases: [],
    permission: 'user',
    async execute(ctx): Promise<CommandResult> {
      // Phase 1: Ask Claude to summarize the current conversation
      let summary: string
      try {
        summary = await runTurn(
          ctx.conversationKey,
          COMPACT_PROMPT,
          ctx.channel,
          ctx.chatId
        )
      } catch {
        return {
          content: 'Failed to generate conversation summary.',
          error: true
        }
      }

      if (!summary.trim()) {
        return { content: 'No conversation to compact.', error: true }
      }

      // Phase 2: Clear the session
      await startNewSession(ctx.conversationKey)

      // Phase 3: Seed the new session with summary as context
      try {
        await runTurn(
          ctx.conversationKey,
          `${COMPACT_SEED_PREFIX}${summary}${COMPACT_SEED_SUFFIX}`,
          ctx.channel,
          ctx.chatId
        )
      } catch {
        // Seeding failed — session is cleared but has no prior context.
        return {
          content: `Conversation cleared but failed to seed context.\n\n**Summary:**\n${summary}`
        }
      }

      return {
        content: `Conversation compacted.\n\n**Summary:**\n${summary}`
      }
    }
  }
}
