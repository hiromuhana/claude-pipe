import { z } from 'zod/v4';
/** Fetches raw text content from a URL with a bounded response size. */
export const webFetchTool = {
    name: 'web_fetch',
    description: 'Fetch a URL and return text content up to maxChars.',
    inputSchema: {
        url: z.string().url(),
        maxChars: z.number().int().min(100).max(200000).optional()
    },
    async execute(input) {
        const parsed = z
            .object({
            url: z.string().url(),
            maxChars: z.number().int().min(100).max(200000).optional()
        })
            .parse(input);
        const response = await fetch(parsed.url);
        if (!response.ok)
            return `Error: fetch failed (${response.status})`;
        const text = await response.text();
        return text.slice(0, parsed.maxChars ?? 50000);
    }
};
