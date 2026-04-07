import { Link } from 'react-router-dom'
import { ArrowRight, AlertTriangle, BookOpen, Wrench } from 'lucide-react'
import { createColumnHelper } from '@tanstack/react-table'
import { useIncidents } from '@/hooks/useData'
import { RiskBadge, SystemChip } from '@/components/shared'
import { DataTable } from '@/components/shared/DataTable'
import { timeAgo } from '@/lib/utils'
import type { Incident } from '@/types'

const sevToRisk = { sev1: 'critical', sev2: 'high', sev3: 'medium', sev4: 'low' } as const

const statusLabel: Record<string, string> = {
  new: 'New',
  investigating: 'Investigating',
  identified: 'Identified',
  monitoring: 'Monitoring',
  resolved: 'Resolved',
}

function getNextAction(incident: Incident): { label: string; color: string } {
  if (incident.severity === 'sev1') return { label: 'Urgent triage', color: 'text-risk-critical bg-risk-critical/10' }
  if (incident.severity === 'sev2') return { label: 'Needs attention', color: 'text-risk-high bg-risk-high/10' }
  if (incident.isRecurring) return { label: 'KB fix available', color: 'text-status-approved bg-status-approved/10' }
  if (incident.status === 'new') return { label: 'Triage needed', color: 'text-status-pending bg-status-pending/10' }
  if (incident.status === 'investigating') return { label: 'In progress', color: 'text-accent bg-accent/10' }
  if (incident.status === 'resolved') return { label: 'Resolved', color: 'text-text-muted bg-surface-raised' }
  return { label: 'Monitoring', color: 'text-text-muted bg-surface-raised' }
}

const col = createColumnHelper<Incident>()

const columns = [
  col.accessor('title', {
    header: 'Incident',
    size: 320,
    cell: info => (
      <Link to={`/incidents/${info.row.original.id}`} className="flex items-center gap-2 group">
        <AlertTriangle className="w-4 h-4 text-text-muted flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-sm text-text-primary font-medium group-hover:text-accent transition-colors truncate">{info.getValue()}</div>
          <div className="text-xs text-text-muted">{info.row.original.incidentId}</div>
        </div>
      </Link>
    ),
  }),
  col.accessor('affectedService', {
    header: 'Service',
    cell: info => <SystemChip name={info.getValue()} />,
  }),
  col.accessor('severity', {
    header: 'Severity',
    cell: info => <RiskBadge level={sevToRisk[info.getValue()]} size="sm" />,
    sortingFn: (a, b) => {
      const order = { sev1: 0, sev2: 1, sev3: 2, sev4: 3 }
      return order[a.original.severity] - order[b.original.severity]
    },
  }),
  col.accessor('status', {
    header: 'Status',
    cell: info => <span className="text-sm text-text-secondary whitespace-nowrap">{statusLabel[info.getValue()]}</span>,
  }),
  col.display({
    id: 'nextAction',
    header: 'Next Action',
    cell: info => {
      const hint = getNextAction(info.row.original)
      return <span className={`text-[11px] font-medium px-2 py-0.5 rounded whitespace-nowrap ${hint.color}`}>{hint.label}</span>
    },
    enableSorting: false,
  }),
  col.display({
    id: 'supportSignal',
    header: 'Support',
    cell: info => {
      const inc = info.row.original
      if (inc.isRecurring) return (
        <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-status-approved/10 text-status-approved whitespace-nowrap">
          <BookOpen className="w-3 h-3" /> KB fix
        </span>
      )
      if (inc.recommendedFix?.toLowerCase().includes('config')) return (
        <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-status-approved/10 text-status-approved whitespace-nowrap">
          <Wrench className="w-3 h-3" /> Safe fix
        </span>
      )
      if (inc.severity === 'sev1' || inc.severity === 'sev2') return (
        <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-status-escalated/10 text-status-escalated whitespace-nowrap">
          <ArrowRight className="w-3 h-3" /> Escalate
        </span>
      )
      return <span className="text-[10px] text-text-muted whitespace-nowrap">—</span>
    },
    enableSorting: false,
  }),
  col.accessor('assignmentGroup', {
    header: 'Assignment',
    cell: info => <span className="text-sm text-text-secondary whitespace-nowrap">{info.getValue()}</span>,
  }),
  col.accessor('updatedAt', {
    header: 'Updated',
    cell: info => <span className="text-xs text-text-muted whitespace-nowrap">{timeAgo(info.getValue())}</span>,
  }),
  col.display({
    id: 'actions',
    cell: info => (
      <Link to={`/incidents/${info.row.original.id}`} className="text-accent hover:text-accent-hover">
        <ArrowRight className="w-4 h-4" />
      </Link>
    ),
    enableSorting: false,
  }),
]

export default function Incidents() {
  const { data: incidents = [], isLoading } = useIncidents()

  if (isLoading) return <div className="text-text-muted p-8">Loading incidents…</div>

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-text-primary">Incidents</h1>
        <p className="text-text-secondary mt-1">ServiceNow incidents and support issues</p>
      </div>
      <DataTable
        data={incidents}
        columns={columns}
        searchPlaceholder="Search incidents by title, service, requester..."
      />
    </div>
  )
}
