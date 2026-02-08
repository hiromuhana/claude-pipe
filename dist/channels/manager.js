import { DiscordChannel } from './discord.js';
import { TelegramChannel } from './telegram.js';
/**
 * Owns channel adapter lifecycle and outbound message dispatching.
 */
export class ChannelManager {
    bus;
    logger;
    channels;
    dispatcherRunning = false;
    constructor(config, bus, logger) {
        this.bus = bus;
        this.logger = logger;
        this.channels = [
            new TelegramChannel(config, bus, logger),
            new DiscordChannel(config, bus, logger)
        ];
    }
    /** Starts all adapters and launches outbound dispatcher. */
    async startAll() {
        for (const channel of this.channels) {
            await channel.start();
        }
        this.dispatcherRunning = true;
        void this.dispatchOutbound();
    }
    /** Stops outbound dispatch and all channel adapters. */
    async stopAll() {
        this.dispatcherRunning = false;
        for (const channel of this.channels) {
            await channel.stop();
        }
    }
    async dispatchOutbound() {
        while (this.dispatcherRunning) {
            const msg = await this.bus.consumeOutbound();
            const channel = this.channels.find((ch) => ch.name === msg.channel);
            if (!channel) {
                this.logger.warn('channel.unknown', { channel: msg.channel });
                continue;
            }
            await channel.send(msg);
        }
    }
}
