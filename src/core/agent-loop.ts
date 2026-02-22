import { randomUUID } from 'node:crypto'

import type { CommandHandler } from '../commands/handler.js'
import type { ClaudePipeConfig } from '../config/schema.js'
import { applySummaryTemplate } from './prompt-template.js'
import { MessageBus } from './bus.js'
import type { ModelClient } from './model-client.js'
import type { AgentTurnUpdate, ApprovalRequest, InboundMessage, Logger, ToolContext } from './types.js'

const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes
const HEARTBEAT_INTERVAL_MS = 30_000 // 30 seconds

/**
 * Central message-processing loop.
 *
 * Consumes inbound chat events, executes one Claude turn, and publishes outbound replies.
 * When a {@link CommandHandler} is provided it intercepts slash commands before they reach the LLM.
 */
export class AgentLoop {
  private running = false
  private readonly lastProgressByConversation = new Map<string, { key: string; at: number }>()
  private commandHandler: CommandHandler | null = null

  constructor(
    private readonly bus: MessageBus,
    private readonly config: ClaudePipeConfig,
    private readonly client: ModelClient,
    private readonly logger: Logger
  ) {}

  /**
   * Runs a long-running async function while periodically sending a heartbeat
   * message to the channel so the user knows the bot is still working.
   */
  private async withHeartbeat<T>(
    inbound: InboundMessage,
    fn: () => Promise<T>
  ): Promise<T> {
    const timer = setInterval(() => {
      void this.bus.publishOutbound({
        channel: inbound.channel,
        chatId: inbound.chatId,
        content: '_Still working..._'
      })
    }, HEARTBEAT_INTERVAL_MS)

    try {
      return await fn()
    } finally {
      clearInterval(timer)
    }
  }

  /** Attaches a command handler for slash-command interception. */
  setCommandHandler(handler: CommandHandler): void {
    this.commandHandler = handler
  }

  /** Starts the infinite processing loop. */
  async start(): Promise<void> {
    this.running = true
    this.logger.info('agent.start', { model: this.config.model })

    while (this.running) {
      const inbound = await this.bus.consumeInbound()
      await this.processMessage(inbound)
    }
  }

  /**
   * Processes exactly one queued inbound message.
   *
   * Useful for deterministic integration/unit testing and acceptance harnesses.
   */
  async processOnce(): Promise<void> {
    const inbound = await this.bus.consumeInbound()
    await this.processMessage(inbound)
  }

  /** Stops the loop and closes live Claude sessions. */
  stop(): void {
    this.running = false
    this.client.closeAll()
  }

  private async processMessage(inbound: InboundMessage): Promise<void> {
    const conversationKey = `${inbound.channel}:${inbound.chatId}`
    this.logger.info('agent.inbound', {
      conversationKey,
      senderId: inbound.senderId
    })

    if (this.commandHandler) {
      const result = await this.commandHandler.execute(
        inbound.content,
        inbound.channel,
        inbound.chatId,
        inbound.senderId
      )
      if (result) {
        await this.bus.publishOutbound({
          channel: inbound.channel,
          chatId: inbound.chatId,
          content: result.content
        })
        this.logger.info('agent.command', { conversationKey, content: inbound.content })
        return
      }
    }

    const modelInput = applySummaryTemplate(
      inbound.content,
      this.config.summaryPrompt,
      this.config.workspace
    )

    const publishProgress = async (update: AgentTurnUpdate): Promise<void> => {
      if (
        update.kind !== 'tool_call_started' &&
        update.kind !== 'tool_call_finished' &&
        update.kind !== 'tool_call_failed'
      ) {
        return
      }

      const key = `${update.kind}:${update.toolName ?? ''}:${update.toolUseId ?? ''}`

      const now = Date.now()
      const recent = this.lastProgressByConversation.get(conversationKey)
      const throttled =
        recent != null &&
        recent.key === key &&
        now - recent.at < 1200 &&
        update.kind !== 'tool_call_started'
      if (throttled) return
      this.lastProgressByConversation.set(conversationKey, { key, at: now })

      this.logger.info('ui.channel.update', {
        conversationKey,
        channel: inbound.channel,
        chatId: inbound.chatId,
        kind: update.kind,
        toolName: update.toolName,
        toolUseId: update.toolUseId,
        message: update.message
      })

      // Forward user-facing tool calls (questions, plan approval) to the channel
      if (update.kind === 'tool_call_started' && update.detail) {
        const INTERACTIVE_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode'])
        if (INTERACTIVE_TOOLS.has(update.toolName ?? '')) {
          await this.bus.publishOutbound({
            channel: inbound.channel,
            chatId: inbound.chatId,
            content: update.detail
          })
        }
      }
    }

    const context: ToolContext = {
      workspace: this.config.workspace,
      channel: inbound.channel,
      chatId: inbound.chatId,
      onUpdate: publishProgress
    }

    // Use two-phase approval flow when the client supports it and channel is Discord
    if (
      inbound.channel === 'discord' &&
      this.client.runPlanTurn &&
      this.client.runExecuteTurn
    ) {
      await this.processTwoPhaseMessage(inbound, conversationKey, modelInput, context)
      return
    }

    const content = await this.withHeartbeat(inbound, () =>
      this.client.runTurn(conversationKey, modelInput, context)
    )

    await this.bus.publishOutbound({
      channel: inbound.channel,
      chatId: inbound.chatId,
      content
    })

    this.logger.info('agent.outbound', { conversationKey })
  }

