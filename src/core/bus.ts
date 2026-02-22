import type { ApprovalRequest, ApprovalResult, InboundMessage, OutboundMessage } from './types.js'

/**
 * Minimal async message bus.
 *
 * Keeps channel adapters and the agent loop decoupled through inbound/outbound queues.
 */
export class MessageBus {
  private inboundQueue: InboundMessage[] = []
  private outboundQueue: OutboundMessage[] = []
  private inboundWaiters: Array<(msg: InboundMessage) => void> = []
  private outboundWaiters: Array<(msg: OutboundMessage) => void> = []

  /** Publishes an inbound message to the agent loop. */
  async publishInbound(msg: InboundMessage): Promise<void> {
    const waiter = this.inboundWaiters.shift()
    if (waiter) {
      waiter(msg)
      return
    }
    this.inboundQueue.push(msg)
  }

  /** Waits for and returns the next inbound message. */
  async consumeInbound(): Promise<InboundMessage> {
    const existing = this.inboundQueue.shift()
    if (existing) return existing
    return new Promise<InboundMessage>((resolve) => this.inboundWaiters.push(resolve))
  }

  /** Publishes an outbound message for channel delivery. */
  async publishOutbound(msg: OutboundMessage): Promise<void> {
    const waiter = this.outboundWaiters.shift()
    if (waiter) {
      waiter(msg)
      return
    }
    this.outboundQueue.push(msg)
  }

  /** Waits for and returns the next outbound message. */
  async consumeOutbound(): Promise<OutboundMessage> {
    const existing = this.outboundQueue.shift()
    if (existing) return existing
    return new Promise<OutboundMessage>((resolve) => this.outboundWaiters.push(resolve))
  }

  // ── Approval request/result channels ──

  private approvalRequestQueue: ApprovalRequest[] = []
  private approvalRequestWaiters: Array<(req: ApprovalRequest) => void> = []
  private approvalResultQueue: ApprovalResult[] = []
  private approvalResultWaiters: Array<(result: ApprovalResult) => void> = []

  /** Publishes an approval request (AgentLoop -> Channel). */
  async publishApprovalRequest(req: ApprovalRequest): Promise<void> {
    const waiter = this.approvalRequestWaiters.shift()
    if (waiter) {
      waiter(req)
      return
    }
    this.approvalRequestQueue.push(req)
  }

  /** Waits for the next approval request. */
  async consumeApprovalRequest(): Promise<ApprovalRequest> {
    const existing = this.approvalRequestQueue.shift()
    if (existing) return existing
    return new Promise<ApprovalRequest>((resolve) => this.approvalRequestWaiters.push(resolve))
  }

  /** Publishes an approval result (Channel -> AgentLoop). */
  async publishApprovalResult(result: ApprovalResult): Promise<void> {
    const waiter = this.approvalResultWaiters.shift()
    if (waiter) {
      waiter(result)
      return
    }
    this.approvalResultQueue.push(result)
  }

  /**
   * Waits for an approval result matching the given requestId, or returns null on timeout.
   */
  async waitForApprovalResult(
    requestId: string,
    timeoutMs: number
  ): Promise<ApprovalResult | null> {
    // Check existing queue first
    const idx = this.approvalResultQueue.findIndex((r) => r.requestId === requestId)
    if (idx >= 0) {
      return this.approvalResultQueue.splice(idx, 1)[0]!
    }

    return new Promise<ApprovalResult | null>((resolve) => {
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        const waiterIdx = this.approvalResultWaiters.indexOf(handler)
        if (waiterIdx >= 0) this.approvalResultWaiters.splice(waiterIdx, 1)
        resolve(null)
      }, timeoutMs)

      const handler = (result: ApprovalResult): void => {
        if (result.requestId === requestId) {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve(result)
        } else {
          // Not ours — put it back
          this.approvalResultQueue.push(result)
          this.approvalResultWaiters.push(handler)
        }
      }

      this.approvalResultWaiters.push(handler)
    })
  }
}
