import { createSdkMcpServer, tool as sdkTool } from '@anthropic-ai/claude-agent-sdk';
function textResult(text) {
    return {
        content: [{ type: 'text', text }]
    };
}
/**
 * Builds an in-process MCP server from registered tools.
 *
 * The resulting server can be passed directly to Claude SDK V2 session options.
 */
export function createToolMcpServer(registry, getContext, logger) {
    const toolDefs = registry.list().map((def) => {
        return sdkTool(def.name, def.description, def.inputSchema, async (args) => {
            const ctx = getContext();
            if (!ctx) {
                return textResult('Error: no active tool context for this turn');
            }
            try {
                const result = await def.execute(args, ctx);
                logger.info('tool.executed', {
                    tool: def.name,
                    channel: ctx.channel,
                    chatId: ctx.chatId
                });
                return textResult(result);
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                logger.error('tool.failed', { tool: def.name, error: message });
                return textResult(`Error executing ${def.name}: ${message}`);
            }
        });
    });
    return createSdkMcpServer({
        name: 'microclaw-tools',
        version: '0.1.0',
        tools: toolDefs
    });
}
