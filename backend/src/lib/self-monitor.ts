/**
 * Phase 5.5 — Sentinel self-monitoring stub.
 *
 * Lazy Sentry adapter. If `SENTRY_DSN` is set in the environment, we
 * dynamically import `@sentry/node` and route captured exceptions to it;
 * otherwise we no-op (preserves zero-dep behavior for self-hosters who
 * don't run Sentry).
 *
 * Why lazy: keeps `@sentry/node` out of the install + bundle for everyone
 * who doesn't want it. To opt in:
 *
 *   1. `cd backend && npm install @sentry/node`
 *   2. Add `SENTRY_DSN=https://...@sentry.io/...` to `backend/.env`
 *   3. Restart the backend container — `init()` picks up the new env on
 *      the next process start.
 *
 * Wire points:
 *   - error handler in `server.ts` should call `captureException(err)`
 *     before responding 5xx
 *   - agent skill runner should call `captureException` on
 *     `validation_failed` + critical paths
 *
 * NB: this file deliberately catches every error from the import attempt
 * so a broken Sentry install can never take down the app.
 */

let initialized = false
/* eslint-disable @typescript-eslint/no-explicit-any */
let sentry: any = null

async function ensureInit(): Promise<void> {
  if (initialized) return
  initialized = true
  const dsn = process.env.SENTRY_DSN
  if (!dsn) return
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = await import('@sentry/node' as any)
    mod.init({
      dsn,
      environment: process.env.NODE_ENV ?? 'production',
      tracesSampleRate: 0,
      release: process.env.SENTINEL_RELEASE,
    })
    sentry = mod
    console.info('[self-monitor] Sentry initialized.')
  } catch (err) {
    console.warn(
      '[self-monitor] SENTRY_DSN set but @sentry/node not installed. ' +
        'Run `npm install @sentry/node` in backend/ to enable.',
      err instanceof Error ? err.message : err,
    )
  }
}

/**
 * Send an exception to the monitoring backend. Safe to call without
 * awaiting — failures stay silent so observability never breaks core
 * code paths.
 */
export function captureException(err: unknown, context?: Record<string, unknown>): void {
  void ensureInit().then(() => {
    if (!sentry) return
    try {
      sentry.captureException(err, context ? { extra: context } : undefined)
    } catch {
      /* swallow — never let monitoring fail the request */
    }
  })
}

/**
 * Cheap presence test: surfaces whether self-monitoring is wired so the
 * /api/agents/health endpoint can report it.
 */
export function isSelfMonitoringConfigured(): boolean {
  return Boolean(process.env.SENTRY_DSN)
}