  /**
   * Two-phase plan→approve→execute flow for channels that support interactive approval (Discord).
   */
  private async processTwoPhaseMessage(
    inbound: InboundMessage,
    conversationKey: string,
    modelInput: string,
    context: ToolContext
  ): Promise<void> {
    // Phase 1: Run plan turn
    const planResult = await this.withHeartbeat(inbound, () =>
      this.client.runPlanTurn!(conversationKey, modelInput, context)
    )

    if (!planResult.hasPlan) {
      // No write operations detected — send response directly
      await this.bus.publishOutbound({
        channel: inbound.channel,
        chatId: inbound.chatId,
        content: planResult.text
      })
      this.logger.info('agent.outbound', { conversationKey, phase: 'plan_only' })
      return
    }

    // Plan detected: send plan text, then request approval
    const approvalId = randomUUID()

    await this.bus.publishOutbound({
      channel: inbound.channel,
      chatId: inbound.chatId,
      content: planResult.text
    })

    const approvalRequest: ApprovalRequest = {
      id: approvalId,
      conversationKey,
      planText: planResult.text,
      createdAt: Date.now(),
      channel: inbound.channel,
      chatId: inbound.chatId,
      senderId: inbound.senderId
    }
    await this.bus.publishApprovalRequest(approvalRequest)

    this.logger.info('agent.approval_requested', {
      conversationKey,
      approvalId,
      toolsUsed: planResult.toolsUsed
    })

    // Wait for user decision
    const result = await this.bus.waitForApprovalResult(approvalId, APPROVAL_TIMEOUT_MS)

    if (!result) {
      await this.bus.publishOutbound({
        channel: inbound.channel,
        chatId: inbound.chatId,
        content: 'Approval timed out (5 minutes). The plan was not executed. Send the request again to retry.'
      })
      this.logger.info('agent.approval_timeout', { conversationKey, approvalId })
      return
    }

    if (result.decision === 'deny') {
      const denyResponse = await this.client.runTurn(
        conversationKey,
        'The user has denied the plan. Do not make any changes. Acknowledge the denial briefly.',
        context
      )
      await this.bus.publishOutbound({
        channel: inbound.channel,
        chatId: inbound.chatId,
        content: denyResponse
      })
      this.logger.info('agent.approval_denied', { conversationKey, approvalId })
      return
    }

    // Approved — execute with elevated permissions
    this.logger.info('agent.approval_approved', { conversationKey, approvalId })

    await this.bus.publishOutbound({
      channel: inbound.channel,
      chatId: inbound.chatId,
      content: 'Approved! Executing the plan now...'
    })

    const executeResponse = await this.withHeartbeat(inbound, () =>
      this.client.runExecuteTurn!(conversationKey, context)
    )

    await this.bus.publishOutbound({
      channel: inbound.channel,
      chatId: inbound.chatId,
      content: executeResponse
    })
    this.logger.info('agent.outbound', { conversationKey, phase: 'execute' })
  }
}
