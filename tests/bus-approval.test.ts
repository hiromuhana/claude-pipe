import { describe, it, expect } from 'vitest'
import { MessageBus } from '../src/core/bus.js'
import type { ApprovalRequest, ApprovalResult } from '../src/core/types.js'

function makeRequest(id = 'req-1'): ApprovalRequest {
  return {
    id,
    conversationKey: 'discord:123',
    planText: 'I will edit the file.',
    createdAt: Date.now(),
    channel: 'discord',
    chatId: '123',
    senderId: 'user-1'
  }
}

function makeResult(requestId = 'req-1'): ApprovalResult {
  return { requestId, decision: 'approve', responderId: 'user-1' }
}

describe('MessageBus approval channels', () => {
  it('publishApprovalRequest and consumeApprovalRequest round-trip', async () => {
    const bus = new MessageBus()
    const req = makeRequest()

    await bus.publishApprovalRequest(req)
    const consumed = await bus.consumeApprovalRequest()

    expect(consumed).toEqual(req)
  })

  it('consumeApprovalRequest waits for publish', async () => {
    const bus = new MessageBus()
    const req = makeRequest()

    const promise = bus.consumeApprovalRequest()
    await bus.publishApprovalRequest(req)

    expect(await promise).toEqual(req)
  })

  it('waitForApprovalResult resolves when matching result is published', async () => {
    const bus = new MessageBus()
    const result = makeResult('req-1')

    const promise = bus.waitForApprovalResult('req-1', 5000)
    await bus.publishApprovalResult(result)

    expect(await promise).toEqual(result)
  })

  it('waitForApprovalResult returns null on timeout', async () => {
    const bus = new MessageBus()

    const result = await bus.waitForApprovalResult('req-never', 50)

    expect(result).toBeNull()
  })

  it('waitForApprovalResult resolves immediately if result already queued', async () => {
    const bus = new MessageBus()
    const result = makeResult('req-1')

    await bus.publishApprovalResult(result)
    const consumed = await bus.waitForApprovalResult('req-1', 5000)

    expect(consumed).toEqual(result)
  })

  it('waitForApprovalResult ignores non-matching results', async () => {
    const bus = new MessageBus()

    const promise = bus.waitForApprovalResult('req-1', 200)

    // Publish a result for a different request first
    await bus.publishApprovalResult(makeResult('req-other'))

    // Then publish the matching one
    setTimeout(() => {
      void bus.publishApprovalResult(makeResult('req-1'))
    }, 50)

    const consumed = await promise
    expect(consumed?.requestId).toBe('req-1')
  })
})
