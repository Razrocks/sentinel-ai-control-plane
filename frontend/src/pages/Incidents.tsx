/**
 * Incidents — list of operational issues.
 *
 * Phase 4 rebuild matching Changes/Approvals visual system:
 *   - Prominent severity badge with ring
 *   - Color-tinted next-action chip
 *   - KB-fix / Safe-fix support signals as ring chips
 *   - Bigger icon block at row start
 */
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  AlertTriangle,
  BookOpen,
  Wrench,
  Clock,
  ArrowUpRight,
  CheckCircle2,
} from 'lucide-react'
import { createColumnHelper } from '@tanstack/react-table'
import { useIncidents } from '@/hooks/useData'
import { SystemChip } from '@/components/shared'
import { DataTable } from '@/components/shared/DataTable'
import { timeAgo, cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import type { Incident } from '@/types'

const sevToBadge: Record<
  string,
  { variant: 'risk_critical' | 'risk_high' | 'risk_medium' | 'risk_low'; label: string }
> = {
  sev1: { variant: 'risk_critical', label: 'SEV1' },
  sev2: { variant: 'risk_high', label: 'SEV2' },
  sev3: { variant: 'risk_medium', label: 'SEV3' },
  sev4: { variant: 'risk_low', label: 'SEV4' },
}

const statusLabel: Record<string, string> = {
  new: 'New',
  investigating: 'Investigating',
  identified: 'Identified',
  monitoring: 'Monitoring',
  resolved: 'Resolved',
}

interface NextAction {
  icon: React.ReactNode
  label: string
  className: string
}

function getNextAction(incident: Incident): NextAction {
  if (incident.severity === 'sev1')
    return {
      icon: <AlertTriangle className="h-3 w-3" />,
      label: 'Urgent triage',
      className: 'bg-risk-critical/15 text-risk-critical ring-1 ring-risk-critical/30',
    }
  if (incident.severity === 'sev2')
    return {
      icon: <AlertTriangle className="h-3 w-3" />,
      label: 'Needs attention',
      className: 'bg-risk-high/15 text-risk-high ring-1 ring-risk-high/30',
    }
  if (incident.isRecurring)
    return {
      icon: <BookOpen className="h-3 w-3" />,
      label: 'KB fix available',
      className: 'bg-status-approved/15 text-status-approved ring-1 ring-status-approved/30',
    }
  if (incident.status === 'new')
    return {
      icon: <Clock className="h-3 w-3" />,
      label: 'Triage needed',
      className: 'bg-status-pending/15 text-status-pending ring-1 ring-status-pending/30',
    }
  if (incident.status === 'resolved')
    return {
      icon: <CheckCircle2 className="h-3 w-3" />,
      label: 'Resolved',
      className: 'bg-secondary text-muted-foreground ring-1 ring-border',
    }
  return {
    icon: <Clock className="h-3 w-3" />,
    label: 'In progress',
    className: 'bg-primary/15 text-primary ring-1 ring-primary/30',
  }
}

const col = createColumnHelper<Incident>()

const columns = [
  col.accessor('title', {
    header: 'Incident',
    size: 360,
    cell: (info) => {
      const inc = info.row.original
      return (
        <Link to={`/incidents/${inc.id}`} className="flex items-center gap-3 group">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary text-muted-foreground flex-shrink-0 group-hover:bg-risk-high/15 group-hover:text-risk-high transition-colors">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-foreground group-hover:text-primary transition-colors truncate">
              {info.getValue()}
            </div>
            <div className="text-xs text-muted-foreground truncate">{inc.incidentId}</div>
          </div>
        </Link>
      )
    },
  }),
  col.accessor('affectedService', {
    header: 'Service',
    cell: (info) => <SystemChip name={info.getValue()} />,
  }),
  col.accessor('severity', {
    header: 'Severity',
    cell: (info) => {
      const b = sevToBadge[info.getValue()]
      return <Badge variant={b.variant}>{b.label}</Badge>
    },
    sortingFn: (a, b) => {
      const order = { sev1: 0, sev2: 1, sev3: 2, sev4: 3 }
      return order[a.original.severity] - order[b.original.severity]
    },
  }),
  col.accessor('status', {
    header: 'Status',
    cell: (info) => {
      const s = info.getValue()
      const variant =
        s === 'resolved' ? 'success' : s === 'investigating' ? 'warning' : 'secondary'
      return <Badge variant={variant}>{statusLabel[s] ?? s}</Badge>
    },
  }),
  col.display({
    id: 'nextAction',
    header: 'Next Action',
    cell: (info) => {
      const hint = getNextAction(info.row.original)
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
  col.display({
    id: 'supportSignal',
    header: 'Support',
    cell: (info) => {
      const inc = info.row.original
      if (inc.isRecurring)
        return (
          <span className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium bg-status-approved/15 text-status-approved ring-1 ring-status-approved/30 whitespace-nowrap">
            <BookOpen className="h-3 w-3" /> KB fix
          </span>
        )
      if (inc.recommendedFix?.toLowerCase().includes('config'))
        return (
          <span className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium bg-status-approved/15 text-status-approved ring-1 ring-status-approved/30 whitespace-nowrap">
            <Wrench className="h-3 w-3" /> Safe fix
          </span>
        )
      if (inc.severity === 'sev1' || inc.severity === 'sev2')
        return (
          <span className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium bg-status-escalated/15 text-status-escalated ring-1 ring-status-escalated/30 whitespace-nowrap">
            <ArrowUpRight className="h-3 w-3" /> Escalate
          </span>
        )
      return <span className="text-xs text-muted-foreground">—</span>
    },
    enableSorting: false,
  }),
  col.accessor('assignmentGroup', {
    header: 'Assignment',
    cell: (info) => (
      <span className="text-sm text-foreground/85 whitespace-nowrap">{info.getValue()}</span>
    ),
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
        to={`/incidents/${info.row.original.id}`}
        className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
      >
        <ArrowRight className="h-4 w-4" />
      </Link>
    ),
    enableSorting: false,
  }),
]

export default function Incidents() {
  const { data: incidents = [], isLoading } = useIncidents()

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-semibold text-foreground tracking-tight">Incidents</h1>
        <p className="text-base text-muted-foreground mt-4">
          ServiceNow incidents and support issues
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full max-w-md" />
          <Skeleton className="h-96 w-full" />
        </div>
      ) : (
        <DataTable
          data={incidents}
          columns={columns}
          searchPlaceholder="Search incidents by title, service, requester..."
        />
      )}
    </div>
  )
}
