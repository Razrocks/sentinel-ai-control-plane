/**
 * Policies — active guardrails and policy-rule library.
 *
 * Phase 4 rebuild: shadcn Cards for layout, ring-bordered decision
 * chips, larger typography. Left list + right detail pane preserved.
 */
import { useState } from 'react'
import {
  Shield,
  ChevronRight,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Zap,
  FileText,
  ArrowUpRight,
} from 'lucide-react'
import { usePolicies, useAuditEvents } from '@/hooks/useData'
import { timeAgo, cn } from '@/lib/utils'
import { useRole } from '@/lib/roles'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'

// Enriched policy metadata (mock).
const policyMeta: Record<
  string,
  {
    triggerConditions: string[]
    affectedActions: string[]
    exampleOutcome: string
    owner: string
    lastModified: string
    workflowStage: string
  }
> = {
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

function decisionBadge(decision: string) {
  if (decision === 'deny') return { variant: 'danger' as const, label: 'Deny' }
  if (decision === 'escalate') return { variant: 'warning' as const, label: 'Escalate' }
  if (decision === 'simulate_only') return { variant: 'secondary' as const, label: 'Simulate' }
  return { variant: 'success' as const, label: 'Allow' }
}

export default function Policies() {
  const [selectedRule, setSelectedRule] = useState<string | null>(null)
  const { role: _role } = useRole()
  const { data: policyRules = [], isLoading: loadingPolicies } = usePolicies()
  const { data: auditEvents = [] } = useAuditEvents()
  const activeRules = policyRules.filter((r) => r.isActive)

  const selected = policyRules.find((r) => r.id === selectedRule)
  const meta = selected ? policyMeta[selected.id] : null
  const linkedEvents = selected
    ? auditEvents.filter((e) => e.policyRule === selected.name).slice(0, 3)
    : []

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-3xl font-semibold text-foreground tracking-tight">Policies</h1>
        <p className="text-base text-muted-foreground mt-2">
          Active guardrails and policy rules
        </p>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatTile label="Active Rules" value={activeRules.length} color="text-foreground" />
        <StatTile
          label="Hard Blocks"
          value={policyRules.filter((r) => r.decision === 'deny').length}
          color="text-risk-critical"
        />
        <StatTile
          label="Escalation Rules"
          value={policyRules.filter((r) => r.decision === 'escalate').length}
          color="text-status-escalated"
        />
        <StatTile
          label="Simulate Only"
          value={policyRules.filter((r) => r.decision === 'simulate_only').length}
          color="text-status-simulated"
        />
      </div>

      {loadingPolicies ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_460px] gap-6">
          {/* Rules list */}
          <Card>
            <CardHeader className="py-4 border-b border-border">
              <CardTitle className="text-base">Policy Rules</CardTitle>
            </CardHeader>
            <CardContent className="p-0 divide-y divide-border">
              {policyRules.map((rule) => {
                const b = decisionBadge(rule.decision)
                const isSelected = selectedRule === rule.id
                return (
                  <button
                    key={rule.id}
                    onClick={() => setSelectedRule(rule.id)}
                    className={cn(
                      'w-full flex items-center justify-between px-5 py-4 text-left transition-colors',
                      isSelected
                        ? 'bg-secondary'
                        : 'hover:bg-secondary/50',
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={cn(
                          'flex h-9 w-9 items-center justify-center rounded-md flex-shrink-0',
                          rule.isActive
                            ? 'bg-primary/15 text-primary'
                            : 'bg-secondary text-muted-foreground',
                        )}
                      >
                        <Shield className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-foreground font-mono">
                          {rule.name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {rule.bundle} · {rule.scope}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={b.variant}>{b.label}</Badge>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </button>
                )
              })}
            </CardContent>
          </Card>

          {/* Detail panel */}
          <div>
            {selected ? (
              <Card className="sticky top-24">
                <CardContent className="p-6 space-y-5">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-base font-mono font-semibold text-foreground">
                      {selected.name}
                    </h3>
                    <span
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold ring-1',
                        selected.isActive
                          ? 'bg-status-approved/15 text-status-approved ring-status-approved/30'
                          : 'bg-secondary text-muted-foreground ring-border',
                      )}
                    >
                      {selected.isActive ? (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5" />
                      )}
                      {selected.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>

                  <p className="text-sm text-foreground/85 leading-relaxed">
                    {selected.description}
                  </p>

                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <Field label="Decision">
                      {(() => {
                        const b = decisionBadge(selected.decision)
                        return <Badge variant={b.variant}>{b.label}</Badge>
                      })()}
                    </Field>
                    <Field label="Bundle">
                      <span className="text-foreground">{selected.bundle}</span>
                    </Field>
                    <Field label="Scope">
                      <span className="text-foreground">{selected.scope}</span>
                    </Field>
                    <Field label="Applies To">
                      <div className="flex flex-wrap gap-1">
                        {selected.appliesTo.map((s) => (
                          <code
                            key={s}
                            className="text-xs bg-secondary px-2 py-0.5 rounded text-foreground"
                          >
                            {s}
                          </code>
                        ))}
                      </div>
                    </Field>
                  </div>

                  {meta && (
                    <>
                      <Separator />
                      <SectionList
                        icon={<Zap className="h-3.5 w-3.5" />}
                        label="Trigger Conditions"
                        items={meta.triggerConditions}
                        dotColor="bg-primary"
                      />
                      <SectionList
                        icon={<AlertTriangle className="h-3.5 w-3.5" />}
                        label="Affected Actions"
                        items={meta.affectedActions}
                        dotColor={
                          selected.decision === 'deny'
                            ? 'bg-risk-critical'
                            : selected.decision === 'escalate'
                              ? 'bg-status-escalated'
                              : 'bg-status-approved'
                        }
                      />

                      <div className="rounded-md bg-secondary p-3 space-y-1">
                        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          <FileText className="h-3 w-3" /> Example Outcome
                        </div>
                        <p className="text-sm text-foreground/85 leading-relaxed">
                          {meta.exampleOutcome}
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <Field label="Owner">
                          <span className="text-foreground">{meta.owner}</span>
                        </Field>
                        <Field label="Last Modified">
                          <span className="text-muted-foreground">{timeAgo(meta.lastModified)}</span>
                        </Field>
                      </div>

                      <div className="rounded-md border border-primary/30 bg-primary/10 p-3 space-y-1">
                        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
                          <ArrowUpRight className="h-3 w-3" /> Workflow Stage
                        </div>
                        <p className="text-sm text-primary">{meta.workflowStage}</p>
                      </div>
                    </>
                  )}

                  {linkedEvents.length > 0 && (
                    <>
                      <Separator />
                      <div>
                        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                          <Clock className="h-3 w-3" /> Recent Activity ({linkedEvents.length})
                        </div>
                        <div className="space-y-2">
                          {linkedEvents.map((event) => {
                            const v =
                              event.result === 'blocked' || event.result === 'denied'
                                ? 'danger'
                                : event.result === 'escalated'
                                  ? 'warning'
                                  : 'success'
                            return (
                              <div
                                key={event.id}
                                className="flex items-center gap-2 text-sm"
                              >
                                <Badge variant={v as 'danger' | 'warning' | 'success'}>
                                  {event.result}
                                </Badge>
                                <span className="text-foreground truncate">
                                  {event.objectTitle}
                                </span>
                                <span className="text-muted-foreground text-xs ml-auto flex-shrink-0">
                                  {timeAgo(event.timestamp)}
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    </>
                  )}

                  <div className="rounded-md bg-secondary p-3">
                    <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                      What this means
                    </div>
                    <div className="text-sm text-foreground/85 leading-relaxed">
                      {selected.decision === 'deny' &&
                        'This action is hard-blocked. It cannot be executed under any circumstances without policy change.'}
                      {selected.decision === 'escalate' &&
                        'This action requires human escalation and approval before it can proceed.'}
                      {selected.decision === 'simulate_only' &&
                        'This action can only be simulated. Production execution is not permitted.'}
                      {selected.decision === 'allow' &&
                        'This action is permitted under the current policy when all other conditions are met.'}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-16">
                  <div className="rounded-full bg-secondary p-4 mb-4">
                    <Shield className="h-7 w-7 text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Select a policy rule to view details
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function StatTile({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className={cn('text-3xl font-semibold tabular-nums', color)}>{value}</div>
        <div className="text-sm text-muted-foreground mt-1">{label}</div>
      </CardContent>
    </Card>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
        {label}
      </div>
      {children}
    </div>
  )
}

function SectionList({
  icon,
  label,
  items,
  dotColor,
}: {
  icon: React.ReactNode
  label: string
  items: string[]
  dotColor: string
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        {icon} {label}
      </div>
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="text-sm text-foreground/85 flex items-start gap-2">
            <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5', dotColor)} />
            {item}
          </li>
        ))}
      </ul>
    </div>
  )
}
