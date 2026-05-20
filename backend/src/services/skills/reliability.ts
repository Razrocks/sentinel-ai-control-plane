/**
 * Reliability wrappers for Anthropic SDK calls.
 *
 * Covers:
 *   - C1 retry with exponential backoff (transient 5xx, 429, network)
 *   - C2 circuit breaker per (model, skill) tuple (stops cascading failures)
 *   - C3 graceful degradation (fallback callable when both primary + retry fail)
 *   - C4 hard timeout per call (default 30s, configurable per skill)
 *   - C5 rate limiting per user (token-bucket)
 *   - C6 daily cost cap per user
 *   - C7 model fallback (sonnet → haiku if sonnet rate-limited or down)
 *
 * Design notes:
 * - In-process state. Survives container restart? No — by design. State is
 *   per-pod; cluster-wide rate limits = future Redis work.
 * - Cost cap is enforced after each call by summing agent_invocations for the
 *   user this calendar day; this means the LIMIT call may exceed cap slightly
 *   (race). For tighter control, switch to a per-call pre-check. Acceptable
 *   for v1.
 */

import { prisma } from '../../lib/prisma.js'

// ─── C1 retry/backoff ───────────────────────────────────

export interface RetryOptions {
  maxAttempts: number
  baseDelayMs: number
  maxDelayMs: number
  shouldRetry?: (err: unknown, attempt: number) => boolean
}

export const DEFAULT_RETRY: RetryOptions = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 5000,
}

/**
 * Decide whether an error is worth retrying. Retries on:
 *   - HTTP 429 (rate limit)
 *   - HTTP 5xx (server error)
 *   - Network errors / aborts that look transient
 * Does NOT retry on 4xx other than 429 (caller's fault, retry won't help).
 */
export function isTransientError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { status?: number; code?: string; message?: string }
  if (typeof e.status === 'number') {
    if (e.status === 429) return true
    if (e.status >= 500 && e.status < 600) return true
    return false
  }
  // Network-ish errors
  const msg = (e.message ?? '').toLowerCase()
  if (msg.includes('econnreset') || msg.includes('etimedout') || msg.includes('econnrefused')) {
    return true
  }
  return false
}

/**
 * Run an async function with exponential backoff retry.
 * Backoff = baseDelayMs * 2^(attempt-1) + jitter, capped at maxDelayMs.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {},
): Promise<T> {
  const opts = { ...DEFAULT_RETRY, ...options }
  const shouldRetry = opts.shouldRetry ?? ((err, attempt) => isTransientError(err) && attempt < opts.maxAttempts)
  let lastErr: unknown
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (!shouldRetry(err, attempt)) throw err
      const expDelay = Math.min(opts.baseDelayMs * 2 ** (attempt - 1), opts.maxDelayMs)
      const jitter = Math.random() * (expDelay * 0.25)
      const delay = expDelay + jitter
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  throw lastErr
}

// ─── C2 circuit breaker ─────────────────────────────────

interface BreakerState {
  failures: number
  openUntil: number // epoch ms; 0 if closed
}

const breakers = new Map<string, BreakerState>()
const BREAKER_FAILURE_THRESHOLD = 5
const BREAKER_OPEN_MS = 30_000 // 30s; after that, half-open

/**
 * Returns true if the circuit is open for this key (calls should fail fast).
 */
export function breakerOpen(key: string): boolean {
  const s = breakers.get(key)
  if (!s) return false
  if (s.openUntil > Date.now()) return true
  if (s.openUntil > 0) {
    // Half-open: reset failures so next call gets one chance.
    s.openUntil = 0
    s.failures = 0
  }
  return false
}

export function recordBreakerSuccess(key: string): void {
  breakers.set(key, { failures: 0, openUntil: 0 })
}

export function recordBreakerFailure(key: string): void {
  const s = breakers.get(key) ?? { failures: 0, openUntil: 0 }
  s.failures++
  if (s.failures >= BREAKER_FAILURE_THRESHOLD) {
    s.openUntil = Date.now() + BREAKER_OPEN_MS
    s.failures = 0 // reset count after opening
  }
  breakers.set(key, s)
}

