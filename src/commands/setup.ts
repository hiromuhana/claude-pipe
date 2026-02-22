import type { ClaudePipeConfig } from '../config/schema.js'
import type { ModelClient } from '../core/model-client.js'
import type { SessionStore } from '../core/session-store.js'
import {
  sessionNewCommand,
  sessionListCommand,
  sessionInfoCommand,
  sessionDeleteCommand
} from './definitions/session.js'
import { helpCommand, statusCommand, pingCommand } from './definitions/utility.js'
import { claudeModelCommand } from './definitions/claude.js'
import { configSetCommand, configGetCommand } from './definitions/config.js'
import { modeCommand } from './definitions/mode.js'
import { clearCommand, compactCommand } from './definitions/conversation.js'
import { CommandHandler } from './handler.js'
import { CommandRegistry } from './registry.js'
import type { CommandDefinition } from './types.js'

/**
 * Dependencies required by built-in commands.
 */
export interface CommandDependencies {
  config: ClaudePipeConfig
  claude: ModelClient
  sessionStore: SessionStore
}

/**
 * Options for the command setup.
 */
export interface SetupCommandsOptions {
  /** Additional custom commands to register alongside built-ins. */
  customCommands?: CommandDefinition[]
  /** Sender IDs that have admin-level permission. */
  adminIds?: string[]
}

/**
 * Automatically registers all built-in commands and any custom commands,
 * then returns a ready-to-use {@link CommandHandler}.
 *
 * This replaces manual per-command wiring in the application bootstrap.
 */
export function setupCommands(
  deps: CommandDependencies,
  options: SetupCommandsOptions = {}
): { registry: CommandRegistry; handler: CommandHandler } {
  const { config, claude, sessionStore } = deps
  const registry = new CommandRegistry()

  // --- Session commands ---
  registry.register(sessionNewCommand((key) => claude.startNewSession(key)))
  registry.register(
    sessionListCommand(() => {
      const map = sessionStore.entries()
      const result: Array<{ key: string; updatedAt: string; topic?: string }> = []
      for (const key of Object.keys(map)) {
        const record = map[key]
        if (!record) continue
        const entry: { key: string; updatedAt: string; topic?: string } = { key, updatedAt: record.updatedAt }
        if (record.topic) entry.topic = record.topic
        result.push(entry)
      }
      return result
    })
  )
  registry.register(sessionInfoCommand((key) => sessionStore.get(key)))
  registry.register(sessionDeleteCommand((key) => claude.startNewSession(key)))

  // --- Claude commands ---
  registry.register(claudeModelCommand(() => config.model))

  // --- Config commands ---
  const mutableConfig: Record<string, string> = {}
  registry.register(
    configSetCommand((key, value) => {
      const allowed = ['summaryPromptEnabled']
      if (!allowed.includes(key)) return false
      mutableConfig[key] = value
      return true
    })
  )
  registry.register(
    configGetCommand((key) => {
      if (key) return mutableConfig[key]
      return { model: config.model, workspace: config.workspace, ...mutableConfig }
    })
  )

  // --- Conversation commands ---
  registry.register(clearCommand((key) => claude.startNewSession(key)))
  registry.register(
    compactCommand(
      (key) => claude.startNewSession(key),
      async (conversationKey, prompt, channel, chatId) =>
        claude.runTurn(conversationKey, prompt, {
          workspace: config.workspace,
          channel,
          chatId
        })
    )
  )

  // --- Mode command ---
  registry.register(modeCommand(config))

  // --- Utility commands ---
  registry.register(
    statusCommand(() => ({
      model: config.model,
      workspace: config.workspace,
      channels: [
        ...(config.channels.telegram.enabled ? ['telegram'] : []),
        ...(config.channels.discord.enabled ? ['discord'] : []),
        ...(config.channels.cli?.enabled ? ['cli'] : [])
      ]
    }))
  )
  registry.register(pingCommand())

  // --- Custom commands ---
  for (const cmd of options.customCommands ?? []) {
    registry.register(cmd)
  }

  // Help must be registered last so it can list all commands including custom ones
  registry.register(helpCommand(registry))

  const adminIds = options.adminIds ?? [
    ...config.channels.telegram.allowFrom,
    ...config.channels.discord.allowFrom
  ]

  return { registry, handler: new CommandHandler(registry, adminIds) }
}
