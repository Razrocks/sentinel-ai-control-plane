import { useState } from 'react'
import {
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  ArrowUpRight,
  ShieldAlert,
  Ban,
  Send,
  MessageSquare,
  Lock,
  FileCheck,
  Users,
  Info,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { useApprovals } from '@/hooks/useData'
import { useApprovalDecision } from '@/hooks/useMutations'
import { RiskBadge, PolicyBadge, ActionGuardModal } from '@/components/shared'
import { timeAgo } from '@/lib/utils'
import { useRole } from '@/lib/roles'
import type { Approval } from '@/types'

type FilterType = 'all' | 'change' | 'access' | 'remediation' | 'escalation'

const typeLabels: Record<string, string> = {
  change: 'Change',
  access: 'Access',
  remediation: 'Remediation',
  escalation: 'Escalation',
}

const typeColors: Record<string, string> = {
  change: 'bg-accent/10 text-accent',
  access: 'bg-status-draft/10 text-status-draft',
  remediation: 'bg-status-approved/10 text-status-approved',
  escalation: 'bg-status-escalated/10 text-status-escalated',
}

function getUrgency(approval: Approval): { label: string; color: string; border: string } {
  if (approval.riskLevel === 'critical') return { label: 'Urgent', color: 'text-risk-critical bg-risk-critical/10', border: 'border-l-risk-critical' }
  if (approval.riskLevel === 'high') return { label: 'High priority', color: 'text-risk-high bg-risk-high/10', border: 'border-l-risk-high' }
  if (approval.type === 'escalation') return { label: 'Escalated', color: 'text-status-escalated bg-status-escalated/10', border: 'border-l-status-escalated' }
  return { label: 'Normal', color: 'text-text-muted bg-surface-raised', border: 'border-l-status-pending' }
}

export default function Approvals() {
  const { data: approvals = [], isLoading } = useApprovals()
  const [filter, setFilter] = useState<FilterType>('all')
  const approvalDecision = useApprovalDecision()

  const [guardModal, setGuardModal] = useState<{ action: string; label: string; reason: string } | null>(null)
  const [conditionModal, setConditionModal] = useState<string | null>(null)
  const [conditionText, setConditionText] = useState('')
  const [expandedImpact, setExpandedImpact] = useState<string | null>(null)
  const { role, canAction, getActionPermission } = useRole()

  const isApproverRole = role === 'approver' || role === 'access_approver' || role === 'admin'

  const filtered = filter === 'all' ? approvals : approvals.filter(a => a.type === filter)
  const pending = filtered.filter(a => a.status === 'pending')
  const resolved = filtered.filter(a => a.status !== 'pending')
  const pendingCount = approvals.filter(a => a.status === 'pending').length

  const handleApprove = (id: string) => {
    const perm = getActionPermission('approve', 'Approve')
    if (!perm.allowed) {
      setGuardModal({ action: 'approve', label: 'Approve', reason: perm.reason || 'Not permitted' })
      return
    }
    approvalDecision.mutate({ id, decision: 'approved' })
  }

  const handleApproveWithCondition = (id: string) => {
    const perm = getActionPermission('approve', 'Approve with Condition')
    if (!perm.allowed) {
      setGuardModal({ action: 'approve', label: 'Approve with Condition', reason: perm.reason || 'Not permitted' })
      return
    }
    setConditionModal(id)
    setConditionText('')
  }

  const confirmCondition = () => {
    if (!conditionModal || !conditionText.trim()) return
    approvalDecision.mutate({
      id: conditionModal,
      decision: 'approved_with_condition',
      condition: conditionText.trim(),
    })
    setConditionModal(null)
    setConditionText('')
  }

  const handleDeny = (id: string) => {
    const perm = getActionPermission('deny', 'Deny')
    if (!perm.allowed) {
      setGuardModal({ action: 'deny', label: 'Deny', reason: perm.reason || 'Not permitted' })
      return
    }
    approvalDecision.mutate({ id, decision: 'denied' })
  }

  const filters: { id: FilterType; label: string; count: number }[] = [
    { id: 'all', label: 'All', count: approvals.filter(a => a.status === 'pending').length },
    { id: 'change', label: 'Changes', count: approvals.filter(a => a.type === 'change' && a.status === 'pending').length },
    { id: 'access', label: 'Access', count: approvals.filter(a => a.type === 'access' && a.status === 'pending').length },
    { id: 'remediation', label: 'Remediation', count: approvals.filter(a => a.type === 'remediation' && a.status === 'pending').length },
    { id: 'escalation', label: 'Escalation', count: approvals.filter(a => a.type === 'escalation' && a.status === 'pending').length },
  ]

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-text-muted">Loading approvals...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-text-primary">Approvals</h1>
        <p className="text-text-secondary mt-1">{pendingCount} pending approval{pendingCount !== 1 ? 's' : ''} requiring action</p>
      </div>

      {/* Filters with counts */}
      <div className="flex gap-2">
        {filters.map(f => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filter === f.id
                ? 'bg-accent text-white'
                : 'bg-surface text-text-secondary hover:text-text-primary hover:bg-surface-raised border border-border'
            }`}
          >
            {f.label}
            {f.count > 0 && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                filter === f.id ? 'bg-white/20' : 'bg-surface-raised'
              }`}>
                {f.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Pending approvals */}
      {pending.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted">Pending</h2>
          {pending.map(approval => {
            const urgency = getUrgency(approval)
            const isImpactExpanded = expandedImpact === approval.id
            return (
              <div key={approval.id} className={`bg-surface rounded-lg border border-border overflow-hidden border-l-2 ${urgency.border}`}>
                {/* Why you are required — approver only */}
                {isApproverRole && approval.whyYouAreRequired && (
                  <div className="px-4 py-2 bg-accent/5 border-b border-border flex items-center gap-2">
                    <Info className="w-3.5 h-3.5 text-accent flex-shrink-0" />
                    <span className="text-xs text-accent">{approval.whyYouAreRequired}</span>
                  </div>
                )}

                {/* Approval stage strip — access_approver gets extra clarity */}
                {isApproverRole && approval.coApprovals && (() => {
                  const approvedCount = approval.coApprovals.filter(c => c.status === 'approved').length
                  const totalCount = approval.coApprovals.length
                  const myEntry = approval.coApprovals.find(c => c.name === 'you')
                  const pendingOthers = approval.coApprovals.filter(c => c.status === 'pending' && c.name !== 'you')
                  const isMyTurnFinal = myEntry?.status === 'pending' && pendingOthers.length === 0
                  const isMyTurnIntermediate = myEntry?.status === 'pending' && pendingOthers.length > 0

                  return (
                    <div className={`px-4 py-1.5 border-b border-border flex items-center justify-between text-[11px] ${
                      isMyTurnFinal ? 'bg-status-approved/5' : isMyTurnIntermediate ? 'bg-status-pending/5' : 'bg-surface-raised/50'
                    }`}>
                      <div className="flex items-center gap-3">
                        <span className="text-text-muted">Stage: <span className="text-text-secondary font-medium">{approvedCount}/{totalCount} approved</span></span>
                        {myEntry && (
                          <span className={`font-medium ${
                            isMyTurnFinal ? 'text-status-approved' : isMyTurnIntermediate ? 'text-status-pending' : 'text-text-muted'
                          }`}>
                            {isMyTurnFinal ? '● Your decision is final' : isMyTurnIntermediate ? '● Your decision advances the chain' : '● Decided'}
                          </span>
                        )}
                      </div>
                      {pendingOthers.length > 0 && (
                        <span className="text-text-muted">
                          Also waiting: {pendingOthers.map(c => c.name).join(', ')}
                        </span>
                      )}
                    </div>
                  )
                })()}

                {/* Three-column card layout */}
                <div className="grid grid-cols-[1fr_1fr_260px] divide-x divide-border">
                  {/* Left: Request info + Co-approvals */}
                  <div className="p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded ${typeColors[approval.type] || 'bg-surface-raised text-text-muted'}`}>
                        {typeLabels[approval.type] || approval.type}
                      </span>
                      <RiskBadge level={approval.riskLevel} size="sm" />
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${urgency.color}`}>
                        {urgency.label}
                      </span>
                    </div>
                    <h3 className="text-sm font-medium text-text-primary">{approval.title}</h3>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-text-muted">Requester</span>
                        <p className="text-text-secondary">{approval.requester}</p>
                      </div>
                      <div>
                        <span className="text-text-muted">Submitted</span>
                        <p className="text-text-secondary">{timeAgo(approval.createdAt)}</p>
                      </div>
                    </div>

                    {/* Co-approvals */}
                    {approval.coApprovals && approval.coApprovals.length > 1 && (
                      <div className="pt-2 border-t border-border">
                        <div className="flex items-center gap-1.5 mb-2">
                          <Users className="w-3 h-3 text-text-muted" />
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Co-approvals</span>
                        </div>
                        <div className="space-y-1">
                          {approval.coApprovals.map((co, i) => (
                            <div key={i} className="flex items-center gap-2 text-xs">
                              {co.status === 'approved' ? (
                                <CheckCircle className="w-3 h-3 text-status-approved flex-shrink-0" />
                              ) : co.status === 'denied' ? (
                                <XCircle className="w-3 h-3 text-status-denied flex-shrink-0" />
                              ) : (
                                <Clock className="w-3 h-3 text-status-pending flex-shrink-0" />
                              )}
                              <span className={`${co.name === 'you' ? 'text-accent font-medium' : 'text-text-secondary'}`}>
                                {co.name === 'you' ? 'You' : co.name}
                              </span>
                              <span className="text-text-muted">·</span>
                              <span className="text-text-muted">{co.role}</span>
                              {co.decidedAt && (
                                <span className="text-text-muted ml-auto">{timeAgo(co.decidedAt)}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Center: Rationale + Recommendation + Decision Impact */}
                  <div className="p-4 space-y-3">
                    <div>
                      <div className="text-xs text-text-muted mb-1">Why approval is needed</div>
                      <p className="text-sm text-text-secondary">{approval.reason}</p>
                    </div>
                    <div className="bg-surface-raised rounded p-2.5">
                      <div className="text-xs text-text-muted mb-1">Recommended action</div>
                      <p className="text-sm text-text-primary">{approval.recommendedAction}</p>
                    </div>

                    {/* Decision Impact — expandable */}
                    {isApproverRole && approval.decisionImpact && (
                      <div className="border border-border rounded">
                        <button
                          onClick={() => setExpandedImpact(isImpactExpanded ? null : approval.id)}
                          className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-text-secondary hover:text-text-primary transition-colors"
                        >
                          <span className="flex items-center gap-1.5">
                            <AlertTriangle className="w-3 h-3" />
                            Decision Impact
                          </span>
                          {isImpactExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        </button>
                        {isImpactExpanded && (
                          <div className="px-3 pb-3 space-y-2">
                            <div className="flex gap-2">
                              <CheckCircle className="w-3 h-3 text-status-approved flex-shrink-0 mt-0.5" />
                              <div>
                                <div className="text-[10px] font-medium text-status-approved uppercase">If approved</div>
                                <p className="text-xs text-text-secondary">{approval.decisionImpact.approve}</p>
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <XCircle className="w-3 h-3 text-status-denied flex-shrink-0 mt-0.5" />
                              <div>
                                <div className="text-[10px] font-medium text-status-denied uppercase">If denied</div>
                                <p className="text-xs text-text-secondary">{approval.decisionImpact.deny}</p>
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <ArrowUpRight className="w-3 h-3 text-status-escalated flex-shrink-0 mt-0.5" />
                              <div>
                                <div className="text-[10px] font-medium text-status-escalated uppercase">If escalated</div>
                                <p className="text-xs text-text-secondary">{approval.decisionImpact.escalate}</p>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Right: Impacted system + Actions */}
                  <div className="p-4 space-y-3">
                    <div>
                      <div className="text-xs text-text-muted mb-1">Impacted system</div>
                      <div className="text-sm text-text-primary font-mono">{approval.impactedSystem}</div>
                    </div>

                    {/* Actions */}
                    <div className="space-y-1.5 pt-2 border-t border-border">
                      {canAction('approve') ? (
                        <>
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => handleApprove(approval.id)}
                              className="flex-1 flex items-center justify-center gap-1 rounded px-2 py-1.5 text-xs font-medium bg-status-approved/20 text-status-approved hover:bg-status-approved/30 transition-colors"
                            >
                              <CheckCircle className="h-3.5 w-3.5" />
                              Approve
                            </button>
                            <button
                              onClick={() => handleDeny(approval.id)}
                              className="flex-1 flex items-center justify-center gap-1 rounded px-2 py-1.5 text-xs font-medium bg-status-denied/20 text-status-denied hover:bg-status-denied/30 transition-colors"
                            >
                              <XCircle className="h-3.5 w-3.5" />
                              Deny
                            </button>
                          </div>
                          {/* Approve with Condition — first-class action for approvers */}
                          <button
                            onClick={() => handleApproveWithCondition(approval.id)}
                            className="w-full flex items-center justify-center gap-1 rounded px-2 py-1.5 text-xs font-medium bg-status-pending/20 text-status-pending hover:bg-status-pending/30 transition-colors"
                          >
                            <FileCheck className="h-3.5 w-3.5" />
                            Approve with Condition
                          </button>
                        </>
                      ) : (
                        <>
                          {/* Blocked approve/deny for operators */}
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => handleApprove(approval.id)}
                              className="flex-1 flex items-center justify-center gap-1 rounded px-2 py-1.5 text-xs font-medium bg-surface-raised text-text-muted cursor-not-allowed opacity-60"
                            >
                              <Lock className="h-3 w-3" />
                              Approve
                            </button>
                            <button
                              onClick={() => handleDeny(approval.id)}
                              className="flex-1 flex items-center justify-center gap-1 rounded px-2 py-1.5 text-xs font-medium bg-surface-raised text-text-muted cursor-not-allowed opacity-60"
                            >
                              <Lock className="h-3 w-3" />
                              Deny
                            </button>
                          </div>
                          <p className="text-[10px] text-text-muted leading-tight">Approval decisions require Approver role</p>
                        </>
                      )}

                      {/* Operator-available actions */}
                      {canAction('escalate') && (
                        <button className="w-full flex items-center justify-center gap-1 rounded px-2 py-1.5 text-xs font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-colors">
                          <ArrowUpRight className="h-3.5 w-3.5" />
                          Escalate
                        </button>
                      )}
                      {canAction('attach_notes') && (
                        <button className="w-full flex items-center justify-center gap-1 rounded px-2 py-1.5 text-xs font-medium bg-surface-raised text-text-secondary hover:bg-border transition-colors">
                          <MessageSquare className="h-3.5 w-3.5" />
                          Add Note
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Resolved approvals */}
      {resolved.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted">Resolved</h2>
          {resolved.map(approval => (
            <div key={approval.id} className="bg-surface rounded-lg border border-border overflow-hidden opacity-60">
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  {approval.status === 'approved' || approval.status === 'approved_with_condition' ? (
                    <CheckCircle className="w-4 h-4 text-status-approved flex-shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 text-status-denied flex-shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="text-sm text-text-primary truncate">{approval.title}</div>
                    <div className="text-xs text-text-muted">
                      {approval.requester} · {typeLabels[approval.type]} · {timeAgo(approval.createdAt)}
                      {approval.status === 'approved_with_condition' && approval.condition && (
                        <span className="ml-1 text-status-pending">· Condition: {approval.condition}</span>
                      )}
                    </div>
                  </div>
                </div>
                <span className={`text-xs font-medium px-2 py-0.5 rounded whitespace-nowrap ${
                  approval.status === 'approved'
                    ? 'bg-status-approved/10 text-status-approved'
                    : approval.status === 'approved_with_condition'
                    ? 'bg-status-pending/10 text-status-pending'
                    : 'bg-status-denied/10 text-status-denied'
                }`}>
                  {approval.status === 'approved' ? 'Approved'
                    : approval.status === 'approved_with_condition' ? 'Conditional'
                    : 'Denied'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {filtered.length === 0 && (
        <div className="bg-surface rounded-lg border border-border p-8 text-center">
          <Clock className="w-8 h-8 text-text-muted mx-auto mb-2" />
          <p className="text-text-muted">No approvals matching this filter</p>
        </div>
      )}

      {/* Condition Modal */}
      {conditionModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-surface border border-border rounded-lg shadow-xl w-full max-w-md mx-4">
            <div className="p-4 border-b border-border">
              <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                <FileCheck className="w-4 h-4 text-status-pending" />
                Approve with Condition
              </h3>
              <p className="text-xs text-text-muted mt-1">
                Specify the condition that must be met before this approval takes effect.
              </p>
            </div>
            <div className="p-4">
              <textarea
                value={conditionText}
                onChange={e => setConditionText(e.target.value)}
                placeholder="e.g., Execute only during scheduled maintenance window..."
                className="w-full bg-surface-raised border border-border rounded px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent resize-none"
                rows={3}
                autoFocus
              />
            </div>
            <div className="p-4 pt-0 flex gap-2 justify-end">
              <button
                onClick={() => setConditionModal(null)}
                className="px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary rounded bg-surface-raised hover:bg-border transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmCondition}
                disabled={!conditionText.trim()}
                className="px-3 py-1.5 text-xs font-medium rounded bg-status-pending/20 text-status-pending hover:bg-status-pending/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Confirm Conditional Approval
              </button>
            </div>
          </div>
        </div>
      )}

      {guardModal && (
        <ActionGuardModal
          isOpen={true}
          title={`${guardModal.label} Blocked`}
          description={guardModal.reason}
          confirmLabel="OK"
          onConfirm={() => setGuardModal(null)}
          onCancel={() => setGuardModal(null)}
          variant="warning"
        />
      )}
    </div>
  )
}
