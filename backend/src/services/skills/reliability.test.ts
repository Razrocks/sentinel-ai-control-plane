import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  isTransientError,
  withRetry,
  breakerOpen,
  recordBreakerSuccess,
  recordBreakerFailure,
  CircuitOpenError,
  withTimeout,
  TimeoutError,
  consumeRateToken,
  RateLimitError,
} from './reliability.js'

// Reliability is the last line of defence between the skill runner and
// a bad afternoon at Anthropic. If retry/breaker/rate math drifts, we
// either DDoS a degraded API or fail requests we could have served —
// both bad. These tests pin the invariants.

describe('isTransientError', () => {
  it.each([
    [{ status: 429 }, true, '429 rate-limit is transient'],
    [{ status: 500 }, true, '5xx is transient'],
    [{ status: 503 }, true, '5xx is transient'],
    [{ status: 400 }, false, "4xx (non-429) is caller's fault"],
    [{ status: 404 }, false, '404 is not transient'],
    [{ message: 'ECONNRESET while writing' }, true, 'net drop is transient'],
    [{ message: 'ETIMEDOUT' }, true, 'timeout is transient'],
    [{ message: 'ECONNREFUSED at :3001' }, true, 'refused is transient'],
    [{ message: 'schema mismatch' }, false, 'schema errors are not transient'],
    [null, false, 'null is safe'],
    [undefined, false, 'undefined is safe'],
    ['string error', false, 'non-object errors are not transient'],
  ])('%o → %s (%s)', (input, expected) => {
    expect(isTransientError(input)).toBe(expected)
  })
})

describe('withRetry', () => {
  it('succeeds on first attempt without waiting', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    await expect(withRetry(fn)).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries transient errors up to maxAttempts', async () => {
    const err = { status: 429 }
    const fn = vi
      .fn()
      .mockRejectedValueOnce(err)
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce('ok')
    // Small delays keep the test fast without needing fake timers.
    await expect(
      withRetry(fn, { baseDelayMs: 1, maxDelayMs: 4, maxAttempts: 3 }),
    ).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('bails immediately on non-transient errors', async () => {
    const err = { status: 400, message: 'bad request' }
    const fn = vi.fn().mockRejectedValue(err)
    await expect(withRetry(fn, { baseDelayMs: 1 })).rejects.toBe(err)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('throws the last error if all attempts fail', async () => {
    const err = { status: 500 }
    const fn = vi.fn().mockRejectedValue(err)
    await expect(
      withRetry(fn, { baseDelayMs: 1, maxDelayMs: 2, maxAttempts: 2 }),
    ).rejects.toBe(err)
    expect(fn).toHaveBeenCalledTimes(2)
  })
})

describe('circuit breaker', () => {
  // Each test uses a unique key so state doesn't leak between tests
  // (the module-level Map is process-scoped by design).
  let key: string
  beforeEach(() => {
    key = `test-${Math.random().toString(36).slice(2)}`
  })

  it('starts closed for a fresh key', () => {
    expect(breakerOpen(key)).toBe(false)
  })

  it('opens after 5 consecutive failures', () => {
    for (let i = 0; i < 5; i++) recordBreakerFailure(key)
    expect(breakerOpen(key)).toBe(true)
  })

  it('does NOT open at 4 failures', () => {
    for (let i = 0; i < 4; i++) recordBreakerFailure(key)
    expect(breakerOpen(key)).toBe(false)
  })

  it('recordBreakerSuccess resets the counter', () => {
    for (let i = 0; i < 4; i++) recordBreakerFailure(key)
    recordBreakerSuccess(key)
    // One more failure now is only 1, not 5.
    recordBreakerFailure(key)
    expect(breakerOpen(key)).toBe(false)
  })

  it('half-opens after BREAKER_OPEN_MS elapses', () => {
    vi.useFakeTimers()
    try {
      for (let i = 0; i < 5; i++) recordBreakerFailure(key)
      expect(breakerOpen(key)).toBe(true)
      // Jump past the 30s window.
      vi.setSystemTime(Date.now() + 31_000)
      expect(breakerOpen(key)).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('CircuitOpenError carries the key', () => {
    const err = new CircuitOpenError('some-key')
    expect(err.key).toBe('some-key')
    expect(err.message).toContain('some-key')
    expect(err.name).toBe('CircuitOpenError')
  })
})

describe('withTimeout', () => {
  it('resolves when the underlying promise wins the race', async () => {
    await expect(withTimeout(async () => 'fast', 50)).resolves.toBe('fast')
  })

  it('rejects with TimeoutError when the timer wins', async () => {
    await expect(
      withTimeout(
        () => new Promise((r) => setTimeout(() => r('never'), 100)),
        10,
      ),
    ).rejects.toBeInstanceOf(TimeoutError)
  })

  it('TimeoutError carries the ms value', () => {
    const err = new TimeoutError(1234)
    expect(err.ms).toBe(1234)
    expect(err.message).toContain('1234')
  })
})

describe('token-bucket rate limit', () => {
  it('allows bursts up to capacity for a fresh actor', () => {
    const actor = `burst-${Math.random()}`
    // Capacity is 30; consecutive consumes should all succeed.
    for (let i = 0; i < 30; i++) consumeRateToken(actor)
    // 31st should throw.
    expect(() => consumeRateToken(actor)).toThrow(RateLimitError)
  })

  it('refills over time', () => {
    vi.useFakeTimers()
    try {
      const actor = `refill-${Math.random()}`
      // Drain the bucket.
      for (let i = 0; i < 30; i++) consumeRateToken(actor)
      expect(() => consumeRateToken(actor)).toThrow(RateLimitError)
      // Refill rate is 0.5/sec — 4s = 2 tokens.
      vi.setSystemTime(Date.now() + 4_000)
      // Should now grant one call.
      expect(() => consumeRateToken(actor)).not.toThrow()
      // And another.
      expect(() => consumeRateToken(actor)).not.toThrow()
      // Third exceeds the refilled tokens.
      expect(() => consumeRateToken(actor)).toThrow(RateLimitError)
    } finally {
      vi.useRealTimers()
    }
  })

  it('caps refill at BUCKET_CAPACITY (no overflow bonus)', () => {
    vi.useFakeTimers()
    try {
      const actor = `cap-${Math.random()}`
      consumeRateToken(actor) // drop to 29
      // Advance an hour — refill would compute 1800 tokens, but capped at 30.
      vi.setSystemTime(Date.now() + 3_600_000)
      // Should allow exactly 30 more, not 30 * 60.
      for (let i = 0; i < 30; i++) consumeRateToken(actor)
      expect(() => consumeRateToken(actor)).toThrow(RateLimitError)
    } finally {
      vi.useRealTimers()
    }
  })

  it('RateLimitError carries the actor', () => {
    const err = new RateLimitError('alice')
    expect(err.actor).toBe('alice')
    expect(err.message).toContain('alice')
  })
})
