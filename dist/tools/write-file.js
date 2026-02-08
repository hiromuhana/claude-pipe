import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod/v4';
/** Writes UTF-8 content to a workspace file, creating directories as needed. */
export const writeFileTool = {
    name: 'write_file',
    description: 'Write UTF-8 content to a file and create parent directories if needed.',
    inputSchema: {
        path: z.string(),
        content: z.string()
    },
    async execute(input, ctx) {
        const parsed = z.object({ path: z.string(), content: z.string() }).parse(input);
        const target = resolve(ctx.workspace, parsed.path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, parsed.content, 'utf-8');
        return `Wrote ${parsed.content.length} chars to ${target}`;
    }
};
