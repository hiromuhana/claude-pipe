import { unstable_v2_createSession, unstable_v2_resumeSession } from '@anthropic-ai/claude-agent-sdk';
import { createToolMcpServer } from './mcp-server.js';
function isTextBlock(block) {
    if (!block || typeof block !== 'object')
        return false;
    const candidate = block;
    return candidate.type === 'text' && typeof candidate.text === 'string';
}
function extractSessionId(msg) {
    return 'session_id' in msg ? msg.session_id : undefined;
}
function getAssistantText(msg) {
    if (msg.type !== 'assistant')
        return '';
    return msg.message.content
        .filter((block) => isTextBlock(block))
        .map((block) => block.text)
        .join('');
}
/**
 * Manages Claude SDK V2 sessions and turn execution.
 *
 * Sessions are keyed by normalized conversation key (`channel:chat_id`) and persisted
 * as session IDs through `SessionStore`.
 */
export class ClaudeClient {
    config;
    store;
    registry;
    logger;
    sessions = new Map();
    mcpServer;
    activeToolContext = null;
    constructor(config, store, registry, logger) {
        this.config = config;
        this.store = store;
        this.registry = registry;
        this.logger = logger;
        this.mcpServer = createToolMcpServer(this.registry, () => this.activeToolContext, this.logger);
    }
    /**
     * Executes a single conversational turn with tool support.
     */
    async runTurn(conversationKey, userText, context) {
        const session = this.getOrCreateSession(conversationKey);
        let responseText = '';
        let observedSessionId = this.store.get(conversationKey)?.sessionId;
        this.activeToolContext = context;
        try {
            await session.send(userText);
            for await (const msg of session.stream()) {
                const sid = extractSessionId(msg);
                if (sid)
                    observedSessionId = sid;
                if (msg.type === 'assistant') {
                    const assistantText = getAssistantText(msg);
                    if (assistantText)
                        responseText = assistantText;
                }
                if (msg.type === 'result') {
                    if (msg.is_error) {
                        this.logger.warn('claude.result_error', {
                            conversationKey,
                            subtype: msg.subtype,
                            errors: 'errors' in msg ? msg.errors : undefined
                        });
                    }
                    break;
                }
            }
            if (!observedSessionId) {
                try {
                    observedSessionId = session.sessionId;
                }
                catch {
                    // Ignore: session ID is unavailable until initialized.
                }
            }
            if (observedSessionId) {
                await this.store.set(conversationKey, observedSessionId);
            }
            return responseText || 'I completed processing but have no response to return.';
        }
        catch (error) {
            this.logger.error('claude.turn_failed', {
                conversationKey,
                error: error instanceof Error ? error.message : String(error)
            });
            return 'Sorry, I hit an error while processing that request.';
        }
        finally {
            this.activeToolContext = null;
        }
    }
    /** Closes all live sessions and releases process resources. */
    closeAll() {
        for (const session of this.sessions.values()) {
            session.close();
        }
        this.sessions.clear();
    }
    getOrCreateSession(conversationKey) {
        const cached = this.sessions.get(conversationKey);
        if (cached)
            return cached;
        const saved = this.store.get(conversationKey);
        const baseOptions = {
            model: this.config.model,
            cwd: this.config.workspace,
            permissionMode: 'bypassPermissions',
            allowDangerouslySkipPermissions: true,
            systemPrompt: {
                type: 'preset',
                preset: 'claude_code',
                append: 'You are microclaw. Prefer MCP tools for file/web/shell operations. ' +
                    'For normal chat replies, return direct text responses.'
            },
            tools: [],
            mcpServers: {
                microclaw: this.mcpServer
            }
        };
        const session = saved
            ? unstable_v2_resumeSession(saved.sessionId, baseOptions)
            : unstable_v2_createSession(baseOptions);
        this.sessions.set(conversationKey, session);
        return session;
    }
}
