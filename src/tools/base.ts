import type { ToolDefinition } from '../core/tool-registry.js'

/**
 * Optional inheritance helper for tools preferring class-based implementation.
 * Current codebase uses object literals, but this stays as a documented extension point.
 */
export abstract class BaseTool implements ToolDefinition {
  abstract name: string
  abstract description: string
  abstract inputSchema: ToolDefinition['inputSchema']
  abstract execute(input: Record<string, unknown>, ctx: { workspace: string; channel: 'telegram' | 'discord'; chatId: string }): Promise<string>
}
