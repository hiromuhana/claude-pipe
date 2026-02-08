import type { ZodRawShape } from 'zod/v4'

import type { ToolContext } from './types.js'

/**
 * Contract for a tool exposed to the model through the local MCP server.
 *
 * Tools are intentionally string-result based to keep the model feedback
 * channel simple and easy to inspect in logs.
 */
export interface ToolDefinition {
  /** Unique tool identifier used by the model. */
  name: string
  /** Human-readable usage description for model selection. */
  description: string
  /** Zod raw shape used by the SDK `tool()` helper for input validation. */
  inputSchema: ZodRawShape
  /**
   * Executes the tool and returns a textual result.
   * Throwing is allowed; the MCP adapter will convert thrown errors to text.
   */
  execute(input: Record<string, unknown>, ctx: ToolContext): Promise<string>
}

/**
 * In-memory registry of all model-callable tools.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>()

  /** Registers or replaces a tool by name. */
  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool)
  }

  /** Gets a tool by name. */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name)
  }

  /** Returns all tools in registration order. */
  list(): ToolDefinition[] {
    return [...this.tools.values()]
  }
}
