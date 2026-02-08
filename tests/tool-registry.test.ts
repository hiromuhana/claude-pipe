import { describe, expect, it } from 'vitest'
import { z } from 'zod/v4'

import { ToolRegistry, type ToolDefinition } from '../src/core/tool-registry.js'

const tool: ToolDefinition = {
  name: 'example',
  description: 'example tool',
  inputSchema: { message: z.string() },
  async execute() {
    return 'ok'
  }
}

describe('ToolRegistry', () => {
  it('registers and resolves tools by name', () => {
    const registry = new ToolRegistry()
    registry.register(tool)

    expect(registry.get('example')).toBeDefined()
    expect(registry.get('missing')).toBeUndefined()
    expect(registry.list()).toHaveLength(1)
  })
})
