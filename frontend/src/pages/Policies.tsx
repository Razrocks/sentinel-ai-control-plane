import { useState } from 'react'
import { Shield, ChevronRight, CheckCircle, XCircle, AlertTriangle, Clock, Zap, FileText, ArrowUpRight } from 'lucide-react'
import { usePolicies, useAuditEvents } from '@/hooks/useData'
import { PolicyBadge } from '@/components/shared'
import { timeAgo } from '@/lib/utils'
import { useRole } from '@/lib/roles'

// Enriched policy metadata — trigger conditions, affected actions, example outcomes, owner, last modified
const policyMeta: Record<string, {
  triggerConditions: string[]
  affectedActions: string[]
  exampleOutcome: string
  owner: string
  lastModified: string
  workflowStage: string
}> = {
  'pol-001': {
    triggerConditions: ['Risk score = LOW', 'CI status = passing', 'Rollback plan exists'],
    affectedActions: ['Auto-approve change', 'Skip manual review'],
    exampleOutcome: 'Config bump CHG-2024-0847 was auto-approved in 2 min with no human gate.',
    owner: 'platform-eng',
    lastModified: '2026-02-15T10:00:00Z',
    workflowStage: 'Policy evaluation → auto-approve gate',
  },
  'pol-002': {
    triggerConditions: ['DDL migration detected', 'Target table tier = critical', 'Blast radius > 3 services'],
    affectedActions: ['Block direct execution', 'Require SRE + Data Platform approval', 'Force maintenance window'],
    exampleOutcome: 'CHG-2024-0851 schema migration was escalated, requiring 3 co-approvals before scheduling.',
    owner: 'data-platform',
    lastModified: '2026-01-22T14:30:00Z',
    workflowStage: 'Policy evaluation → escalation gate',
  },
  'pol-003': {
    triggerConditions: ['Environment = production', 'Action type = apply/execute', 'Approvals incomplete'],
    affectedActions: ['Block production writes', 'Force simulate_only mode', 'Require all approvals'],
    exampleOutcome: 'CHG-2024-0851 was restricted to simulate_only until SRE and Data Platform signed off.',
    owner: 'sre-team',
    lastModified: '2026-03-01T09:00:00Z',
    workflowStage: 'Execution gate → before production apply',
  },
  'pol-004': {
    triggerConditions: ['Access target = production system', 'Role level = elevated', 'Single approval insufficient'],
    affectedActions: ['Require manager approval', 'Require system owner approval', 'Block auto-grant'],
    exampleOutcome: 'ACC-2024-0394 required both rachel.nguyen (manager) and marcus.riley (owner) before grant.',
    owner: 'security-team',
    lastModified: '2026-02-28T11:00:00Z',
    workflowStage: 'Access request → dual approval chain',
  },
  'pol-005': {
    triggerConditions: ['Incident pattern matches KB', 'Fix type = config-only', 'No code deployment needed'],
    affectedActions: ['Auto-propose remediation', 'Pre-fill execution plan', 'Still require human approval'],
    exampleOutcome: 'INC-2024-1205 pool exhaustion auto-proposed HikariCP config fix. Human approved in 5 min.',
    owner: 'sre-team',
    lastModified: '2026-03-10T16:00:00Z',
    workflowStage: 'Incident triage → remediation proposal',
  },
  'pol-006': {
    triggerConditions: ['Requester HR org ≠ target system org', 'Team transfer not finalized'],
    affectedActions: ['Deny access request', 'Notify requester with HR action needed'],
    exampleOutcome: 'ACC-2024-0389 denied — lisa.patel still listed under QA, not Engineering.',
    owner: 'security-team',
    lastModified: '2026-01-10T08:00:00Z',
    workflowStage: 'Access request → eligibility check',
  },
  'pol-007': {
    triggerConditions: ['Risk level = high or critical', 'No maintenance window scheduled', 'Environment = production'],
    affectedActions: ['Block execution', 'Require maintenance window selection', 'Notify change owner'],
    exampleOutcome: 'High-risk changes blocked unless scheduled within approved maintenance window.',
    owner: 'platform-eng',
    lastModified: '2026-02-20T13:00:00Z',
    workflowStage: 'Execution gate → maintenance window check',
  },
  'pol-008': {
    triggerConditions: ['Active SEV1/SEV2 incident', 'Access request linked to incident', 'Manager approval present'],
    affectedActions: ['Allow time-boxed access (4h)', 'Enable full audit + session recording', 'Auto-revoke at expiry'],
    exampleOutcome: 'ACC-2024-0396 granted kevin.lee 4h break-glass PowerUserAccess for INC-2024-1205.',
    owner: 'security-team',
    lastModified: '2026-03-05T10:00:00Z',
    workflowStage: 'Access request → break-glass gate',
  },
}

