import type { CommandMeta } from '../commands/types.js'
import type { ClaudePipeConfig } from '../config/schema.js'
import { MessageBus } from '../core/bus.js'
import { retry } from '../core/retry.js'
import { chunkText } from '../core/text-chunk.js'
import type { InboundMessage, Logger, OutboundMessage } from '../core/types.js'
import { isSenderAllowed, type Channel } from './base.js'
import type { WebhookServer, WebhookResponse } from './webhook-server.js'

type TelegramUpdate = {
  update_id: number
  message?: {
    message_id: number
    text?: string
    chat: { id: number }
    from?: { id: number }
  }
}

const TELEGRAM_MESSAGE_MAX = 3800
const SEND_RETRY_ATTEMPTS = 2
const SEND_RETRY_BACKOFF_MS = 50

/** Telegram Bot API chat actions for typing indicators. */
type ChatAction = 'typing' | 'upload_photo' | 'upload_video' | 'upload_audio' | 'upload_document' | 'find_location' | 'record_video' | 'record_voice'

/**
 * Telegram adapter using Bot API long polling or webhook mode.
 */
export class TelegramChannel implements Channel {
  readonly name = 'telegram' as const
  private running = false
  private pollTask: Promise<void> | null = null
  private nextOffset = 0
  /** Tracks chat IDs pending responses for typing indicator cleanup. */
  private pendingTyping = new Set<string>()

  constructor(
    private readonly config: ClaudePipeConfig,
    private readonly bus: MessageBus,
    private readonly logger: Logger
  ) {}

  /** Starts background polling when Telegram is enabled (used in non-webhook mode). */
  async start(): Promise<void> {
    if (!this.config.channels.telegram.enabled) return
    if (!this.config.channels.telegram.token) {
      this.logger.warn('channel.telegram.misconfigured', { reason: 'missing token' })
      return
    }

    // In webhook mode, registration happens via registerWebhook()
    if (this.config.webhook.enabled) return

    this.running = true
    this.pollTask = this.pollLoop()
    this.logger.info('channel.telegram.start')
  }

  /**
   * Registers webhook routes and sets the Telegram webhook URL.
   * Called by ChannelManager when webhook mode is enabled.
   */
  async registerWebhook(server: WebhookServer): Promise<void> {
    if (!this.config.channels.telegram.enabled) return
    if (!this.config.channels.telegram.token) return

    const secret = this.config.channels.telegram.webhookSecret
    server.addRoute('/webhook/telegram', async (body, req) => {
      return this.handleWebhookRequest(body, req, secret)
    })

    // Register the webhook URL with Telegram API
    const webhookUrl = this.config.webhook.url.replace(/\/$/, '') + '/webhook/telegram'
    await this.setWebhook(webhookUrl, secret)
    this.running = true
    this.logger.info('channel.telegram.webhook_registered', { url: webhookUrl })
  }

  /** Stops polling and waits for loop completion. Removes webhook if set. */
  async stop(): Promise<void> {
    this.running = false
    if (this.config.webhook.enabled && this.config.channels.telegram.enabled) {
      await this.deleteWebhook()
    }
    await this.pollTask
    this.logger.info('channel.telegram.stop')
  }

