/**
 * Access Requests — list with role-aware columns.
 *
 * Phase 4 rebuild matching Changes/Incidents pattern: ring-bordered
 * status chips, prominent risk badges, icon block on Request column.
 */
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  KeyRound,
  UserCheck,
  Ban,
  Clock,
  CheckCircle2,
  XCircle,
  ShieldAlert,
} from 'lucide-react'
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table'
import { useAccessRequests } from '@/hooks/useData'
import { SystemChip } from '@/components/shared'
import { DataTable } from '@/components/shared/DataTable'
import { timeAgo, cn } from '@/lib/utils'
import { useRole } from '@/lib/roles'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'
import type { AccessRequest } from '@/types'

function riskToBadge(level: string) {
  if (level === 'critical') return { variant: 'risk_critical' as const, label: 'CRITICAL' }
  if (level === 'high') return { variant: 'risk_high' as const, label: 'HIGH' }
  if (level === 'medium') return { variant: 'risk_medium' as const, label: 'MEDIUM' }
  return { variant: 'risk_low' as const, label: 'LOW' }
}

interface Chip {
  icon: React.ReactNode
  label: string
  className: string
}

function getNextAction(req: AccessRequest): Chip {
  if (req.entitlementCheck === 'ineligible' || req.policyDecision === 'deny')
    return {
      icon: <Ban className="h-3 w-3" />,
      label: req.entitlementCheck === 'ineligible' ? 'Denied by policy' : 'Policy blocked',
      className: 'bg-risk-critical/15 text-risk-critical ring-1 ring-risk-critical/30',
    }
  if (req.managerApprovalRequired && req.managerApproval === 'pending')
    return {
      icon: <Clock className="h-3 w-3" />,
      label: 'Waiting on manager',
      className: 'bg-status-pending/15 text-status-pending ring-1 ring-status-pending/30',
    }
  if (req.ownerApprovalRequired && req.ownerApproval === 'pending')
    return {
      icon: <Clock className="h-3 w-3" />,
      label: 'Waiting on owner',
      className: 'bg-status-pending/15 text-status-pending ring-1 ring-status-pending/30',
    }
  if (req.status === 'approved')
    return {
      icon: <CheckCircle2 className="h-3 w-3" />,
      label: 'Ready to grant',
      className: 'bg-status-approved/15 text-status-approved ring-1 ring-status-approved/30',
    }
  if (req.status === 'denied')
    return {
      icon: <XCircle className="h-3 w-3" />,
      label: 'Denied',
      className: 'bg-risk-critical/15 text-risk-critical ring-1 ring-risk-critical/30',
    }
  return {
    icon: <ArrowRight className="h-3 w-3" />,
    label: 'Support can route',
    className: 'bg-primary/15 text-primary ring-1 ring-primary/30',
  }
}

function getQueueReason(req: AccessRequest): Chip {
  if (req.ownerApprovalRequired && req.ownerApproval === 'pending' && req.managerApproval === 'approved')
    return {
      icon: <UserCheck className="h-3 w-3" />,
      label: 'Ready for my decision',
      className: 'bg-primary/15 text-primary ring-1 ring-primary/30',
    }
  if (req.ownerApprovalRequired && req.ownerApproval === 'pending' && req.managerApproval === 'pending')
    return {
      icon: <Clock className="h-3 w-3" />,
      label: 'Waiting on manager first',
      className: 'bg-status-pending/15 text-status-pending ring-1 ring-status-pending/30',
    }
  if (req.managerApprovalRequired && req.managerApproval === 'pending')
    return {
      icon: <UserCheck className="h-3 w-3" />,
      label: 'My approval required',
      className: 'bg-primary/15 text-primary ring-1 ring-primary/30',
    }
  if (req.status === 'approved')
    return {
      icon: <CheckCircle2 className="h-3 w-3" />,
      label: 'Decided · approved',
      className: 'bg-status-approved/15 text-status-approved ring-1 ring-status-approved/30',
    }
  if (req.status === 'denied')
    return {
      icon: <XCircle className="h-3 w-3" />,
      label: 'Decided · denied',
      className: 'bg-risk-critical/15 text-risk-critical ring-1 ring-risk-critical/30',
    }
  return {
    icon: <Clock className="h-3 w-3" />,
    label: 'Review needed',
    className: 'bg-secondary text-muted-foreground ring-1 ring-border',
  }
}

const col = createColumnHelper<AccessRequest>()

function chipSpan(chip: Chip) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold whitespace-nowrap',
        chip.className,
      )}
    >
      {chip.icon}
      {chip.label}
    </span>
  )
}

