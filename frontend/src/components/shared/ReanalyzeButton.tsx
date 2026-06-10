/**
 * Re-analyze button — triggers a Phase 9 agent (ChangeTriage / IncidentTriage /
 * AccessReviewer) on the current entity. Shows loading state, success summary,
 * or error toast.
 *
 * RBAC: server-side enforced via /api/agents/* route guards. We additionally
 * hide the button from roles that would always 403, so users don't see a
 * useless control.
 *
 * Cost note: each click hits the Anthropic API (~$0.02-0.07). The backend
 * caches T1 fragments for 5 min, so rapid re-clicks are cheaper.
 */
import { useState } from 'react'
import { Sparkles, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export type AgentKind = 'change' | 'incident' | 'access_request'

interface ReanalyzeButtonProps {
  kind: AgentKind
  entityIdOrTicket: string
  /** From the auth context; gates visibility. */
  userRole?: string
  /** Mutation hook result. Caller wires the right hook for the entity kind. */
  mutate: (id: string) => void
  isPending: boolean
  isError: boolean
  isSuccess: boolean
  error: unknown
  data: unknown
  className?: string
}

/** Roles allowed to invoke each agent (matches backend route guards). */
const ROLE_GATES: Record<AgentKind, string[]> = {
  change: ['admin', 'operator', 'engineer'],
  incident: ['admin', 'operator', 'it_support', 'engineer'],
  access_request: ['admin', 'access_approver', 'operator'],
}

const LABELS: Record<AgentKind, string> = {
  change: 'Re-analyze change',
  incident: 'Re-triage incident',
  access_request: 'Re-evaluate request',
}

function summarize(kind: AgentKind, data: unknown): string {
  if (!data || typeof data !== 'object') return 'Analysis complete.'
  const d = data as Record<string, unknown>

  if (kind === 'change') {
    const risk = d.appliedRiskLevel as string | undefined
    const items = d.blastRadiusItemsWritten as number | undefined
    return `Risk: ${risk ?? 'unchanged'} · ${items ?? 0} blast-radius items written`
  }
  if (kind === 'incident') {
    const sev = d.appliedSeverity as string | undefined
    const fields = (d.fieldsUpdated as string[]) ?? []
    return `Severity: ${sev ?? 'unchanged'} · ${fields.length} field(s) updated`
  }
  if (kind === 'access_request') {
    const risk = d.appliedRiskLevel as string | undefined
    const fields = (d.fieldsUpdated as string[]) ?? []
    return `Risk: ${risk ?? 'unchanged'} · ${fields.length} field(s) updated`
  }
  return 'Analysis complete.'
}

export function ReanalyzeButton({
  kind,
  entityIdOrTicket,
  userRole,
  mutate,
  isPending,
  isError,
  isSuccess,
  error,
  data,
  className,
}: ReanalyzeButtonProps) {
  const [dismissed, setDismissed] = useState(false)

  // Hide entirely if role can't invoke
  if (userRole && !ROLE_GATES[kind].includes(userRole)) return null

  const handleClick = () => {
    setDismissed(false)
    mutate(entityIdOrTicket)
  }

  const showSuccess = isSuccess && !dismissed
  const showError = isError && !dismissed
  const showStatus = showSuccess || showError

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className={cn(
          'flex w-full h-12 items-center justify-center gap-2.5 rounded-lg px-5 text-sm font-semibold transition-colors',
          'border border-purple-500/40 bg-purple-500/10 text-purple-300',
          'hover:bg-purple-500/20 hover:border-purple-500/60',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          'shadow-sm',
        )}
      >
        {isPending ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" />
            Analyzing… (5-15s)
          </>
        ) : (
          <>
            <Sparkles className="h-5 w-5" />
            {LABELS[kind]}
          </>
        )}
      </button>

      {showStatus && (
        <div
          className={cn(
            'flex items-start gap-2 rounded-md border px-3 py-2 text-xs',
            showSuccess ? 'border-green-500/30 bg-green-500/5 text-green-200' : 'border-red-500/30 bg-red-500/5 text-red-200',
          )}
          role={showError ? 'alert' : 'status'}
        >
          {showSuccess ? (
            <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          )}
          <div className="flex-1">
            <div className="font-medium">
              {showSuccess ? 'Re-analysis complete' : 'Re-analysis failed'}
            </div>
            <div className="opacity-80 mt-0.5">
              {showSuccess
                ? summarize(kind, data)
                : error instanceof Error
                ? error.message
                : 'Unknown error'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="text-xs opacity-50 hover:opacity-100"
            aria-label="dismiss"
          >
            ×
          </button>
        </div>
      )}
    </div>
  )
}
