import { describe, it, expect, vi, beforeEach } from 'vitest'
import { clearCommand, compactCommand } from '../src/commands/definitions/conversation.js'
import type { CommandContext } from '../src/commands/types.js'

function makeContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    channel: 'discord',
    chatId: 'ch-1',
    senderId: 'user-1',
    conversationKey: 'discord:ch-1',
    args: [],
    rawArgs: '',
    ...overrides
  }
}

describe('clearCommand', () => {
  const startNewSession = vi.fn<[string], Promise<void>>().mockResolvedValue(undefined)

  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('calls startNewSession with the conversation key', async () => {
    const cmd = clearCommand(startNewSession)
    await cmd.execute(makeContext())

    expect(startNewSession).toHaveBeenCalledWith('discord:ch-1')
  })

  it('returns a confirmation message', async () => {
    const cmd = clearCommand(startNewSession)
    const result = await cmd.execute(makeContext())

    expect(result.content).toBe('Conversation cleared.')
    expect(result.error).toBeUndefined()
  })

  it('has correct metadata', () => {
    const cmd = clearCommand(startNewSession)

    expect(cmd.name).toBe('clear')
    expect(cmd.category).toBe('utility')
    expect(cmd.aliases).toContain('cls')
    expect(cmd.permission).toBe('user')
  })
})

describe('compactCommand', () => {
  const startNewSession = vi.fn<[string], Promise<void>>().mockResolvedValue(undefined)
  const runTurn = vi.fn<[string, string, string, string], Promise<string>>()

  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('summarizes, clears, and seeds a new session', async () => {
    runTurn
      .mockResolvedValueOnce('Key decisions: use TypeScript. Current state: tests passing.')
      .mockResolvedValueOnce('Understood.')

    const cmd = compactCommand(startNewSession, runTurn)
    const result = await cmd.execute(makeContext())

    // Phase 1: summary request
    expect(runTurn).toHaveBeenCalledTimes(2)
    expect(runTurn.mock.calls[0]?.[1]).toContain('Summarize')

    // Phase 2: session cleared
    expect(startNewSession).toHaveBeenCalledWith('discord:ch-1')

    // Phase 3: seeded with summary
    expect(runTurn.mock.calls[1]?.[1]).toContain('Key decisions: use TypeScript')
    expect(runTurn.mock.calls[1]?.[1]).toContain('[Context carried over')

    // Result includes summary
    expect(result.content).toContain('Conversation compacted.')
    expect(result.content).toContain('Key decisions: use TypeScript')
    expect(result.error).toBeUndefined()
  })

  it('returns error when summary generation fails', async () => {
    runTurn.mockRejectedValueOnce(new Error('CLI crashed'))

    const cmd = compactCommand(startNewSession, runTurn)
    const result = await cmd.execute(makeContext())

    expect(result.error).toBe(true)
    expect(result.content).toBe('Failed to generate conversation summary.')
    expect(startNewSession).not.toHaveBeenCalled()
  })

  it('returns error when summary is empty', async () => {
    runTurn.mockResolvedValueOnce('   ')

    const cmd = compactCommand(startNewSession, runTurn)
    const result = await cmd.execute(makeContext())

    expect(result.error).toBe(true)
    expect(result.content).toBe('No conversation to compact.')
    expect(startNewSession).not.toHaveBeenCalled()
  })

  it('handles seed failure gracefully', async () => {
    runTurn
      .mockResolvedValueOnce('Summary of our work.')
      .mockRejectedValueOnce(new Error('seed failed'))

    const cmd = compactCommand(startNewSession, runTurn)
    const result = await cmd.execute(makeContext())

    expect(startNewSession).toHaveBeenCalled()
    expect(result.content).toContain('failed to seed context')
    expect(result.content).toContain('Summary of our work.')
    expect(result.error).toBeUndefined()
  })

  it('has correct metadata', () => {
    const cmd = compactCommand(startNewSession, runTurn)

    expect(cmd.name).toBe('compact')
    expect(cmd.category).toBe('utility')
    expect(cmd.permission).toBe('user')
  })
})