function buildColumns(isAccessApprover: boolean): ColumnDef<AccessRequest, unknown>[] {
  const cols: ColumnDef<AccessRequest, unknown>[] = [
    col.accessor('requester', {
      header: 'Request',
      cell: (info) => {
        const req = info.row.original
        return (
          <Link to={`/access-requests/${req.id}`} className="flex items-center gap-3 group">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary text-muted-foreground flex-shrink-0 group-hover:bg-primary/15 group-hover:text-primary transition-colors">
              <KeyRound className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                {info.getValue()}
              </div>
              <div className="text-xs text-muted-foreground">{req.requestId}</div>
            </div>
          </Link>
        )
      },
    }) as ColumnDef<AccessRequest, unknown>,
    col.accessor('requestedSystem', {
      header: 'System',
      cell: (info) => <SystemChip name={info.getValue()} />,
    }) as ColumnDef<AccessRequest, unknown>,
    col.accessor('requestedRole', {
      header: 'Role',
      cell: (info) => <span className="text-sm text-foreground/85">{info.getValue()}</span>,
    }) as ColumnDef<AccessRequest, unknown>,
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
    }) as ColumnDef<AccessRequest, unknown>,
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
    }) as ColumnDef<AccessRequest, unknown>,
  ]

  if (isAccessApprover) {
    cols.push(
      col.display({
        id: 'queueReason',
        header: 'My Queue',
        cell: (info) => chipSpan(getQueueReason(info.row.original)),
        enableSorting: false,
      }) as ColumnDef<AccessRequest, unknown>,
    )
  }

  cols.push(
    col.display({
      id: 'nextAction',
      header: 'Next Action',
      cell: (info) => chipSpan(getNextAction(info.row.original)),
      enableSorting: false,
    }) as ColumnDef<AccessRequest, unknown>,
    col.accessor('createdAt', {
      header: 'Requested',
      cell: (info) => (
        <span className="text-xs text-muted-foreground whitespace-nowrap tabular-nums">
          {timeAgo(info.getValue())}
        </span>
      ),
    }) as ColumnDef<AccessRequest, unknown>,
    col.display({
      id: 'actions',
      cell: (info) => (
        <Link
          to={`/access-requests/${info.row.original.id}`}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          <ArrowRight className="h-4 w-4" />
        </Link>
      ),
      enableSorting: false,
    }) as ColumnDef<AccessRequest, unknown>,
  )

  return cols
}

export default function AccessRequests() {
  const { role } = useRole()
  const isAccessApprover = role === 'access_approver'
  const columns = useMemo(() => buildColumns(isAccessApprover), [isAccessApprover])
  const { data: accessRequests = [], isLoading } = useAccessRequests()

  const stats = {
    total: accessRequests.length,
    pending: accessRequests.filter(r => r.status === 'pending').length,
    ineligible: accessRequests.filter(r => r.entitlementCheck === 'ineligible').length,
    approved: accessRequests.filter(r => r.status === 'approved').length,
  }

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-3">
        <h1 className="font-heading text-3xl font-medium tracking-tight text-foreground">
          Access Requests
        </h1>
        <p className="text-sm text-muted-foreground">
          {isAccessApprover
            ? 'Access requests in your approval scope.'
            : 'Access and entitlement requests with approval routing.'}
        </p>
      </div>

      {!isLoading && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <KPI label="Total" value={stats.total} icon={<KeyRound className="h-4 w-4 text-muted-foreground" />} />
          <KPI label="Pending" value={stats.pending} icon={<Clock className="h-4 w-4 text-status-pending" />} tone="warn" />
          <KPI label="Ineligible" value={stats.ineligible} icon={<ShieldAlert className="h-4 w-4 text-risk-critical" />} tone="risk" />
          <KPI label="Approved" value={stats.approved} icon={<CheckCircle2 className="h-4 w-4 text-status-approved" />} tone="ok" />
        </div>
      )}

      {isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-10 w-full max-w-md" />
          <Skeleton className="h-96 w-full" />
        </div>
      ) : (
        <DataTable
          emptyTitle="No access requests"
          emptyDescription="When a teammate requests entitlements to a system, the request and approval chain show up here."
          data={accessRequests}
          columns={columns}
          searchPlaceholder="Search requests by name, system, role..."
        />
      )}
    </div>
  )
}

function KPI({
  label,
  value,
  icon,
  tone,
}: {
  label: string
  value: number
  icon: React.ReactNode
  tone?: 'risk' | 'warn' | 'ok'
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-3 p-5">
        <div className="flex flex-col gap-1.5 min-w-0 overflow-hidden">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground truncate">
            {label}
          </span>
          <span
            className={cn(
              'text-3xl font-semibold tabular-nums tracking-tight',
              tone === 'risk' && value > 0 && 'text-risk-critical',
              tone === 'warn' && value > 0 && 'text-status-pending',
              tone === 'ok' && value > 0 && 'text-status-approved',
              !tone && 'text-foreground',
            )}
          >
            {value}
          </span>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
          {icon}
        </div>
      </CardContent>
    </Card>
  )
}
