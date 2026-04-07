import { useState, Fragment } from 'react'
import { Shield, AlertTriangle } from 'lucide-react'
import { useAuditEvents } from '@/hooks/useData'
import { formatDate } from '@/lib/utils'
import type { AuditEvent } from '@/types'
import { useRole } from '@/lib/roles'

type FilterType = 'all' | 'change' | 'incident' | 'access' | 'policy' | 'execution' | 'approval'

// Admin-focused quick filters that group multiple object types / results
type QuickFilter = 'governance' | 'blocks' | 'access_grants' | 'escalations' | 'restrictions'

const resultColors: Record<string, string> = {
  success: 'bg-status-approved/10 text-status-approved',
  blocked: 'bg-risk-critical/10 text-risk-critical',
  escalated: 'bg-status-escalated/10 text-status-escalated',
  denied: 'bg-risk-critical/10 text-risk-critical',
}

const quickFilterDefs: { id: QuickFilter; label: string; color: string }[] = [
  { id: 'governance', label: 'Policy Events', color: 'text-accent' },
  { id: 'blocks', label: 'Blocks & Denials', color: 'text-risk-critical' },
  { id: 'access_grants', label: 'Access Decisions', color: 'text-status-draft' },
  { id: 'escalations', label: 'Escalations', color: 'text-status-escalated' },
  { id: 'restrictions', label: 'Exec Restrictions', color: 'text-status-simulated' },
]

function matchesQuickFilter(event: AuditEvent, qf: QuickFilter): boolean {
  switch (qf) {
    case 'governance':
      return event.objectType === 'policy' || !!event.policyRule
    case 'blocks':
      return event.result === 'blocked' || event.result === 'denied'
    case 'access_grants':
      return event.objectType === 'access' || (event.objectType === 'approval' && event.objectTitle.toLowerCase().includes('access'))
    case 'escalations':
      return event.result === 'escalated' || event.action.toLowerCase().includes('escalat')
    case 'restrictions':
      return event.objectType === 'execution'
    default:
      return false
  }
}

export default function AuditTrail() {
  const { data: auditEvents = [], isLoading } = useAuditEvents()
  const { role } = useRole()
  const isAdmin = role === 'admin'

  // Admin defaults to 'governance' quick filter, others to regular 'all'
  const [filter, setFilter] = useState<FilterType>(isAdmin ? 'all' : 'all')
  const [quickFilter, setQuickFilter] = useState<QuickFilter | null>(isAdmin ? 'governance' : null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Apply filters
  let filtered = filter === 'all' ? auditEvents : auditEvents.filter(e => e.objectType === filter)
  if (quickFilter) {
    filtered = auditEvents.filter(e => matchesQuickFilter(e, quickFilter))
  }

  const filters: { id: FilterType; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'change', label: 'Changes' },
    { id: 'incident', label: 'Incidents' },
    { id: 'access', label: 'Access' },
    { id: 'policy', label: 'Policy' },
    { id: 'approval', label: 'Approvals' },
    { id: 'execution', label: 'Execution' },
  ]

  // Stats for admin
  const policyEventCount = auditEvents.filter(e => e.objectType === 'policy' || !!e.policyRule).length
  const blockCount = auditEvents.filter(e => e.result === 'blocked' || e.result === 'denied').length
  const escalationCount = auditEvents.filter(e => e.result === 'escalated').length

  if (isLoading) {
    return <div className="text-text-muted py-8 text-center">Loading audit events…</div>
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-text-primary">Audit Trail</h1>
        <p className="text-text-secondary mt-1">
          {isAdmin ? 'Governance event history — policy evaluations, blocks, access decisions, and restrictions' : 'Complete decision and action history'}
        </p>
      </div>

      {/* Admin: governance summary strip */}
      {isAdmin && (
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-surface rounded-lg border border-border px-4 py-3 flex items-center gap-3">
            <Shield className="w-5 h-5 text-accent" />
            <div>
              <div className="text-lg font-semibold text-text-primary">{policyEventCount}</div>
              <div className="text-xs text-text-muted">Policy events</div>
            </div>
          </div>
          <div className="bg-surface rounded-lg border border-border px-4 py-3 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-risk-critical" />
            <div>
              <div className="text-lg font-semibold text-risk-critical">{blockCount}</div>
              <div className="text-xs text-text-muted">Blocks &amp; denials</div>
            </div>
          </div>
          <div className="bg-surface rounded-lg border border-border px-4 py-3 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-status-escalated" />
            <div>
              <div className="text-lg font-semibold text-status-escalated">{escalationCount}</div>
              <div className="text-xs text-text-muted">Escalations</div>
            </div>
          </div>
        </div>
      )}

      {/* Admin: quick filter chips */}
      {isAdmin && (
        <div className="flex gap-2">
          <span className="text-[10px] text-text-muted uppercase tracking-wider self-center mr-1">Quick:</span>
          {quickFilterDefs.map(qf => (
            <button
              key={qf.id}
              onClick={() => {
                if (quickFilter === qf.id) {
                  setQuickFilter(null)
                  setFilter('all')
                } else {
                  setQuickFilter(qf.id)
                  setFilter('all') // reset type filter when using quick filter
                }
              }}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                quickFilter === qf.id
                  ? 'bg-accent text-white'
                  : 'bg-surface text-text-secondary hover:text-text-primary hover:bg-surface-raised border border-border'
              }`}
            >
              {qf.label}
            </button>
          ))}
        </div>
      )}

      {/* Standard type filters */}
      <div className="flex gap-2">
        {filters.map(f => (
          <button
            key={f.id}
            onClick={() => {
              setFilter(f.id)
              setQuickFilter(null) // clear quick filter when using type filter
            }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filter === f.id && !quickFilter
                ? 'bg-accent text-white'
                : 'bg-surface text-text-secondary hover:text-text-primary hover:bg-surface-raised border border-border'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="bg-surface rounded-lg border border-border overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left px-4 py-3 text-xs font-medium text-text-muted uppercase tracking-wider">Timestamp</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-text-muted uppercase tracking-wider">Actor</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-text-muted uppercase tracking-wider">Action</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-text-muted uppercase tracking-wider">Object</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-text-muted uppercase tracking-wider">Policy</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-text-muted uppercase tracking-wider">Result</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map(event => (
              <Fragment key={event.id}>
                <tr
                  className="hover:bg-surface-raised transition-colors cursor-pointer"
                  onClick={() => setExpandedId(expandedId === event.id ? null : event.id)}
                >
                  <td className="px-4 py-3 text-xs text-text-muted font-mono whitespace-nowrap">{formatDate(event.timestamp)}</td>
                  <td className="px-4 py-3 text-sm text-text-primary">{event.actor}</td>
                  <td className="px-4 py-3 text-sm text-text-secondary">{event.action}</td>
                  <td className="px-4 py-3">
                    <div className="text-sm text-text-primary">{event.objectTitle}</div>
                    <div className="text-xs text-text-muted">{event.objectType} · {event.objectId}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-text-muted font-mono">{event.policyRule || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded ${resultColors[event.result] || 'bg-surface-raised text-text-secondary'}`}>
                      {event.result}
                    </span>
                  </td>
                </tr>
                {expandedId === event.id && (
                  <tr>
                    <td colSpan={6} className="px-4 py-3 bg-surface-raised">
                      <div className="text-sm text-text-secondary">{event.details}</div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-text-muted">
                  No events matching this filter
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
