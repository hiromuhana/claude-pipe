import { exec as execCb } from 'node:child_process'
import { promisify } from 'node:util'

import { z } from 'zod/v4'

import type { ToolDefinition } from '../core/tool-registry.js'

const exec = promisify(execCb)

/** Builds the shell execution tool with a configurable timeout. */
export function createExecTool(timeoutSec: number): ToolDefinition {
  return {
    name: 'exec',
    description: 'Execute a shell command and return stdout/stderr output.',
    inputSchema: {
      command: z.string(),
      working_dir: z.string().optional()
    },
    async execute(input, ctx) {
      const parsed = z
        .object({
          command: z.string(),
          working_dir: z.string().optional()
        })
        .parse(input)

      const { stdout, stderr } = await exec(parsed.command, {
        cwd: parsed.working_dir ?? ctx.workspace,
        timeout: timeoutSec * 1000,
        maxBuffer: 1024 * 1024
      })

      return [stdout.trim(), stderr.trim() ? `STDERR:\n${stderr.trim()}` : '']
        .filter(Boolean)
        .join('\n') || '(no output)'
    }
  }
}
