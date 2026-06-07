/**
 * First-run setup wizard (Phase 4 rebuild).
 *
 * Cleaner card-based steps using shadcn primitives. Each step is a Card
 * with status pill on the right, body content below. The Complete button
 * is a full-size primary CTA.
 */
import { useState } from 'react'
import { Check, X, RefreshCw, AlertTriangle, ArrowRight, ShieldCheck } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useSetupStatus, useRecheckEnv, useCompleteSetup } from '@/hooks/useSetup'
import type { EnvCheck } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export default function Setup() {
  const { data, isLoading } = useSetupStatus()
  const recheck = useRecheckEnv()
  const complete = useCompleteSetup()
  const navigate = useNavigate()
  const [completeError, setCompleteError] = useState<string | null>(null)

  if (isLoading || !data) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Skeleton className="h-96 w-full max-w-2xl" />
      </div>
    )
  }

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
    <div className="min-h-screen bg-background flex items-start justify-center px-4 py-12">
      <div className="w-full max-w-3xl space-y-8">
        {/* Header */}
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-3xl font-semibold text-foreground tracking-tight">
              Sentinel · First-Run Setup
            </h1>
            <p className="text-base text-muted-foreground mt-1">
              Quick checks before the main app comes online.
            </p>
          </div>
        </div>

        {/* Step 1 — env */}
        <StepCard number={1} title="Environment Check" status={envOk ? 'done' : 'open'}>
          <p className="text-sm text-muted-foreground">
            Required environment variables must be set in <code>backend/.env</code>.
          </p>
          <div className="space-y-2.5">
            {data.envChecks.map((c) => (
              <EnvRow key={c.key} check={c} />
            ))}
          </div>
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => recheck.mutate()}
              disabled={recheck.isPending}
            >
              <RefreshCw className={cn('h-3.5 w-3.5', recheck.isPending && 'animate-spin')} />
              Recheck environment
            </Button>
          </div>
        </StepCard>

        {/* Step 2 — admin */}
        <StepCard number={2} title="First Admin User" status={adminOk ? 'done' : 'open'}>
          {adminOk ? (
            <div className="flex items-center gap-2 text-sm text-status-approved">
              <Check className="h-4 w-4" />
              <span>
                {data.adminCount} admin user{data.adminCount > 1 ? 's' : ''} exist
              </span>
            </div>
          ) : (
            <div className="space-y-3 text-sm text-foreground/85">
              <p>
                No admin user yet. Either run the seed or create one via the auth API:
              </p>
              <pre className="bg-secondary border border-border rounded-md p-3 text-xs overflow-x-auto">
                docker compose exec backend npx tsx prisma/seed.ts
              </pre>
              <p className="text-muted-foreground">
                The seed creates <code className="text-foreground">admin@sentinel.dev</code> with password{' '}
                <code className="text-foreground">password</code>.
              </p>
            </div>
          )}
        </StepCard>

        {/* Step 3 — complete */}
        <StepCard
          number={3}
          title="Finish Setup"
          status={canComplete ? 'open' : 'blocked'}
        >
          <p className="text-sm text-muted-foreground">
            Flip <code>onboardingComplete=true</code> and unlock the main app.
          </p>

          {!canComplete && (
            <Alert variant="warning">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>Complete steps 1 and 2 first.</AlertDescription>
            </Alert>
          )}

          {completeError && (
            <Alert variant="destructive">
              <X className="h-4 w-4" />
              <AlertDescription>{completeError}</AlertDescription>
            </Alert>
          )}

          <div className="flex justify-end">
            <Button
              size="lg"
              disabled={!canComplete || complete.isPending}
              onClick={handleComplete}
            >
              Complete setup
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </StepCard>

        <p className="text-xs text-muted-foreground text-center">
          Status auto-refreshes every 5 seconds. Edit <code>backend/.env</code> and restart the
          backend container to update env checks.
        </p>
      </div>
    </div>
  )
}

type StepStatus = 'done' | 'open' | 'blocked'

function StepCard({
  number,
  title,
  status,
  children,
}: {
  number: number
  title: string
  status: StepStatus
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-start gap-4">
          <span
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold flex-shrink-0',
              status === 'done'
                ? 'bg-status-approved text-white'
                : status === 'open'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-muted-foreground',
            )}
          >
            {status === 'done' ? <Check className="h-4 w-4" /> : number}
          </span>
          <div className="flex-1 min-w-0 space-y-4">
            <h2 className="text-lg font-semibold text-foreground">{title}</h2>
            {children}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function EnvRow({ check }: { check: EnvCheck }) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-md border p-3',
        check.present
          ? 'border-status-approved/30 bg-status-approved/8'
          : 'border-destructive/30 bg-destructive/8',
      )}
    >
      <div
        className={cn(
          'flex h-6 w-6 items-center justify-center rounded-md flex-shrink-0 mt-0.5',
          check.present
            ? 'bg-status-approved/15 text-status-approved'
            : 'bg-destructive/15 text-destructive',
        )}
      >
        {check.present ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <code className="text-sm font-mono text-foreground">{check.key}</code>
          <span className="text-xs text-muted-foreground">— {check.label}</span>
        </div>
        {!check.present && check.fixHint && (
          <pre className="mt-2 bg-secondary border border-border rounded p-2 text-xs whitespace-pre-wrap text-foreground/85">
            {check.fixHint}
          </pre>
        )}
      </div>
    </div>
  )
}
