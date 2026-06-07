/**
 * Audit Trail — chronological event log with live tail.
 *
 * Phase 4 rebuild: shadcn primitives, ring-bordered result chips,
 * proper stat Cards, filter buttons as Button variants. Live indicator
 * uses the shared Badge style.
 */
import { useState, useMemo, Fragment } from 'react'
import {
  Shield,
  AlertTriangle,
  Radio,
  CheckCircle2,
  XCircle,
  ArrowUpRight,
  Ban,
  ChevronRight,
  ChevronDown,
} from 'lucide-react'
import { useAuditEvents } from '@/hooks/useData'
import { useAuditStream } from '@/hooks/useAuditStream'
import { formatDate, cn } from '@/lib/utils'
import type { AuditEvent } from '@/types'
import { useRole } from '@/lib/roles'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'

type FilterType = 'all' | 'change' | 'incident' | 'access' | 'policy' | 'execution' | 'approval'
type QuickFilter = 'governance' | 'blocks' | 'access_grants' | 'escalations' | 'restrictions'

interface ResultChip {
  icon: React.ReactNode
  label: string
  className: string
}

function resultToChip(result: string): ResultChip {
  switch (result) {
    case 'success':
      return {
        icon: <CheckCircle2 className="h-3 w-3" />,
        label: result,
        className: 'bg-status-approved/15 text-status-approved ring-1 ring-status-approved/30',
      }
    case 'blocked':
    case 'denied':
      return {
        icon: <Ban className="h-3 w-3" />,
        label: result,
        className: 'bg-risk-critical/15 text-risk-critical ring-1 ring-risk-critical/30',
      }
    case 'escalated':
      return {
        icon: <ArrowUpRight className="h-3 w-3" />,
        label: result,
        className: 'bg-status-escalated/15 text-status-escalated ring-1 ring-status-escalated/30',
      }
    default:
      return {
        icon: <CheckCircle2 className="h-3 w-3" />,
        label: result,
        className: 'bg-secondary text-muted-foreground ring-1 ring-border',
      }
  }
}

const quickFilterDefs: { id: QuickFilter; label: string }[] = [
  { id: 'governance', label: 'Policy Events' },
  { id: 'blocks', label: 'Blocks & Denials' },
  { id: 'access_grants', label: 'Access Decisions' },
  { id: 'escalations', label: 'Escalations' },
  { id: 'restrictions', label: 'Exec Restrictions' },
]

function matchesQuickFilter(event: AuditEvent, qf: QuickFilter): boolean {
  switch (qf) {
    case 'governance':
      return event.objectType === 'policy' || !!event.policyRule
    case 'blocks':
      return event.result === 'blocked' || event.result === 'denied'
    case 'access_grants':
      return (
        event.objectType === 'access' ||
        (event.objectType === 'approval' && event.objectTitle.toLowerCase().includes('access'))
      )
    case 'escalations':
      return event.result === 'escalated' || event.action.toLowerCase().includes('escalat')
    case 'restrictions':
      return event.objectType === 'execution'
    default:
      return false
  }
}

const filterDefs: { id: FilterType; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'change', label: 'Changes' },
  { id: 'incident', label: 'Incidents' },
  { id: 'access', label: 'Access' },
  { id: 'policy', label: 'Policy' },
  { id: 'approval', label: 'Approvals' },
  { id: 'execution', label: 'Execution' },
]

