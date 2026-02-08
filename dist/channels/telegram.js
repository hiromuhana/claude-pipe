import { isSenderAllowed } from './base.js';
/**
 * Telegram adapter using Bot API long polling.
 */
export class TelegramChannel {
    config;
    bus;
    logger;
    name = 'telegram';
    running = false;
    pollTask = null;
    nextOffset = 0;
    constructor(config, bus, logger) {
        this.config = config;
        this.bus = bus;
        this.logger = logger;
    }
    /** Starts background polling when Telegram is enabled. */
    async start() {
        if (!this.config.channels.telegram.enabled)
            return;
        if (!this.config.channels.telegram.token) {
            this.logger.warn('channel.telegram.misconfigured', { reason: 'missing token' });
            return;
        }
        this.running = true;
        this.pollTask = this.pollLoop();
        this.logger.info('channel.telegram.start');
    }
    /** Stops polling and waits for loop completion. */
    async stop() {
        this.running = false;
        await this.pollTask;
        this.logger.info('channel.telegram.stop');
    }
    /** Sends a text response to Telegram chat. */
    async send(message) {
        if (!this.config.channels.telegram.enabled)
            return;
        const token = this.config.channels.telegram.token;
        const url = `https://api.telegram.org/bot${token}/sendMessage`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                chat_id: Number(message.chatId),
                text: message.content
            })
        });
        if (!response.ok) {
            const body = await response.text();
            this.logger.error('channel.telegram.send_failed', {
                chatId: message.chatId,
                status: response.status,
                body
            });
        }
    }
    async pollLoop() {
        while (this.running) {
            try {
                const updates = await this.getUpdates();
                for (const update of updates) {
                    this.nextOffset = Math.max(this.nextOffset, update.update_id + 1);
                    if (!update.message)
                        continue;
                    await this.handleMessage(update);
                }
            }
            catch (error) {
                this.logger.error('channel.telegram.poll_error', {
                    error: error instanceof Error ? error.message : String(error)
                });
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }
        }
    }
    async getUpdates() {
        const token = this.config.channels.telegram.token;
        const url = new URL(`https://api.telegram.org/bot${token}/getUpdates`);
        url.searchParams.set('timeout', '25');
        url.searchParams.set('offset', String(this.nextOffset));
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Telegram getUpdates failed: ${response.status}`);
        }
        const json = (await response.json());
        if (!json.ok)
            return [];
        return json.result ?? [];
    }
    async handleMessage(update) {
        const message = update.message;
        if (!message?.from)
            return;
        const senderId = String(message.from.id);
        if (!isSenderAllowed(senderId, this.config.channels.telegram.allowFrom)) {
            this.logger.warn('channel.telegram.denied', { senderId });
            return;
        }
        const inbound = {
            channel: 'telegram',
            senderId,
            chatId: String(message.chat.id),
            content: message.text?.trim() || '[empty message]',
            timestamp: new Date().toISOString(),
            metadata: {
                messageId: message.message_id
            }
        };
        await this.bus.publishInbound(inbound);
    }
}
