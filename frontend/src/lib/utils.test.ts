import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cn, formatDate, timeAgo } from './utils'

// Small helpers that get called from every page. They're pure but
// they're everywhere — a subtle regression in `timeAgo` boundaries
// changes what half the UI displays.

describe('cn', () => {
  it('joins class strings', () => {
    expect(cn('a', 'b')).toBe('a b')
  })

  it('resolves conditional inputs via clsx', () => {
    expect(cn('a', false && 'b', 'c', undefined, null)).toBe('a c')
  })

  it('merges conflicting Tailwind classes (last wins)', () => {
    // `twMerge` collapses conflicting utilities — critical for the
    // component-override pattern used across shadcn wrappers.
    expect(cn('px-2', 'px-4')).toBe('px-4')
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500')
  })

  it('handles arrays + objects (clsx passthrough)', () => {
    expect(cn(['a', 'b'])).toBe('a b')
    expect(cn({ active: true, disabled: false })).toBe('active')
  })
})

describe('formatDate', () => {
  it('accepts a string date and returns a locale-formatted string', () => {
    const out = formatDate('2026-01-15T12:34:00Z')
    // Format includes month + day + year — we don't pin the exact
    // string because it's timezone/locale-sensitive; check the pieces.
    expect(out).toMatch(/2026/)
    expect(out).toMatch(/Jan/)
    expect(out).toMatch(/15/)
  })

  it('accepts a Date object', () => {
    // Mid-day UTC so local-tz rounding never crosses a day/month boundary
    // regardless of where the test runs.
    const out = formatDate(new Date('2026-06-15T12:00:00Z'))
    expect(out).toMatch(/Jun/)
    expect(out).toMatch(/2026/)
  })
})

describe('timeAgo', () => {
  // Freeze time so boundaries are deterministic.
  const NOW = new Date('2026-01-15T12:00:00Z')

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('less than 60s ago → "just now"', () => {
    expect(timeAgo(new Date(NOW.getTime() - 30_000))).toBe('just now')
  })

  it('exactly 60s ago → "1m ago"', () => {
    expect(timeAgo(new Date(NOW.getTime() - 60_000))).toBe('1m ago')
  })

  it('minute-boundary: 2 minutes → "2m ago"', () => {
    expect(timeAgo(new Date(NOW.getTime() - 2 * 60_000))).toBe('2m ago')
  })

  it('hour-boundary: 3 hours → "3h ago"', () => {
    expect(timeAgo(new Date(NOW.getTime() - 3 * 60 * 60_000))).toBe('3h ago')
  })

  it('day-boundary: 2 days → "2d ago"', () => {
    expect(timeAgo(new Date(NOW.getTime() - 2 * 24 * 60 * 60_000))).toBe('2d ago')
  })

  it('accepts a string ISO date', () => {
    const iso = new Date(NOW.getTime() - 5 * 60_000).toISOString()
    expect(timeAgo(iso)).toBe('5m ago')
  })

  it('picks the largest unit at each boundary (never overshoots)', () => {
    // 90s ago = 1m, not 90m.
    expect(timeAgo(new Date(NOW.getTime() - 90_000))).toBe('1m ago')
    // 90m ago = 1h, not 90h.
    expect(timeAgo(new Date(NOW.getTime() - 90 * 60_000))).toBe('1h ago')
    // 36h ago = 1d.
    expect(timeAgo(new Date(NOW.getTime() - 36 * 60 * 60_000))).toBe('1d ago')
  })
})
