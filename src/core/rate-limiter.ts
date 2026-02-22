/**
 * Sliding-window rate limiter.
 *
 * Tracks timestamps per key and rejects requests that exceed the
 * configured maximum within the time window.
 */
export class RateLimiter {
  private readonly timestamps = new Map<string, number[]>()

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number
  ) {}

  /**
   * Returns `true` if the request for `key` is within the rate limit.
   * Records the current timestamp when allowed.
   */
  isAllowed(key: string): boolean {
    const now = Date.now()
    const cutoff = now - this.windowMs
    const existing = this.timestamps.get(key) ?? []
    const recent = existing.filter((ts) => ts > cutoff)

    if (recent.length >= this.maxRequests) {
      this.timestamps.set(key, recent)
      return false
    }

    recent.push(now)
    this.timestamps.set(key, recent)
    return true
  }
}
