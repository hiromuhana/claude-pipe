import type { ClaudePipeConfig } from '../../config/schema.js'
import type { PermissionMode } from '../../core/types.js'
import type { CommandDefinition, CommandResult } from '../types.js'

const VALID_MODES: readonly PermissionMode[] = ['plan', 'autoEditApprove', 'bypassPermissions']

/** Short aliases that users can type instead of the full mode name. */
const MODE_ALIASES: Record<string, PermissionMode> = {
  auto: 'autoEditApprove',
  bypass: 'bypassPermissions'
}

const MODE_LABELS: Record<PermissionMode, string> = {
  plan: 'plan (all writes require approval)',
  autoEditApprove: 'auto (file edits auto-approved, Bash requires approval)',
  bypassPermissions: 'bypass (all tools auto-approved — USE WITH CAUTION)'
}

function resolveMode(value: string): PermissionMode | undefined {
  if ((VALID_MODES as readonly string[]).includes(value)) return value as PermissionMode
  return MODE_ALIASES[value.toLowerCase()]
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
    usage: '/mode [plan|auto|bypass]',
    aliases: [],
    permission: 'admin',
    async execute(ctx): Promise<CommandResult> {
      if (ctx.args.length === 0 || !ctx.args[0]) {
        const current = getCurrentMode(config)
        const resolved = resolveMode(current)
        const label = resolved ? MODE_LABELS[resolved] : current
        return { content: `Current permission mode: **${label}**` }
      }

      const resolved = resolveMode(ctx.args[0])
      if (!resolved) {
        return {
          content: `Invalid mode: \`${ctx.args[0]}\`\nValid modes: plan, auto, bypass`,
          error: true
        }
      }

      setPermissionMode(config, resolved)
      return {
        content: `Permission mode switched to: **${MODE_LABELS[resolved]}**\nThis applies to new turns from this point.`
      }
    }
  }
}
