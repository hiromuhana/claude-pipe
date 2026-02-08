import { z } from 'zod/v4';
/** Builds a tool that sends asynchronous messages through the outbound bus. */
export function createMessageTool(bus) {
    return {
        name: 'message',
        description: 'Send a message to current or explicitly specified channel/chat.',
        inputSchema: {
            content: z.string(),
            channel: z.enum(['telegram', 'discord']).optional(),
            chat_id: z.string().optional()
        },
        async execute(input, ctx) {
            const parsed = z
                .object({
                content: z.string(),
                channel: z.enum(['telegram', 'discord']).optional(),
                chat_id: z.string().optional()
            })
                .parse(input);
            const channel = parsed.channel ?? ctx.channel;
            const chatId = parsed.chat_id ?? ctx.chatId;
            await bus.publishOutbound({ channel, chatId, content: parsed.content });
            return `Message sent to ${channel}:${chatId}`;
        }
    };
}
