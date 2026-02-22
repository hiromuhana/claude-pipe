import type { ClaudePipeConfig } from '../../config/schema.js'
import type { CommandDefinition, CommandResult } from '../types.js'

const VALID_MODES = ['plan', 'bypassPermissions'] as const
type PermissionMode = (typeof VALID_MODES)[number]

const MODE_LABELS: Record<PermissionMode, string> = {
  plan: 'plan (read-only tools auto-approved, writes require confirmation)',
  bypassPermissions: 'bypassPermissions (all tools auto-approved — USE WITH CAUTION)'
}

function isValidMode(value: string): value is PermissionMode {
  return (VALID_MODES as readonly string[]).includes(value)
}

function getCurrentMode(config: ClaudePipeConfig): string {
  const args = config.claudeCli?.args ?? []
  const idx = args.indexOf('--permission-mode')
  if (idx >= 0 && idx + 1 < args.length) {
    return args[idx + 1] ?? 'default'
  }
  return 'default'
}

function setPermissionMode(config: ClaudePipeConfig, mode: PermissionMode): void {
  if (!config.claudeCli) {
    config.claudeCli = { command: 'claude', args: [] }
  }
  if (!config.claudeCli.args) {
    config.claudeCli.args = []
  }

  const args = config.claudeCli.args
  const idx = args.indexOf('--permission-mode')
  if (idx >= 0 && idx + 1 < args.length) {
    args[idx + 1] = mode
  } else {
    args.push('--permission-mode', mode)
  }

  // Add --dangerously-skip-permissions only for bypass mode
  const skipIdx = args.indexOf('--dangerously-skip-permissions')
  if (mode === 'bypassPermissions' && skipIdx < 0) {
    args.push('--dangerously-skip-permissions')
  } else if (mode !== 'bypassPermissions' && skipIdx >= 0) {
    args.splice(skipIdx, 1)
  }
}

/**
 * /mode [plan|bypassPermissions]
 * Shows or switches the Claude CLI permission mode at runtime.
 */
export function modeCommand(config: ClaudePipeConfig): CommandDefinition {
  return {
    name: 'mode',
    category: 'config',
    description: 'Show or switch Claude CLI permission mode',
    usage: '/mode [plan|bypassPermissions]',
    aliases: [],
    permission: 'admin',
    async execute(ctx): Promise<CommandResult> {
      if (ctx.args.length === 0 || !ctx.args[0]) {
        const current = getCurrentMode(config)
        const label = isValidMode(current) ? MODE_LABELS[current] : current
        return { content: `Current permission mode: **${label}**` }
      }

      const requested = ctx.args[0]
      if (!isValidMode(requested)) {
        return {
          content: `Invalid mode: \`${requested}\`\nValid modes: ${VALID_MODES.join(', ')}`,
          error: true
        }
      }

      setPermissionMode(config, requested)
      return {
        content: `Permission mode switched to: **${MODE_LABELS[requested]}**\nThis applies to new turns from this point.`
      }
    }
  }
}
