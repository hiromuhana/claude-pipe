/**
 * Central message-processing loop.
 *
 * Consumes inbound chat events, executes one Claude turn, and publishes outbound replies.
 */
export class AgentLoop {
    bus;
    config;
    claude;
    logger;
    running = false;
    constructor(bus, config, claude, logger) {
        this.bus = bus;
        this.config = config;
        this.claude = claude;
        this.logger = logger;
    }
    /** Starts the infinite processing loop. */
    async start() {
        this.running = true;
        this.logger.info('agent.start', { model: this.config.model });
        while (this.running) {
            const inbound = await this.bus.consumeInbound();
            const conversationKey = `${inbound.channel}:${inbound.chatId}`;
            this.logger.info('agent.inbound', {
                conversationKey,
                senderId: inbound.senderId
            });
            const content = await this.claude.runTurn(conversationKey, inbound.content, {
                workspace: this.config.workspace,
                channel: inbound.channel,
                chatId: inbound.chatId
            });
            await this.bus.publishOutbound({
                channel: inbound.channel,
                chatId: inbound.chatId,
                content
            });
            this.logger.info('agent.outbound', { conversationKey });
        }
    }
    /** Stops the loop and closes live Claude sessions. */
    stop() {
        this.running = false;
        this.claude.closeAll();
    }
}
