import { describe, expect, it, vi, afterEach } from 'vitest'

import { RateLimiter } from '../src/core/rate-limiter.js'

describe('RateLimiter', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('allows requests within the limit', () => {
    const limiter = new RateLimiter(3, 60_000)

    expect(limiter.isAllowed('user-1')).toBe(true)
    expect(limiter.isAllowed('user-1')).toBe(true)
    expect(limiter.isAllowed('user-1')).toBe(true)
  })

  it('blocks requests exceeding the limit', () => {
    const limiter = new RateLimiter(2, 60_000)

    expect(limiter.isAllowed('user-1')).toBe(true)
    expect(limiter.isAllowed('user-1')).toBe(true)
    expect(limiter.isAllowed('user-1')).toBe(false)
  })

  it('tracks limits independently per key', () => {
    const limiter = new RateLimiter(1, 60_000)

    expect(limiter.isAllowed('user-1')).toBe(true)
    expect(limiter.isAllowed('user-2')).toBe(true)
    expect(limiter.isAllowed('user-1')).toBe(false)
    expect(limiter.isAllowed('user-2')).toBe(false)
  })

  it('resets after the time window elapses', () => {
    const limiter = new RateLimiter(1, 100)

    expect(limiter.isAllowed('user-1')).toBe(true)
    expect(limiter.isAllowed('user-1')).toBe(false)

    // Advance time past the window
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 150)

    expect(limiter.isAllowed('user-1')).toBe(true)
  })
})
