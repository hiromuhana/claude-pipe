import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { ClaudePipeConfig } from '../config/schema.js'
import type { ModelClient } from './model-client.js'
import { SessionStore } from './session-store.js'
import { TranscriptLogger } from './transcript-logger.js'
import type { AgentTurnUpdate, Logger, PermissionMode, PlanAction, ToolContext, TurnResult } from './types.js'
import { filterEnvForChild } from './env-filter.js'

type JsonRecord = Record<string, unknown>
type AssistantTextBlock = { type: 'text'; text: string }
type AssistantToolUseBlock = {
  type: 'tool_use'
  name: string
  id?: string
  input?: Record<string, unknown>
}
type ToolResultBlock = {
  type: 'tool_result'
  tool_use_id?: string
  content?: unknown
}

function getClaudeCodeExecutablePath(): string {
  const localPath = join(homedir(), '.claude', 'local', 'claude')
  if (existsSync(localPath)) return localPath
  return 'claude'
}

const defaultClaudeArgs = [
  '--print',
  '--verbose',
  '--output-format',
  'stream-json',
  '--permission-mode',
  'plan'
]

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object'
}

function isTextBlock(block: unknown): block is AssistantTextBlock {
  if (!isRecord(block)) return false
  return block.type === 'text' && typeof block.text === 'string'
}

function isToolUseBlock(block: unknown): block is AssistantToolUseBlock {
  if (!isRecord(block)) return false
  return block.type === 'tool_use' && typeof block.name === 'string'
}

function isToolResultBlock(block: unknown): block is ToolResultBlock {
  if (!isRecord(block)) return false
  return block.type === 'tool_result'
}

/**
 * Extracts a short topic string from the user prompt.
 * Strips the summary-template wrapper if present.
 */
function extractTopic(userText: string, maxLen = 60): string {
  const requestMatch = userText.match(/Request:\s*(.+)/i)
  const raw = requestMatch?.[1] ?? userText.split('\n')[0] ?? userText
  const trimmed = raw.trim()
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) + '...' : trimmed
}

function truncate(value: string, max = 2000): string {
  if (value.length <= max) return value
  return `${value.slice(0, max)}...(truncated)`
}

function summarizeToolResult(content: unknown): string {
  if (typeof content === 'string') {
    if (content.includes('API Error:')) return 'tool returned API error'
    return 'tool returned result'
  }
  return 'tool returned result'
}

// ── Plan detection heuristic ──

const EDIT_TOOLS = new Set([
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'TodoWrite',
  'ExitPlanMode'
])

const DANGEROUS_TOOLS = new Set(['Bash'])

const WRITE_TOOLS = new Set([...EDIT_TOOLS, ...DANGEROUS_TOOLS])