export class CircuitOpenError extends Error {
  constructor(public readonly key: string) {
    super(`Circuit breaker open for ${key}`)
    this.name = 'CircuitOpenError'
  }
}

// ─── C4 timeout ─────────────────────────────────────────

export class TimeoutError extends Error {
  constructor(public readonly ms: number) {
    super(`Operation timed out after ${ms}ms`)
    this.name = 'TimeoutError'
  }
}

export async function withTimeout<T>(fn: () => Promise<T>, ms: number): Promise<T> {
  return await Promise.race([
    fn(),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new TimeoutError(ms)), ms),
    ),
  ])
}

// ─── C5 rate limit (token bucket per user) ──────────────

interface Bucket {
  tokens: number
  lastRefillMs: number
}

const buckets = new Map<string, Bucket>()
const BUCKET_CAPACITY = 30 // max calls in burst
const BUCKET_REFILL_PER_SEC = 0.5 // ~30 calls/min steady state

export class RateLimitError extends Error {
  constructor(public readonly actor: string) {
    super(`Rate limit exceeded for actor ${actor}`)
    this.name = 'RateLimitError'
  }
}

/**
 * Consume 1 token. Throws RateLimitError if none available.
 * Refills at BUCKET_REFILL_PER_SEC tokens/sec, capped at BUCKET_CAPACITY.
 */
export function consumeRateToken(actor: string): void {
  const now = Date.now()
  const b = buckets.get(actor) ?? { tokens: BUCKET_CAPACITY, lastRefillMs: now }
  const elapsedSec = (now - b.lastRefillMs) / 1000
  b.tokens = Math.min(BUCKET_CAPACITY, b.tokens + elapsedSec * BUCKET_REFILL_PER_SEC)
  b.lastRefillMs = now
  if (b.tokens < 1) {
    buckets.set(actor, b)
    throw new RateLimitError(actor)
  }
  b.tokens -= 1
  buckets.set(actor, b)
}

// ─── C6 daily cost cap per user ─────────────────────────

const DAILY_COST_CAP_USD = 5.0 // generous default; per-user

// Sonnet 4 + Haiku 4.5 pricing (USD per million tokens).
const PRICING: Record<string, { in: number; out: number }> = {
  'claude-sonnet-4-20250514': { in: 3, out: 15 },
  'claude-haiku-4-5-20251001': { in: 1, out: 5 },
}

function modelCostUsd(model: string, tokensIn: number, tokensOut: number): number {
  const p = PRICING[model] ?? PRICING['claude-sonnet-4-20250514']
  return (tokensIn * p.in + tokensOut * p.out) / 1_000_000
}

export class CostCapError extends Error {
  constructor(public readonly actor: string, public readonly spentUsd: number) {
    super(`Daily cost cap exceeded for ${actor} ($${spentUsd.toFixed(2)} / $${DAILY_COST_CAP_USD})`)
    this.name = 'CostCapError'
  }
}

/**
 * Check the user's spending today against the daily cap.
 * Throws CostCapError if over cap. Called before each skill call.
 */
export async function checkCostCap(actor: string): Promise<void> {
  // System actor (autonomous agents) is uncapped — they're not user-initiated.
  if (actor === 'system') return

  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)

  const todayInvocations = await prisma.agentInvocation.findMany({
    where: { actor, createdAt: { gte: startOfDay } },
    select: { model: true, tokensIn: true, tokensOut: true },
  })

  let spent = 0
  for (const inv of todayInvocations) {
    spent += modelCostUsd(inv.model, inv.tokensIn, inv.tokensOut)
  }

  if (spent >= DAILY_COST_CAP_USD) {
    throw new CostCapError(actor, spent)
  }
}

// ─── C7 model fallback ──────────────────────────────────

/**
 * Get the fallback model for a given primary. Returns null if no fallback.
 * Used when the primary model 429s or 5xxs persistently.
 */
export function getFallbackModel(primary: string): string | null {
  if (primary === 'claude-sonnet-4-20250514') return 'claude-haiku-4-5-20251001'
  // Haiku has no further fallback.
  return null
}
