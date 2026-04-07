import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, KeyRound, UserCheck } from 'lucide-react'
import { createColumnHelper } from '@tanstack/react-table'
import { useAccessRequests } from '@/hooks/useData'
import { RiskBadge, ApprovalBadge, PolicyBadge, SystemChip } from '@/components/shared'
import { DataTable } from '@/components/shared/DataTable'
import { timeAgo } from '@/lib/utils'
import { useRole } from '@/lib/roles'
import type { AccessRequest } from '@/types'

function getNextAction(req: AccessRequest): { label: string; color: string } {
  if (req.entitlementCheck === 'ineligible') return { label: 'Denied by policy', color: 'text-risk-critical bg-risk-critical/10' }
  if (req.policyDecision === 'deny') return { label: 'Policy blocked', color: 'text-risk-critical bg-risk-critical/10' }
  if (req.managerApprovalRequired && req.managerApproval === 'pending') return { label: 'Waiting on manager', color: 'text-status-pending bg-status-pending/10' }
  if (req.ownerApprovalRequired && req.ownerApproval === 'pending') return { label: 'Waiting on owner', color: 'text-status-pending bg-status-pending/10' }
  if (req.status === 'approved') return { label: 'Ready to grant', color: 'text-status-approved bg-status-approved/10' }
  if (req.status === 'denied') return { label: 'Denied', color: 'text-risk-critical bg-risk-critical/10' }
  return { label: 'Support can route', color: 'text-accent bg-accent/10' }
}

function getQueueReason(req: AccessRequest): { label: string; color: string; icon: boolean } {
  // For Access Approver: why is this in my queue?
  if (req.ownerApprovalRequired && req.ownerApproval === 'pending' && req.managerApproval === 'approved') {
    return { label: 'Ready for my decision', color: 'text-accent bg-accent/10', icon: true }
  }
  if (req.ownerApprovalRequired && req.ownerApproval === 'pending' && req.managerApproval === 'pending') {
    return { label: 'Waiting on manager first', color: 'text-status-pending bg-status-pending/10', icon: false }
  }
  if (req.managerApprovalRequired && req.managerApproval === 'pending') {
    return { label: 'My approval required', color: 'text-accent bg-accent/10', icon: true }
  }
  if (req.status === 'approved') {
    return { label: 'Decided — approved', color: 'text-status-approved bg-status-approved/10', icon: false }
  }
  if (req.status === 'denied') {
    return { label: 'Decided — denied', color: 'text-risk-critical bg-risk-critical/10', icon: false }
  }
  return { label: 'Review needed', color: 'text-text-muted bg-surface-raised', icon: false }
}

const col = createColumnHelper<AccessRequest>()

function buildColumns(isAccessApprover: boolean) {
  const cols = [
    col.accessor('requester', {
      header: 'Request',
      cell: info => (
        <Link to={`/access-requests/${info.row.original.id}`} className="flex items-center gap-2 group">
          <KeyRound className="w-4 h-4 text-text-muted flex-shrink-0" />
          <div>
            <div className="text-sm text-text-primary font-medium group-hover:text-accent transition-colors">{info.getValue()}</div>
            <div className="text-xs text-text-muted">{info.row.original.requestId}</div>
          </div>
        </Link>
      ),
    }),
    col.accessor('requestedSystem', {
      header: 'System',
      cell: info => <SystemChip name={info.getValue()} />,
    }),
    col.accessor('requestedRole', {
      header: 'Role',
      cell: info => <span className="text-sm text-text-secondary">{info.getValue()}</span>,
    }),
    col.accessor('riskLevel', {
      header: 'Risk',
      cell: info => <RiskBadge level={info.getValue()} size="sm" />,
      sortingFn: (a, b) => {
        const order = { critical: 0, high: 1, medium: 2, low: 3 }
        return order[a.original.riskLevel] - order[b.original.riskLevel]
      },
    }),
    col.accessor('policyDecision', {
      header: 'Policy',
      cell: info => <PolicyBadge decision={info.getValue()} />,
    }),
  ]

  if (isAccessApprover) {
    cols.push(
      col.display({
        id: 'queueReason',
        header: 'My Queue',
        cell: info => {
          const reason = getQueueReason(info.row.original)
          return (
            <span className={`text-[11px] font-medium px-2 py-0.5 rounded whitespace-nowrap inline-flex items-center gap-1 ${reason.color}`}>
              {reason.icon && <UserCheck className="w-3 h-3" />}
              {reason.label}
            </span>
          )
        },
        enableSorting: false,
      }) as any,
    )
  }

  cols.push(
    col.display({
      id: 'nextAction',
      header: 'Next Action',
      cell: info => {
        const hint = getNextAction(info.row.original)
        return <span className={`text-[11px] font-medium px-2 py-0.5 rounded whitespace-nowrap ${hint.color}`}>{hint.label}</span>
      },
      enableSorting: false,
    }) as any,
    col.accessor('createdAt', {
      header: 'Requested',
      cell: info => <span className="text-xs text-text-muted whitespace-nowrap">{timeAgo(info.getValue())}</span>,
    }) as any,
    col.display({
      id: 'actions',
      cell: info => (
        <Link to={`/access-requests/${info.row.original.id}`} className="text-accent hover:text-accent-hover">
          <ArrowRight className="w-4 h-4" />
        </Link>
      ),
      enableSorting: false,
    }) as any,
  )

  return cols
}

export default function AccessRequests() {
  const { role } = useRole()
  const isAccessApprover = role === 'access_approver'
  const columns = useMemo(() => buildColumns(isAccessApprover), [isAccessApprover])
  const { data: accessRequests = [], isLoading } = useAccessRequests()

  if (isLoading) {
    return <div className="flex items-center justify-center h-64 text-text-muted">Loading access requests...</div>
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-text-primary">Access Requests</h1>
        <p className="text-text-secondary mt-1">
          {isAccessApprover
            ? 'Access requests in your approval scope'
            : 'Access and entitlement requests with approval routing'}
        </p>
      </div>
      <DataTable
        data={accessRequests}
        columns={columns}
        searchPlaceholder="Search requests by name, system, role..."
      />
    </div>
  )
}
