/**
 * First-run setup wizard.
 *
 * Routes flow: SetupGuard redirects here when /setup/status returns
 * `onboardingComplete: false`. The page polls status every 5s so the user
 * can edit backend/.env, restart the backend, and see green/red flip
 * without page refreshes.
 *
 * Steps (linear):
 *   1. Environment check — required env vars present
 *   2. First admin — at least one admin user exists
 *   3. Confirm + finish — flips onboardingComplete=true
 *
 * Steps 1 + 2 self-detect. Step 3 is the explicit "go" button.
 */
import { useState } from 'react'
import { Check, X, RefreshCw, AlertTriangle, ArrowRight, ShieldCheck } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useSetupStatus, useRecheckEnv, useCompleteSetup } from '@/hooks/useSetup'
import type { EnvCheck } from '@/lib/api'

export default function Setup() {
  const { data, isLoading } = useSetupStatus()
  const recheck = useRecheckEnv()
  const complete = useCompleteSetup()
  const navigate = useNavigate()
  const [completeError, setCompleteError] = useState<string | null>(null)

  if (isLoading || !data) {
    return (
      <div className="min-h-screen bg-bg-primary flex items-center justify-center">
        <div className="text-text-secondary">Loading setup status...</div>
      </div>
    )
  }

  // If onboarding already complete (e.g. user typed /setup manually), bounce home.
  if (data.onboardingComplete) {
    navigate('/', { replace: true })
    return null
  }

  const handleComplete = async () => {
    setCompleteError(null)
    const result = await complete.mutateAsync()
    if (result.ok) {
      navigate('/', { replace: true })
    } else {
      setCompleteError(result.message ?? 'Setup completion failed.')
    }
  }

  const envOk = data.allEnvOk
  const adminOk = data.hasFirstAdmin
  const canComplete = envOk && adminOk

  return (
    <div className="min-h-screen bg-bg-primary flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-2xl">
        <div className="flex items-center gap-3 mb-8">
          <ShieldCheck className="w-8 h-8 text-accent" />
          <div>
            <h1 className="text-2xl font-semibold text-text-primary">Sentinel — First-Run Setup</h1>
            <p className="text-text-secondary text-sm">
              Quick checks before the main app comes online.
            </p>
          </div>
        </div>

        {/* Step 1: Environment check */}
        <StepCard
          number={1}
          title="Environment Check"
          status={envOk ? 'done' : 'open'}
          description="Required environment variables must be set in backend/.env."
        >
          <div className="space-y-2">
            {data.envChecks.map((c) => (
              <EnvRow key={c.key} check={c} />
            ))}
          </div>
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => recheck.mutate()}
              className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm bg-surface-raised text-text-secondary hover:text-text-primary border border-border-subtle"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${recheck.isPending ? 'animate-spin' : ''}`} />
              Recheck environment
            </button>
          </div>
        </StepCard>

        {/* Step 2: First admin */}
        <StepCard
          number={2}
          title="First Admin User"
          status={adminOk ? 'done' : 'open'}
          description="At least one user with role=admin is required to manage the system."
        >
          {adminOk ? (
            <div className="flex items-center gap-2 text-sm text-status-approved">
              <Check className="w-4 h-4" />
              {data.adminCount} admin user{data.adminCount > 1 ? 's' : ''} exist
            </div>
          ) : (
            <div className="text-sm text-text-secondary">
              No admin user yet. Either run the seed:
              <pre className="bg-surface-raised border border-border-subtle rounded p-2 mt-2 text-xs">
                docker compose exec backend npx tsx prisma/seed.ts
              </pre>
              or create one via the auth API. The seed creates{' '}
              <code className="text-accent">admin@sentinel.dev</code> with password{' '}
              <code className="text-accent">password</code>.
            </div>
          )}
        </StepCard>

        {/* Step 3: Complete */}
        <StepCard
          number={3}
          title="Finish Setup"
          status={canComplete ? 'open' : 'blocked'}
          description="Flip onboardingComplete=true and unlock the main app."
        >
          {!canComplete && (
            <div className="flex items-start gap-2 text-sm text-text-muted mb-3">
              <AlertTriangle className="w-4 h-4 text-status-pending flex-shrink-0 mt-0.5" />
              <span>Complete steps 1 + 2 first.</span>
            </div>
          )}
          {completeError && (
            <div className="text-sm text-status-denied mb-3 p-2 rounded bg-status-denied/10 border border-status-denied/30">
              {completeError}
            </div>
          )}
          <div className="flex justify-end">
            <button
              type="button"
              disabled={!canComplete || complete.isPending}
              onClick={handleComplete}
              className="flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium bg-accent text-white hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Complete setup
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </StepCard>

        <p className="text-xs text-text-muted text-center mt-6">
          Status auto-refreshes every 5 seconds. Edit backend/.env and restart the backend container
          to update env checks.
        </p>
      </div>
    </div>
  )
}

// ─── Step card helper ────────────────────────────────────

type StepStatus = 'done' | 'open' | 'blocked'

function StepCard({
  number,
  title,
  status,
  description,
  children,
}: {
  number: number
  title: string
  status: StepStatus
  description: string
  children: React.ReactNode
}) {
  const dot =
    status === 'done'
      ? 'bg-status-approved'
      : status === 'open'
        ? 'bg-accent'
        : 'bg-text-muted'

  return (
    <div className="rounded-lg border border-border bg-surface p-5 mb-4">
      <div className="flex items-start gap-3 mb-3">
        <span
          className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium text-white flex-shrink-0 ${dot}`}
        >
          {status === 'done' ? <Check className="w-3.5 h-3.5" /> : number}
        </span>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
          <p className="text-xs text-text-muted mt-0.5">{description}</p>
        </div>
      </div>
      <div className="pl-9">{children}</div>
    </div>
  )
}

function EnvRow({ check }: { check: EnvCheck }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      {check.present ? (
        <Check className="w-4 h-4 text-status-approved flex-shrink-0 mt-0.5" />
      ) : (
        <X className="w-4 h-4 text-status-denied flex-shrink-0 mt-0.5" />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <code className="text-xs text-text-primary">{check.key}</code>
          <span className="text-xs text-text-muted">— {check.label}</span>
        </div>
        {!check.present && check.fixHint && (
          <pre className="bg-surface-raised border border-border-subtle rounded p-2 mt-1 text-xs whitespace-pre-wrap">
            {check.fixHint}
          </pre>
        )}
      </div>
    </div>
  )
}
