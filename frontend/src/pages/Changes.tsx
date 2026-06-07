/**
 * Changes — list of engineering change requests.
 *
 * Phase 4 rebuild: status-tinted cells matching the Approvals page
 * system. Risk and policy are shown as prominent Badges with ring
 * borders so blocked/escalated rows stand out at a glance.
 */
import { Link } from 'react-router-dom'
import { ArrowRight, GitPullRequest, Ban, ArrowUpRight, Clock, CheckCircle2, Rocket } from 'lucide-react'
import { createColumnHelper } from '@tanstack/react-table'
import { useChanges } from '@/hooks/useData'
import { OwnerChip } from '@/components/shared'
import { DataTable } from '@/components/shared/DataTable'
import { timeAgo } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { Change } from '@/types'

function riskToBadge(level: string) {
  if (level === 'critical') return { variant: 'risk_critical' as const, label: 'CRITICAL' }
  if (level === 'high') return { variant: 'risk_high' as const, label: 'HIGH' }
  if (level === 'medium') return { variant: 'risk_medium' as const, label: 'MEDIUM' }
  return { variant: 'risk_low' as const, label: 'LOW' }
}

interface NextStep {
  icon: React.ReactNode
  label: string
  className: string
}

function getNextStep(change: Change): NextStep {
  if (change.policyDecision === 'deny')
    return {
      icon: <Ban className="h-3 w-3" />,
      label: 'Blocked',
      className:
        'bg-risk-critical/15 text-risk-critical ring-1 ring-risk-critical/30',
    }
  if (change.policyDecision === 'escalate')
    return {
      icon: <ArrowUpRight className="h-3 w-3" />,
      label: 'Escalate',
      className:
        'bg-status-escalated/15 text-status-escalated ring-1 ring-status-escalated/30',
    }
  if (change.approvalState === 'pending')
    return {
      icon: <Clock className="h-3 w-3" />,
      label: 'Needs approval',
      className:
        'bg-status-pending/15 text-status-pending ring-1 ring-status-pending/30',
    }
  if (change.status === 'approved')
    return {
      icon: <CheckCircle2 className="h-3 w-3" />,
      label: 'Ready',
      className:
        'bg-status-approved/15 text-status-approved ring-1 ring-status-approved/30',
    }
  if (change.status === 'deployed')
    return {
      icon: <Rocket className="h-3 w-3" />,
      label: 'Deployed',
      className: 'bg-secondary text-muted-foreground ring-1 ring-border',
    }
  return {
    icon: <Clock className="h-3 w-3" />,
    label: 'In review',
    className: 'bg-primary/15 text-primary ring-1 ring-primary/30',
  }
}

const col = createColumnHelper<Change>()

const columns = [
  col.accessor('title', {
    header: 'Change',
    size: 360,
    cell: (info) => {
      const change = info.row.original
      return (
        <Link to={`/changes/${change.id}`} className="flex items-center gap-3 group">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary text-muted-foreground flex-shrink-0 group-hover:bg-primary/15 group-hover:text-primary transition-colors">
            <GitPullRequest className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-foreground group-hover:text-primary transition-colors truncate">
              {info.getValue()}
            </div>
            <div className="text-xs text-muted-foreground truncate">
              {change.ticketId} · {change.service}
            </div>
          </div>
        </Link>
      )
    },
  }),
  col.accessor('riskLevel', {
    header: 'Risk',
    cell: (info) => {
      const r = riskToBadge(info.getValue())
      return <Badge variant={r.variant}>{r.label}</Badge>
    },
    sortingFn: (a, b) => {
      const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
      return order[a.original.riskLevel] - order[b.original.riskLevel]
    },
  }),
  col.accessor('approvalState', {
    header: 'Approval',
    cell: (info) => {
      const state = info.getValue()
      const variant =
        state === 'approved' ? 'success' : state === 'denied' ? 'danger' : state === 'pending' ? 'warning' : 'outline'
      const label = state.replace('_', ' ')
      return <Badge variant={variant}>{label}</Badge>
    },
  }),
  col.accessor('policyDecision', {
    header: 'Policy',
    cell: (info) => {
      const d = info.getValue()
      const variant =
        d === 'allow'
          ? 'success'
          : d === 'deny'
            ? 'danger'
            : d === 'escalate'
              ? 'warning'
              : 'secondary'
      return <Badge variant={variant}>{d}</Badge>
    },
  }),
  col.display({
    id: 'nextStep',
    header: 'Next Step',
    cell: (info) => {
      const hint = getNextStep(info.row.original)
      return (
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold whitespace-nowrap',
            hint.className,
          )}
        >
          {hint.icon}
          {hint.label}
        </span>
      )
    },
    enableSorting: false,
  }),
  col.accessor('owner', {
    header: 'Owner',
    cell: (info) => <OwnerChip name={info.getValue()} />,
  }),
  col.accessor('updatedAt', {
    header: 'Updated',
    cell: (info) => (
      <span className="text-xs text-muted-foreground whitespace-nowrap tabular-nums">
        {timeAgo(info.getValue())}
      </span>
    ),
  }),
  col.display({
    id: 'actions',
    cell: (info) => (
      <Link
        to={`/changes/${info.row.original.id}`}
        className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        aria-label="Open change"
      >
        <ArrowRight className="h-4 w-4" />
      </Link>
    ),
    enableSorting: false,
  }),
]

export default function Changes() {
  const { data: changes = [], isLoading } = useChanges()

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-semibold text-foreground tracking-tight">Changes</h1>
        <p className="text-base text-muted-foreground mt-4">
          Engineering and release change requests
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full max-w-md" />
          <Skeleton className="h-96 w-full" />
        </div>
      ) : (
        <DataTable
          data={changes}
          columns={columns}
          searchPlaceholder="Search changes by title, service, owner..."
        />
      )}
    </div>
  )
}
