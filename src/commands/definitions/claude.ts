import type { CommandDefinition, CommandResult } from '../types.js'

/**
 * /claude_model [model_name]
 * Shows or switches the active model.
 */
export function claudeModelCommand(
  getModel: () => string,
  setModel?: (model: string) => void
): CommandDefinition {
  return {
    name: 'claude_model',
    category: 'claude',
    description: 'Show or switch the active Claude model',
    usage: '/claude_model [model_name]',
    aliases: ['model'],
    permission: 'admin',
    async execute(ctx): Promise<CommandResult> {
      if (ctx.args.length === 0 || !ctx.args[0]) {
        return { content: `Current model: ${getModel()}` }
      }
      if (!setModel) {
        return { content: 'Model switching is not supported in this configuration.', error: true }
      }
      const newModel = ctx.args[0]
      setModel(newModel)
      return { content: `Model switched to: ${newModel}` }
    }
  }
}
