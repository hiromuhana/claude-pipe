import { ChannelManager } from './channels/manager.js'
import { loadConfig } from './config/load.js'
import { AgentLoop } from './core/agent-loop.js'
import { MessageBus } from './core/bus.js'
import { ClaudeClient } from './core/claude-client.js'
import { logger } from './core/logger.js'
import { registerTools } from './core/register-tools.js'
import { SessionStore } from './core/session-store.js'
import { ToolRegistry } from './core/tool-registry.js'

/** Boots the Microclaw runtime and starts channel + agent loops. */
async function main(): Promise<void> {
  const config = loadConfig()
  const bus = new MessageBus()

  const sessionStore = new SessionStore(config.sessionStorePath)
  await sessionStore.init()

  const toolRegistry = new ToolRegistry()
  registerTools(toolRegistry, config, bus)

  logger.info('startup.config', {
    workspace: config.workspace,
    model: config.model,
    tools: toolRegistry.list().map((t) => t.name)
  })

  const claude = new ClaudeClient(config, sessionStore, toolRegistry, logger)
  const agent = new AgentLoop(bus, config, claude, logger)
  const channels = new ChannelManager(config, bus, logger)

  const shutdown = async (signal: string): Promise<void> => {
    logger.info('shutdown.signal', { signal })
    agent.stop()
    await channels.stopAll()
  }

  process.on('SIGINT', () => {
    void shutdown('SIGINT')
  })
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM')
  })

  await channels.startAll()
  await agent.start()
}

main().catch((error: unknown) => {
  logger.error('fatal', {
    error: error instanceof Error ? error.message : String(error)
  })
  process.exitCode = 1
})
