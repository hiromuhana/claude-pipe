import { z } from 'zod';
const channelSchema = z.object({
    enabled: z.boolean(),
    token: z.string(),
    allowFrom: z.array(z.string())
});
/**
 * Runtime configuration schema for Microclaw.
 */
export const configSchema = z.object({
    model: z.literal('claude-sonnet-4-5').default('claude-sonnet-4-5'),
    workspace: z.string(),
    channels: z.object({
        telegram: channelSchema,
        discord: channelSchema
    }),
    tools: z.object({
        execTimeoutSec: z.number().int().positive(),
        webSearchApiKey: z.string().optional()
    }),
    sessionStorePath: z.string(),
    maxToolIterations: z.number().int().positive().default(20)
});
