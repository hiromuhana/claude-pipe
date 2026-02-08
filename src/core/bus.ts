import type { InboundMessage, OutboundMessage } from './types.js'

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
}
