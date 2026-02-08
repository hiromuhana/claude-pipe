import { readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

import { z } from 'zod/v4'

import type { ToolDefinition } from '../core/tool-registry.js'

/** Lists files/directories under a workspace-relative path. */
export const listDirTool: ToolDefinition = {
  name: 'list_dir',
  description: 'List directory contents at a given path.',
  inputSchema: {
    path: z.string()
  },
  async execute(input, ctx) {
    const parsed = z.object({ path: z.string() }).parse(input)
    const target = resolve(ctx.workspace, parsed.path)
    const entries = await readdir(target, { withFileTypes: true })
    if (!entries.length) return '(empty)'

    return entries
      .map((entry) => `${entry.isDirectory() ? 'DIR ' : 'FILE'} ${entry.name}`)
      .join('\n')
  }
}