  /** Sends a text response to Telegram chat. */
  async send(message: OutboundMessage): Promise<void> {
    if (!this.config.channels.telegram.enabled) return
    if (message.metadata?.kind === 'progress') {
      await this.sendChatAction(message.chatId, 'typing')
      return
    }

    const token = this.config.channels.telegram.token
    const url = `https://api.telegram.org/bot${token}/sendMessage`
    const chunks = chunkText(message.content, TELEGRAM_MESSAGE_MAX)

    for (const part of chunks) {
      try {
        await retry(
          async () => {
            const response = await fetch(url, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                chat_id: Number(message.chatId),
                text: part,
                parse_mode: 'Markdown'
              })
            })

            if (!response.ok) {
              const body = await response.text()
              throw new Error(`telegram send failed (${response.status}): ${body}`)
            }
          },
          {
            attempts: SEND_RETRY_ATTEMPTS,
            backoffMs: SEND_RETRY_BACKOFF_MS
          }
        )
      } catch (error) {
        this.logger.error('channel.telegram.send_failed', {
          chatId: message.chatId,
          error: error instanceof Error ? error.message : String(error)
        })
        break
      }
    }

    // Clear typing indicator after response is sent
    this.pendingTyping.delete(message.chatId)
  }

  /** Sends a chat action (typing, uploading, etc.) to Telegram. */
  private async sendChatAction(chatId: string, action: ChatAction): Promise<void> {
    const token = this.config.channels.telegram.token
    const url = `https://api.telegram.org/bot${token}/sendChatAction`

    try {
      await retry(
        async () => {
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              chat_id: Number(chatId),
              action
            })
          })

          if (!response.ok) {
            const body = await response.text()
            throw new Error(`telegram sendChatAction failed (${response.status}): ${body}`)
          }
        },
        {
          attempts: 1,
          backoffMs: 0
        }
      )
    } catch {
      // Silently fail - typing indicator is non-critical
    }
  }

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        const updates = await this.getUpdates()
        for (const update of updates) {
          this.nextOffset = Math.max(this.nextOffset, update.update_id + 1)
          if (!update.message) continue
          await this.handleMessage(update)
        }
      } catch (error) {
        this.logger.error('channel.telegram.poll_error', {
          error: error instanceof Error ? error.message : String(error)
        })
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    }
  }

  private async getUpdates(): Promise<TelegramUpdate[]> {
    const token = this.config.channels.telegram.token
    const url = new URL(`https://api.telegram.org/bot${token}/getUpdates`)
    url.searchParams.set('timeout', '25')
    url.searchParams.set('offset', String(this.nextOffset))

    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Telegram getUpdates failed: ${response.status}`)
    }

    const json = (await response.json()) as { ok: boolean; result: TelegramUpdate[] }
    if (!json.ok) return []
    return json.result ?? []
  }

  private async handleMessage(update: TelegramUpdate): Promise<void> {
    const message = update.message
    if (!message?.from) return

    const senderId = String(message.from.id)
    if (!isSenderAllowed(senderId, this.config.channels.telegram.allowFrom)) {
      this.logger.warn('channel.telegram.denied', { senderId })
      return
    }

    const chatId = String(message.chat.id)
    // Show typing indicator while agent processes the message
    this.pendingTyping.add(chatId)
    await this.sendChatAction(chatId, 'typing')

    const inbound: InboundMessage = {
      channel: 'telegram',
      senderId,
      chatId,
      content: message.text?.trim() || '[empty message]',
      timestamp: new Date().toISOString(),
      metadata: {
        messageId: message.message_id
      }
    }

    await this.bus.publishInbound(inbound)
  }

  /* ------------------------------------------------------------------ */
  /*  Webhook-specific helpers                                           */
  /* ------------------------------------------------------------------ */

  private async handleWebhookRequest(
    body: string,
    req: import('node:http').IncomingMessage,
    secret: string
  ): Promise<WebhookResponse> {
    // Verify secret token header if configured
    if (secret) {
      const headerSecret = req.headers['x-telegram-bot-api-secret-token']
      if (headerSecret !== secret) {
        this.logger.warn('channel.telegram.webhook_unauthorized')
        return { status: 401, body: JSON.stringify({ error: 'unauthorized' }) }
      }
    }

    try {
      const update = JSON.parse(body) as TelegramUpdate
      if (update.message) {
        await this.handleMessage(update)
      }
      return { status: 200, body: JSON.stringify({ ok: true }) }
    } catch (error) {
      this.logger.error('channel.telegram.webhook_parse_error', {
        error: error instanceof Error ? error.message : String(error)
      })
      return { status: 400, body: JSON.stringify({ error: 'bad request' }) }
    }
  }

  private async setWebhook(url: string, secret: string): Promise<void> {
    const token = this.config.channels.telegram.token
    const apiUrl = `https://api.telegram.org/bot${token}/setWebhook`

    const payload: Record<string, unknown> = { url }
    if (secret) {
      payload.secret_token = secret
    }

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Telegram setWebhook failed (${response.status}): ${text}`)
    }
  }

  private async deleteWebhook(): Promise<void> {
    const token = this.config.channels.telegram.token
    const apiUrl = `https://api.telegram.org/bot${token}/deleteWebhook`

    try {
      await fetch(apiUrl, { method: 'POST' })
    } catch {
      // Best-effort cleanup
    }
  }

  /**
   * Registers bot commands with Telegram's BotFather via the `setMyCommands` API.
   *
   * Should be called once during deployment.
   * Accepts command metadata from {@link CommandRegistry.toMeta()}.
   */
  static async registerBotCommands(
    token: string,
    commands: CommandMeta[],
    logger: Logger
  ): Promise<void> {
    const body = commands.map((cmd) => ({
      command: cmd.telegramName,
      description: cmd.description
    }))

    const url = `https://api.telegram.org/bot${token}/setMyCommands`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ commands: body })
    })

    if (!response.ok) {
      const text = await response.text()
      logger.error('channel.telegram.set_commands_failed', { status: response.status, body: text })
      return
    }

    logger.info('channel.telegram.commands_registered', { count: body.length })
  }

  /**
   * Generates a BotFather-compatible command list string.
   *
   * Useful for manual `/setcommands` configuration.
   */
  static formatBotFatherCommands(commands: CommandMeta[]): string {
    return commands.map((cmd) => `${cmd.telegramName} - ${cmd.description}`).join('\n')
  }
}