export default function Policies() {
  const [selectedRule, setSelectedRule] = useState<string | null>(null)
  const { role } = useRole()
  const { data: policyRules = [], isLoading: loadingPolicies } = usePolicies()
  const { data: auditEvents = [], isLoading: loadingAudit } = useAuditEvents()
  const activeRules = policyRules.filter(r => r.isActive)
  const isAdmin = role === 'admin'

  if (loadingPolicies) {
    return <div className="text-text-secondary p-8 text-center">Loading policies...</div>
  }

  const selected = policyRules.find(r => r.id === selectedRule)
  const meta = selected ? policyMeta[selected.id] : null

  // Find audit events linked to this policy
  const linkedEvents = selected
    ? auditEvents.filter(e => e.policyRule === selected.name).slice(0, 3)
    : []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-text-primary">Policies</h1>
        <p className="text-text-secondary mt-1">Active guardrails and policy rules</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-surface rounded-lg border border-border p-4">
          <div className="text-2xl font-semibold text-text-primary">{activeRules.length}</div>
          <div className="text-sm text-text-secondary">Active Rules</div>
        </div>
        <div className="bg-surface rounded-lg border border-border p-4">
          <div className="text-2xl font-semibold text-risk-critical">{policyRules.filter(r => r.decision === 'deny').length}</div>
          <div className="text-sm text-text-secondary">Hard Blocks</div>
        </div>
        <div className="bg-surface rounded-lg border border-border p-4">
          <div className="text-2xl font-semibold text-status-escalated">{policyRules.filter(r => r.decision === 'escalate').length}</div>
          <div className="text-sm text-text-secondary">Escalation Rules</div>
        </div>
        <div className="bg-surface rounded-lg border border-border p-4">
          <div className="text-2xl font-semibold text-status-simulated">{policyRules.filter(r => r.decision === 'simulate_only').length}</div>
          <div className="text-sm text-text-secondary">Simulate Only</div>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_420px] gap-5">
        {/* Rules list */}
        <div>
          <div className="bg-surface rounded-lg border border-border overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="text-sm font-medium text-text-primary">Policy Rules</h2>
            </div>
            <div className="divide-y divide-border">
              {policyRules.map(rule => (
                <button
                  key={rule.id}
                  onClick={() => setSelectedRule(rule.id)}
                  className={`w-full flex items-center justify-between px-4 py-3 text-left hover:bg-surface-raised transition-colors ${selectedRule === rule.id ? 'bg-surface-raised' : ''}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Shield className={`w-4 h-4 flex-shrink-0 ${rule.isActive ? 'text-accent' : 'text-text-muted'}`} />
                    <div className="min-w-0">
                      <div className="text-sm text-text-primary font-medium">{rule.name}</div>
                      <div className="text-xs text-text-muted">{rule.bundle} · {rule.scope}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <PolicyBadge decision={rule.decision} />
                    <ChevronRight className="w-4 h-4 text-text-muted" />
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Rule detail */}
        <div>
          {selected ? (
            <div className="bg-surface rounded-lg border border-border p-4 space-y-4 sticky top-20">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-text-primary font-mono">{selected.name}</h3>
                <div className={`flex items-center gap-1.5 text-xs ${selected.isActive ? 'text-status-approved' : 'text-text-muted'}`}>
                  {selected.isActive ? <CheckCircle className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                  {selected.isActive ? 'Active' : 'Inactive'}
                </div>
              </div>
              <p className="text-sm text-text-secondary leading-relaxed">{selected.description}</p>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] text-text-muted uppercase tracking-wider mb-1">Decision</div>
                  <PolicyBadge decision={selected.decision} />
                </div>
                <div>
                  <div className="text-[10px] text-text-muted uppercase tracking-wider mb-1">Bundle</div>
                  <div className="text-sm text-text-primary">{selected.bundle}</div>
                </div>
                <div>
                  <div className="text-[10px] text-text-muted uppercase tracking-wider mb-1">Scope</div>
                  <div className="text-sm text-text-primary">{selected.scope}</div>
                </div>
                <div>
                  <div className="text-[10px] text-text-muted uppercase tracking-wider mb-1">Applies To</div>
                  <div className="flex flex-wrap gap-1">
                    {selected.appliesTo.map(s => (
                      <span key={s} className="text-xs font-mono bg-surface-raised px-1.5 py-0.5 rounded text-text-secondary">{s}</span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Enriched details — trigger conditions, affected actions, example */}
              {meta && (
                <>
                  <div className="border-t border-border pt-3">
                    <div className="text-[10px] text-text-muted uppercase tracking-wider mb-2 flex items-center gap-1">
                      <Zap className="w-3 h-3" /> Trigger Conditions
                    </div>
                    <ul className="space-y-1">
                      {meta.triggerConditions.map((tc, i) => (
                        <li key={i} className="text-xs text-text-secondary flex items-center gap-1.5">
                          <span className="w-1 h-1 rounded-full bg-accent flex-shrink-0" />
                          {tc}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="border-t border-border pt-3">
                    <div className="text-[10px] text-text-muted uppercase tracking-wider mb-2 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> Affected Actions
                    </div>
                    <ul className="space-y-1">
                      {meta.affectedActions.map((aa, i) => (
                        <li key={i} className="text-xs text-text-secondary flex items-center gap-1.5">
                          <span className={`w-1 h-1 rounded-full flex-shrink-0 ${
                            selected.decision === 'deny' ? 'bg-risk-critical' : selected.decision === 'escalate' ? 'bg-status-escalated' : 'bg-status-approved'
                          }`} />
                          {aa}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="bg-surface-raised rounded p-3">
                    <div className="text-[10px] text-text-muted uppercase tracking-wider mb-1 flex items-center gap-1">
                      <FileText className="w-3 h-3" /> Example Outcome
                    </div>
                    <p className="text-xs text-text-secondary leading-relaxed">{meta.exampleOutcome}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <div className="text-[10px] text-text-muted uppercase tracking-wider mb-1">Owner</div>
                      <div className="text-text-primary">{meta.owner}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-text-muted uppercase tracking-wider mb-1">Last Modified</div>
                      <div className="text-text-secondary">{timeAgo(meta.lastModified)}</div>
                    </div>
                  </div>

                  <div className="bg-accent/5 border border-accent/20 rounded p-2.5">
                    <div className="text-[10px] text-accent uppercase tracking-wider mb-1 flex items-center gap-1">
                      <ArrowUpRight className="w-3 h-3" /> Workflow Stage
                    </div>
                    <p className="text-xs text-accent">{meta.workflowStage}</p>
                  </div>
                </>
              )}

              {/* Linked audit events */}
              {linkedEvents.length > 0 && (
                <div className="border-t border-border pt-3">
                  <div className="text-[10px] text-text-muted uppercase tracking-wider mb-2 flex items-center gap-1">
                    <Clock className="w-3 h-3" /> Recent Activity ({linkedEvents.length})
                  </div>
                  <div className="space-y-1.5">
                    {linkedEvents.map(event => (
                      <div key={event.id} className="flex items-center gap-2 text-xs">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          event.result === 'blocked' ? 'bg-risk-critical/10 text-risk-critical'
                            : event.result === 'escalated' ? 'bg-status-escalated/10 text-status-escalated'
                            : event.result === 'denied' ? 'bg-risk-critical/10 text-risk-critical'
                            : 'bg-status-approved/10 text-status-approved'
                        }`}>{event.result}</span>
                        <span className="text-text-secondary truncate">{event.objectTitle}</span>
                        <span className="text-text-muted ml-auto flex-shrink-0">{timeAgo(event.timestamp)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* What this means */}
              <div className="bg-surface-raised rounded p-3">
                <div className="text-xs text-text-muted mb-1">What this means</div>
                <div className="text-sm text-text-secondary">
                  {selected.decision === 'deny' && 'This action is hard-blocked. It cannot be executed under any circumstances without policy change.'}
                  {selected.decision === 'escalate' && 'This action requires human escalation and approval before it can proceed.'}
                  {selected.decision === 'simulate_only' && 'This action can only be simulated. Production execution is not permitted.'}
                  {selected.decision === 'allow' && 'This action is permitted under the current policy when all other conditions are met.'}
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-surface rounded-lg border border-border p-8 text-center">
              <Shield className="w-8 h-8 text-text-muted mx-auto mb-2" />
              <p className="text-sm text-text-muted">Select a policy rule to view details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
