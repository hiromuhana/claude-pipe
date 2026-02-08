import { ChannelType, Client, GatewayIntentBits, Partials } from 'discord.js';
import { isSenderAllowed } from './base.js';
/**
 * Discord adapter using discord.js gateway client + channel send API.
 */
export class DiscordChannel {
    config;
    bus;
    logger;
    name = 'discord';
    client = null;
    constructor(config, bus, logger) {
        this.config = config;
        this.bus = bus;
        this.logger = logger;
    }
    /** Initializes and logs in the Discord bot when enabled. */
    async start() {
        if (!this.config.channels.discord.enabled)
            return;
        if (!this.config.channels.discord.token) {
            this.logger.warn('channel.discord.misconfigured', { reason: 'missing token' });
            return;
        }
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.DirectMessages,
                GatewayIntentBits.MessageContent
            ],
            partials: [Partials.Channel]
        });
        this.client.on('ready', () => {
            this.logger.info('channel.discord.ready', {
                user: this.client?.user?.tag ?? 'unknown'
            });
        });
        this.client.on('messageCreate', async (message) => {
            await this.onMessage(message);
        });
        this.client.on('error', (error) => {
            this.logger.error('channel.discord.error', { error: error.message });
        });
        await this.client.login(this.config.channels.discord.token);
        this.logger.info('channel.discord.start');
    }
    /** Logs out and destroys the Discord client. */
    async stop() {
        if (!this.client)
            return;
        await this.client.destroy();
        this.client = null;
        this.logger.info('channel.discord.stop');
    }
    /** Sends a text message to a Discord channel by ID. */
    async send(message) {
        if (!this.client || !this.config.channels.discord.enabled)
            return;
        const channel = await this.client.channels.fetch(message.chatId);
        if (!channel) {
            this.logger.warn('channel.discord.send_failed', {
                reason: 'channel not found',
                chatId: message.chatId
            });
            return;
        }
        if (!channel.isTextBased() || !('send' in channel) || typeof channel.send !== 'function') {
            this.logger.warn('channel.discord.send_failed', {
                reason: 'channel is not send-capable text channel',
                chatId: message.chatId
            });
            return;
        }
        await channel.send({ content: message.content });
    }
    async onMessage(message) {
        if (message.author.bot)
            return;
        const senderId = message.author.id;
        if (!isSenderAllowed(senderId, this.config.channels.discord.allowFrom)) {
            this.logger.warn('channel.discord.denied', { senderId });
            return;
        }
        if (message.channel.type !== ChannelType.GuildText &&
            message.channel.type !== ChannelType.PublicThread &&
            message.channel.type !== ChannelType.PrivateThread &&
            message.channel.type !== ChannelType.DM) {
            return;
        }
        const inbound = {
            channel: 'discord',
            senderId,
            chatId: message.channelId,
            content: message.content?.trim() || '[empty message]',
            timestamp: new Date().toISOString(),
            metadata: {
                messageId: message.id,
                guildId: message.guildId ?? undefined
            }
        };
        await this.bus.publishInbound(inbound);
    }
}
