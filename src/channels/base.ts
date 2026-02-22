import type { InboundMessage, OutboundMessage } from '../core/types.js'

/**
 * Common channel adapter contract.
 */
export interface Channel {
  readonly name: InboundMessage['channel']
  start(): Promise<void>
  stop(): Promise<void>
  send(message: OutboundMessage): Promise<void>
}

/**
 * Shared helper for allow-list decisions.
 *
 * Fail-closed: an empty allow-list denies everyone.
 * Callers that need open-by-default semantics (e.g. CLI) must handle
 * the empty-list case before calling this function.
 */
export function isSenderAllowed(senderId: string, allowFrom: string[]): boolean {
  if (allowFrom.length === 0) return false
  return allowFrom.includes(senderId)
}
