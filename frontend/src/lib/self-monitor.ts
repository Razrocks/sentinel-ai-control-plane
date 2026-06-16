/**
 * Phase 5.5/5.6 — frontend self-monitoring stub.
 *
 * Mirror of the backend stub. If `VITE_SENTRY_DSN` is set in the Vite env,
 * we lazy-load `@sentry/react` and forward captured exceptions; otherwise
 * everything no-ops. ErrorBoundary's `componentDidCatch` calls into
 * `captureException` so unhandled render errors get reported in prod.
 *
 * To opt in:
 *   1. `cd frontend && npm install @sentry/react`
 *   2. Add `VITE_SENTRY_DSN=https://...@sentry.io/...` to `frontend/.env`
 *   3. Rebuild — `init()` runs lazily on first capture.
 */

let initialized = false
/* eslint-disable @typescript-eslint/no-explicit-any */
let sentry: any = null

async function ensureInit(): Promise<void> {
  if (initialized) return
  initialized = true
  const dsn = (import.meta as any).env?.VITE_SENTRY_DSN as string | undefined
  if (!dsn) return
  try {
    const mod = await import('@sentry/react' as any)
    mod.init({
      dsn,
      environment: (import.meta as any).env?.MODE ?? 'production',
      tracesSampleRate: 0,
    })
    sentry = mod
    // eslint-disable-next-line no-console
    console.info('[self-monitor] Sentry initialized.')
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      '[self-monitor] VITE_SENTRY_DSN set but @sentry/react not installed. ' +
        'Run `npm install @sentry/react` in frontend/ to enable.',
      err instanceof Error ? err.message : err,
    )
  }
}

export function captureException(err: unknown, context?: Record<string, unknown>): void {
  void ensureInit().then(() => {
    if (!sentry) return
    try {
      sentry.captureException(err, context ? { extra: context } : undefined)
    } catch {
      /* swallow — never let monitoring break the app */
    }
  })
}