export default function AuditTrail() {
  const { data: fetchedEvents = [], isLoading } = useAuditEvents()
  const { liveEvents, connected, receivedCount } = useAuditStream()
  const { role } = useRole()
  const isAdmin = role === 'admin'

  const auditEvents = useMemo(() => {
    const seen = new Set<string>()
    const merged: AuditEvent[] = []
    for (const e of liveEvents) {
      if (!seen.has(e.id)) {
        seen.add(e.id)
        merged.push(e)
      }
    }
    for (const e of fetchedEvents) {
      if (!seen.has(e.id)) {
        seen.add(e.id)
        merged.push(e)
      }
    }
    return merged
  }, [fetchedEvents, liveEvents])

  const [filter, setFilter] = useState<FilterType>('all')
  const [quickFilter, setQuickFilter] = useState<QuickFilter | null>(isAdmin ? 'governance' : null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  let filtered = filter === 'all' ? auditEvents : auditEvents.filter((e) => e.objectType === filter)
  if (quickFilter) {
    filtered = auditEvents.filter((e) => matchesQuickFilter(e, quickFilter))
  }

  const policyEventCount = auditEvents.filter((e) => e.objectType === 'policy' || !!e.policyRule).length
  const blockCount = auditEvents.filter((e) => e.result === 'blocked' || e.result === 'denied').length
  const escalationCount = auditEvents.filter((e) => e.result === 'escalated').length

  return (
    <div className="space-y-10">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-foreground tracking-tight">Audit Trail</h1>
          <p className="text-base text-muted-foreground mt-2">
            {isAdmin
              ? 'Governance event history — policy evaluations, blocks, access decisions, and restrictions'
              : 'Complete decision and action history'}
          </p>
        </div>
        {/* Live indicator */}
        <div
          className={cn(
            'flex items-center gap-2 rounded-md px-3 py-2 text-xs font-semibold ring-1',
            connected
              ? 'bg-status-approved/15 text-status-approved ring-status-approved/30'
              : 'bg-secondary text-muted-foreground ring-border',
          )}
        >
          <Radio className={cn('h-3.5 w-3.5', connected && 'animate-pulse')} />
          {connected ? 'Live' : 'Connecting…'}
          {receivedCount > 0 && (
            <span className="rounded-full bg-primary/20 text-primary px-1.5 py-0.5 text-[10px]">
              +{receivedCount}
            </span>
          )}
        </div>
      </div>

      {/* Admin stats */}
      {isAdmin && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatTile
            icon={<Shield className="h-5 w-5 text-primary" />}
            value={policyEventCount}
            label="Policy events"
            color="text-foreground"
          />
          <StatTile
            icon={<AlertTriangle className="h-5 w-5 text-risk-critical" />}
            value={blockCount}
            label="Blocks & denials"
            color="text-risk-critical"
          />
          <StatTile
            icon={<ArrowUpRight className="h-5 w-5 text-status-escalated" />}
            value={escalationCount}
            label="Escalations"
            color="text-status-escalated"
          />
        </div>
      )}

      {/* Quick filters (admin only) */}
      {isAdmin && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mr-1">
            Quick
          </span>
          {quickFilterDefs.map((qf) => (
            <Button
              key={qf.id}
              variant={quickFilter === qf.id ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                if (quickFilter === qf.id) {
                  setQuickFilter(null)
                  setFilter('all')
                } else {
                  setQuickFilter(qf.id)
                  setFilter('all')
                }
              }}
            >
              {qf.label}
            </Button>
          ))}
        </div>
      )}

      {/* Type filters */}
      <div className="flex flex-wrap items-center gap-2">
        {filterDefs.map((f) => (
          <Button
            key={f.id}
            variant={filter === f.id && !quickFilter ? 'default' : 'outline'}
            size="sm"
            onClick={() => {
              setFilter(f.id)
              setQuickFilter(null)
            }}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {/* Event table */}
      {isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table className="min-w-[900px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="px-5 w-10"></TableHead>
                  <TableHead className="px-5">Timestamp</TableHead>
                  <TableHead className="px-5">Actor</TableHead>
                  <TableHead className="px-5">Action</TableHead>
                  <TableHead className="px-5">Object</TableHead>
                  <TableHead className="px-5">Policy</TableHead>
                  <TableHead className="px-5">Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((event) => {
                  const isLive = liveEvents.some((e) => e.id === event.id)
                  const expanded = expandedId === event.id
                  const chip = resultToChip(event.result)
                  return (
                    <Fragment key={event.id}>
                      <TableRow
                        className={cn(
                          'cursor-pointer',
                          isLive && 'animate-[fadeIn_0.5s_ease-out] bg-primary/5',
                        )}
                        onClick={() => setExpandedId(expanded ? null : event.id)}
                      >
                        <TableCell className="px-5 py-4">
                          {expanded ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          )}
                        </TableCell>
                        <TableCell className="px-5 py-4 text-xs text-muted-foreground font-mono whitespace-nowrap">
                          {formatDate(event.timestamp)}
                        </TableCell>
                        <TableCell className="px-5 py-4 text-sm text-foreground">
                          {event.actor}
                        </TableCell>
                        <TableCell className="px-5 py-4 text-sm text-foreground/85">
                          {event.action}
                        </TableCell>
                        <TableCell className="px-5 py-4">
                          <div className="text-sm text-foreground font-medium">{event.objectTitle}</div>
                          <div className="text-xs text-muted-foreground">
                            {event.objectType} · {event.objectId}
                          </div>
                        </TableCell>
                        <TableCell className="px-5 py-4 text-xs text-muted-foreground font-mono">
                          {event.policyRule || '—'}
                        </TableCell>
                        <TableCell className="px-5 py-4">
                          <span
                            className={cn(
                              'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold whitespace-nowrap',
                              chip.className,
                            )}
                          >
                            {chip.icon}
                            {chip.label}
                          </span>
                        </TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={7} className="px-5 py-4 bg-secondary/40">
                            <div className="text-sm text-foreground/85 leading-relaxed">
                              {event.details}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  )
                })}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="px-5 py-16 text-center text-sm text-muted-foreground">
                      No events matching this filter
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
    </div>
  )
}

function StatTile({
  icon,
  value,
  label,
  color,
}: {
  icon: React.ReactNode
  value: number
  label: string
  color: string
}) {
  return (
    <Card>
      <CardContent className="p-5 flex items-center gap-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-md bg-secondary">
          {icon}
        </div>
        <div className="min-w-0">
          <div className={cn('text-2xl font-semibold tabular-nums', color)}>{value}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
        </div>
      </CardContent>
    </Card>
  )
}