const PLAN_PATTERNS = [
  /I(?:'ll|'d like to| will| want to| need to| can)\s+(?:create|modify|write|update|delete|edit|add|remove|change|replace|run|execute|install)/i,
  /(?:here(?:'s| is) (?:my |the )?plan|proposed changes|implementation plan|plan of action)/i,
  /(?:step \d|phase \d|first,? I)/i
]

/**
 * Formats user-facing tool input into a readable Discord message.
 * Returns undefined for non-interactive tools.
 */
function formatInteractiveToolDetail(name: string, input?: Record<string, unknown>): string | undefined {
  if (!input) return undefined

  if (name === 'AskUserQuestion') {
    const questions = Array.isArray(input.questions) ? input.questions : []
    const lines: string[] = []
    for (const q of questions) {
      if (!isRecord(q)) continue
      if (typeof q.question === 'string') lines.push(`**${q.question}**`)
      const options = Array.isArray(q.options) ? q.options : []
      for (let i = 0; i < options.length; i++) {
        const opt = options[i]
        if (isRecord(opt) && typeof opt.label === 'string') {
          lines.push(`${i + 1}. ${opt.label}`)
        }
      }
    }
    return lines.length > 0 ? lines.join('\n') : undefined
  }

  if (name === 'ExitPlanMode') {
    const plan = typeof input.plan === 'string' ? input.plan : undefined
    if (plan) {
      const truncated = plan.length > 1500 ? plan.slice(0, 1500) + '...' : plan
      return `**Plan approval requested**\n${truncated}`
    }
    return '**Plan approval requested**'
  }

  return undefined
}

export function detectPlanInResponse(text: string, toolsUsed: string[]): boolean {
  if (toolsUsed.some((t) => WRITE_TOOLS.has(t))) return true
  return PLAN_PATTERNS.some((p) => p.test(text))
}

/**
 * Determines what action the agent loop should take after the plan phase,
 * based on the detected tools and the current permission mode.
 */
export function getPlanAction(
  text: string,
  toolsUsed: string[],
  mode: PermissionMode
): PlanAction {
  if (mode === 'bypassPermissions') return 'respond'

  const hasWriteTools = toolsUsed.some((t) => WRITE_TOOLS.has(t))
  const hasDangerousTools = toolsUsed.some((t) => DANGEROUS_TOOLS.has(t))
  const hasTextPlan = PLAN_PATTERNS.some((p) => p.test(text))

  if (mode === 'autoEditApprove') {
    if (hasDangerousTools) return 'ask_approval'
    if (hasWriteTools || hasTextPlan) return 'auto_execute'
    return 'respond'
  }

  // plan mode: all writes need approval
  if (hasWriteTools || hasTextPlan) return 'ask_approval'
  return 'respond'
}

/**
 * Reads the current permission mode from config CLI args.
 */
export function getCurrentPermissionMode(config: ClaudePipeConfig): PermissionMode {
  const args = config.claudeCli?.args ?? []
  const idx = args.indexOf('--permission-mode')
  const raw = idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined
  if (raw === 'autoEditApprove' || raw === 'bypassPermissions') return raw
  return 'plan'
}

/**
 * Runs Claude Code through subprocess `stream-json` output and persists session IDs.
 */
export class ClaudeClient implements ModelClient {
  private readonly transcript: TranscriptLogger

  constructor(
    private readonly config: ClaudePipeConfig,
    private readonly store: SessionStore,
    private readonly logger: Logger
  ) {
    this.transcript = new TranscriptLogger({
      enabled: this.config.transcriptLog.enabled,
      path: this.config.transcriptLog.path,
      ...(this.config.transcriptLog.maxBytes != null
        ? { maxBytes: this.config.transcriptLog.maxBytes }
        : {}),
      ...(this.config.transcriptLog.maxFiles != null
        ? { maxFiles: this.config.transcriptLog.maxFiles }
        : {})
    })
  }

  private async publishUpdate(
    context: ToolContext,
    event: AgentTurnUpdate
  ): Promise<void> {
    if (!context.onUpdate) return
    await context.onUpdate(event)
  }

  /**
   * Core subprocess execution. Spawns the Claude CLI, parses stream-json frames,
   * and returns both the response text and metadata about tools used.
   */
  private async _executeTurn(
    conversationKey: string,
    userText: string,
    context: ToolContext,
    argsOverride?: string[]
  ): Promise<{ text: string; toolsUsed: string[] }> {
    const savedSession = this.store.get(conversationKey)
    const executable = this.config.claudeCli?.command?.trim() || getClaudeCodeExecutablePath()
    const baseArgs = argsOverride ?? this.config.claudeCli?.args ?? defaultClaudeArgs
    const args = [...baseArgs, '--model', this.config.model]

    if (savedSession?.sessionId) {
      args.push('--resume', savedSession.sessionId)
    }
    args.push(userText)

    await this.publishUpdate(context, {
      kind: 'turn_started',
      conversationKey,
      message: 'Working on it...'
    })
    await this.transcript.log(conversationKey, { type: 'user', text: userText })

    const child = spawn(executable, args, {
      cwd: this.config.workspace,
      env: filterEnvForChild(process.env)
    })
    this.logger.info('claude.spawn_start', {
      conversationKey,
      executable,
      args
    })
    child.stdin.end()

    let stdoutBuffer = ''
    let stderrBuffer = ''
    let stderrLineBuffer = ''
    let responseText = ''
    let fallbackResultText = ''
    let observedSessionId = savedSession?.sessionId
    let resultIsError = false
    const toolNamesByCallId = new Map<string, string>()
    let frameChain = Promise.resolve()

    const handleFrame = async (frame: unknown): Promise<void> => {
      if (!isRecord(frame) || typeof frame.type !== 'string') return

      if (typeof frame.session_id === 'string' && frame.session_id) {
        observedSessionId = frame.session_id
      }

      await this.transcript.log(conversationKey, { type: frame.type })

      if (frame.type === 'assistant') {
        const message = isRecord(frame.message) ? frame.message : undefined
        const content = Array.isArray(message?.content) ? message.content : []
        const text = content
          .filter((block: unknown) => isTextBlock(block))
          .map((block: AssistantTextBlock) => block.text)
          .join('')
        if (text) {
          responseText = text
          await this.transcript.log(conversationKey, {
            type: 'assistant_text',
            text
          })
        }

        for (const block of content.filter((entry: unknown) => isToolUseBlock(entry))) {
          if (block.id) toolNamesByCallId.set(block.id, block.name)
          this.logger.info('claude.tool_call_started', {
            conversationKey,
            toolName: block.name,
            toolUseId: block.id
          })
          const detail = formatInteractiveToolDetail(block.name, block.input)
          await this.publishUpdate(context, {
            kind: 'tool_call_started',
            conversationKey,
            message: `Using tool: ${block.name}`,
            toolName: block.name,
            ...(block.id ? { toolUseId: block.id } : {}),
            ...(detail ? { detail } : {})
          })
        }
      }

      if (frame.type === 'user') {
        const message = isRecord(frame.message) ? frame.message : undefined
        const content = Array.isArray(message?.content) ? message.content : []
        for (const block of content.filter((entry: unknown) => isToolResultBlock(entry))) {
          const toolUseId = typeof block.tool_use_id === 'string' ? block.tool_use_id : undefined
          const toolName = toolUseId ? toolNamesByCallId.get(toolUseId) : undefined
          const summary = summarizeToolResult(block.content)
          const failed = summary.includes('error')

          if (failed) {
            this.logger.warn('claude.tool_call_failed', {
              conversationKey,
              toolName,
              toolUseId
            })
          } else {
            this.logger.info('claude.tool_call_finished', {
              conversationKey,
              toolName,
              toolUseId
            })
          }

          await this.publishUpdate(context, {
            kind: failed ? 'tool_call_failed' : 'tool_call_finished',
            conversationKey,
            message: failed
              ? `Tool failed${toolName ? `: ${toolName}` : ''}`
              : `Tool completed${toolName ? `: ${toolName}` : ''}`,
            ...(toolName ? { toolName } : {}),
            ...(toolUseId ? { toolUseId } : {})
          })
        }
      }

      if (frame.type === 'result') {
        resultIsError = frame.is_error === true
        if (typeof frame.result === 'string' && frame.result) {
          fallbackResultText = frame.result
        }
      }
    }

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdoutBuffer += chunk.toString()
      let newlineIndex = stdoutBuffer.indexOf('\n')
      while (newlineIndex >= 0) {
        const rawLine = stdoutBuffer.slice(0, newlineIndex)
        const line = rawLine.trim()
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1)
        if (line) {
          this.logger.info('claude.stdout', {
            conversationKey,
            line
          })
          frameChain = frameChain
            .then(async () => {
              const parsed = JSON.parse(line) as unknown
              await handleFrame(parsed)
            })
            .catch((error: unknown) => {
              this.logger.warn('claude.stream_frame_parse_failed', {
                conversationKey,
                error: error instanceof Error ? error.message : String(error),
                line: truncate(line)
              })
            })
        }
        newlineIndex = stdoutBuffer.indexOf('\n')
      }
    })

    child.stderr.on('data', (chunk: Buffer | string) => {
      const text = chunk.toString()
      stderrBuffer += text
      stderrLineBuffer += text
      let newlineIndex = stderrLineBuffer.indexOf('\n')
      while (newlineIndex >= 0) {
        const line = stderrLineBuffer.slice(0, newlineIndex).trim()
        stderrLineBuffer = stderrLineBuffer.slice(newlineIndex + 1)
        if (line) {
          this.logger.info('claude.stderr', {
            conversationKey,
            line
          })
        }
        newlineIndex = stderrLineBuffer.indexOf('\n')
      }
    })

    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        child.on('error', reject)
        child.on('close', (code, signal) => resolve({ code, signal }))
      }
    ).catch((error: unknown) => {
      throw new Error(
        `failed to start claude cli: ${error instanceof Error ? error.message : String(error)}`
      )
    })

    if (stdoutBuffer.trim()) {
      this.logger.info('claude.stdout', {
        conversationKey,
        line: stdoutBuffer.trim()
      })
      frameChain = frameChain
        .then(async () => {
          const parsed = JSON.parse(stdoutBuffer.trim()) as unknown
          await handleFrame(parsed)
        })
        .catch((error: unknown) => {
          this.logger.warn('claude.stream_frame_parse_failed', {
            conversationKey,
            error: error instanceof Error ? error.message : String(error),
            line: truncate(stdoutBuffer.trim())
          })
        })
    }

    await frameChain

    if (stderrLineBuffer.trim()) {
      this.logger.info('claude.stderr', {
        conversationKey,
        line: stderrLineBuffer.trim()
      })
    }

    if (stderrBuffer.trim()) {
      this.logger.info('claude.stderr_summary', {
        conversationKey,
        bytes: stderrBuffer.length
      })
    }

    const failed =
      resultIsError || (exit.code !== 0 && exit.code !== null) || exit.signal !== null
    if (failed) {
      this.logger.error('claude.turn_failed', {
        conversationKey,
        exitCode: exit.code,
        signal: exit.signal,
        hadResultError: resultIsError
      })
      await this.publishUpdate(context, {
        kind: 'turn_finished',
        conversationKey,
        message: 'Turn failed'
      })
      return {
        text: 'Sorry, I hit an error while processing that request.',
        toolsUsed: Array.from(new Set(toolNamesByCallId.values()))
      }
    }

    if (observedSessionId) {
      await this.store.set(conversationKey, observedSessionId, extractTopic(userText))
    }

    this.logger.info('claude.spawn_exit', {
      conversationKey,
      exitCode: exit.code,
      signal: exit.signal,
      resultIsError
    })

    await this.publishUpdate(context, {
      kind: 'turn_finished',
      conversationKey,
      message: 'Turn finished'
    })

    const text = responseText || fallbackResultText || 'I completed processing but have no response to return.'
    return { text, toolsUsed: Array.from(new Set(toolNamesByCallId.values())) }
  }

  /**
   * Executes one turn by spawning the Claude CLI and parsing `stream-json` frames.
   */
  async runTurn(
    conversationKey: string,
    userText: string,
    context: ToolContext
  ): Promise<string> {
    const result = await this._executeTurn(conversationKey, userText, context)
    return result.text
  }

  /**
   * Runs a plan-mode turn and returns rich metadata for the approval flow.
   *
   * Always forces `--permission-mode plan` regardless of the user's current
   * mode setting, so that Claude describes intended changes instead of executing them.
   */
  async runPlanTurn(
    conversationKey: string,
    userText: string,
    context: ToolContext
  ): Promise<TurnResult> {
    // Force plan mode so Claude describes changes instead of executing them
    const planArgs = [...defaultClaudeArgs]
    const result = await this._executeTurn(conversationKey, userText, context, planArgs)
    const hasPlan = detectPlanInResponse(result.text, result.toolsUsed)
    return {
      text: result.text,
      hasPlan,
      toolsUsed: result.toolsUsed
    }
  }

  /**
   * Executes the previously planned changes by temporarily switching to bypassPermissions.
   */
  async runExecuteTurn(
    conversationKey: string,
    context: ToolContext
  ): Promise<string> {
    const originalArgs = [...(this.config.claudeCli?.args ?? defaultClaudeArgs)]
    try {
      this.setPermissionMode('bypassPermissions')
      const result = await this._executeTurn(
        conversationKey,
        'The user has approved the plan. Please proceed with implementing all the changes you described.',
        context
      )
      return result.text
    } finally {
      // Restore original permission mode
      if (this.config.claudeCli) {
        this.config.claudeCli.args = originalArgs
      }
    }
  }

  /**
   * Switches the CLI permission mode at runtime by mutating config args.
   */
  setPermissionMode(mode: PermissionMode): void {
    if (!this.config.claudeCli) return
    if (!this.config.claudeCli.args) {
      this.config.claudeCli.args = [...defaultClaudeArgs]
    }
    const args = this.config.claudeCli.args
    const modeIdx = args.indexOf('--permission-mode')
    if (modeIdx >= 0 && modeIdx + 1 < args.length) {
      args[modeIdx + 1] = mode
    } else {
      args.push('--permission-mode', mode)
    }

    const skipIdx = args.indexOf('--dangerously-skip-permissions')
    if (mode === 'bypassPermissions' && skipIdx < 0) {
      args.push('--dangerously-skip-permissions')
    } else if (mode !== 'bypassPermissions' && skipIdx >= 0) {
      args.splice(skipIdx, 1)
    }
  }

  /** No-op in subprocess-per-turn mode. */
  closeAll(): void {}

  /** Clears persisted session mapping so the next turn starts a fresh Claude session. */
  async startNewSession(conversationKey: string): Promise<void> {
    await this.store.clear(conversationKey)
  }
}
