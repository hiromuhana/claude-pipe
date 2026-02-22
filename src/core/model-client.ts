import type { PermissionMode, ToolContext, TurnResult } from './types.js'

/**
 * Shared LLM runtime contract used by the agent loop and slash commands.
 */
export interface ModelClient {
  runTurn(conversationKey: string, userText: string, context: ToolContext): Promise<string>
  closeAll(): void
  startNewSession(conversationKey: string): Promise<void>

  /** Run a plan-mode turn that returns rich metadata for the approval flow. */
  runPlanTurn?(conversationKey: string, userText: string, context: ToolContext): Promise<TurnResult>
  /** Execute the previously planned changes with elevated permissions. */
  runExecuteTurn?(conversationKey: string, context: ToolContext): Promise<string>
  /** Switch the underlying CLI permission mode at runtime. */
  setPermissionMode?(mode: PermissionMode): void
}
