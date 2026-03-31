import { Link } from 'react-router-dom'
import { ArrowRight, GitPullRequest } from 'lucide-react'
import { createColumnHelper } from '@tanstack/react-table'
import { mockChanges } from '@/data/mock'
import { RiskBadge, ApprovalBadge, PolicyBadge, OwnerChip } from '@/components/shared'
import { DataTable } from '@/components/shared/DataTable'
import { timeAgo } from '@/lib/utils'
import type { Change } from '@/types'

const statusLabel: Record<string, string> = {
  open: 'Open',
  in_review: 'In Review',
  approved: 'Approved',
  blocked: 'Blocked',
  escalated: 'Escalated',
  deployed: 'Deployed',
  rolled_back: 'Rolled Back',
}

function getNextStep(change: Change): { label: string; color: string } {
  if (change.policyDecision === 'deny') return { label: 'Blocked', color: 'text-risk-critical bg-risk-critical/10' }
  if (change.policyDecision === 'escalate') return { label: 'Escalate', color: 'text-status-escalated bg-status-escalated/10' }
  if (change.approvalState === 'pending') return { label: 'Needs approval', color: 'text-status-pending bg-status-pending/10' }
  if (change.status === 'approved') return { label: 'Ready', color: 'text-status-approved bg-status-approved/10' }
  if (change.status === 'deployed') return { label: 'Deployed', color: 'text-text-muted bg-surface-raised' }
  return { label: 'In review', color: 'text-accent bg-accent/10' }
}

// Row-level left border color based on actionability
function getRowBorderClass(change: Change): string {
  if (change.policyDecision === 'deny') return 'border-l-2 border-l-risk-critical'
  if (change.policyDecision === 'escalate') return 'border-l-2 border-l-status-escalated'
  if (change.approvalState === 'pending') return 'border-l-2 border-l-status-pending'
  if (change.riskLevel === 'critical' || change.riskLevel === 'high') return 'border-l-2 border-l-risk-high'
  return 'border-l-2 border-l-transparent'
}

const col = createColumnHelper<Change>()

const columns = [
  col.accessor('title', {
    header: 'Change',
    size: 320,
    cell: info => (
      <Link to={`/changes/${info.row.original.id}`} className="flex items-center gap-2 group">
        <GitPullRequest className="w-4 h-4 text-text-muted flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-sm text-text-primary font-medium group-hover:text-accent transition-colors truncate">{info.getValue()}</div>
          <div className="text-xs text-text-muted">{info.row.original.ticketId} · {info.row.original.service}</div>
        </div>
      </Link>
    ),
  }),
  col.accessor('riskLevel', {
    header: 'Risk',
    cell: info => <RiskBadge level={info.getValue()} size="sm" />,
    sortingFn: (a, b) => {
      const order = { critical: 0, high: 1, medium: 2, low: 3 }
      return order[a.original.riskLevel] - order[b.original.riskLevel]
    },
  }),
  col.accessor('approvalState', {
    header: 'Approval',
    cell: info => <ApprovalBadge state={info.getValue()} />,
  }),
  col.accessor('policyDecision', {
    header: 'Policy',
    cell: info => <PolicyBadge decision={info.getValue()} />,
  }),
  col.display({
    id: 'nextStep',
    header: 'Next Step',
    cell: info => {
      const hint = getNextStep(info.row.original)
      return <span className={`text-[11px] font-medium px-2 py-0.5 rounded whitespace-nowrap ${hint.color}`}>{hint.label}</span>
    },
    enableSorting: false,
  }),
  col.accessor('owner', {
    header: 'Owner',
    cell: info => <OwnerChip name={info.getValue()} />,
  }),
  col.accessor('updatedAt', {
    header: 'Updated',
    cell: info => <span className="text-xs text-text-muted whitespace-nowrap">{timeAgo(info.getValue())}</span>,
  }),
  col.display({
    id: 'actions',
    cell: info => (
      <Link to={`/changes/${info.row.original.id}`} className="text-accent hover:text-accent-hover">
        <ArrowRight className="w-4 h-4" />
      </Link>
    ),
    enableSorting: false,
  }),
]

export default function Changes() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-text-primary">Changes</h1>
        <p className="text-text-secondary mt-1">Engineering and release change requests</p>
      </div>
      <DataTable
        data={mockChanges}
        columns={columns}
        searchPlaceholder="Search changes by title, service, owner..."
      />
    </div>
  )
}
