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
  Search,
  Plus,
  Pencil,
  Trash2,
  Power,
  Tag,
  Lightbulb,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { usePolicies, useAuditEvents } from '@/hooks/useData'
import { timeAgo, cn } from '@/lib/utils'
import { useRole } from '@/lib/roles'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  useCreatePolicyRule,
  useUpdatePolicyRule,
  useDeletePolicyRule,
} from '@/hooks/useMutations'
import type { PolicyRule, PolicyRuleInput } from '@/types'
import { ActionGuardModal } from '@/components/shared'

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
  const [query, setQuery] = useState('')
  const { role } = useRole()
  const isAdmin = role === 'admin'
  const { data: policyRules = [], isLoading: loadingPolicies } = usePolicies()
  const { data: auditEvents = [] } = useAuditEvents()
  const activeRules = policyRules.filter((r) => r.isActive)

  const createRule = useCreatePolicyRule()
  const updateRule = useUpdatePolicyRule()
  const deleteRule = useDeletePolicyRule()

  // Form state for create/edit dialog. `mode === 'edit'` carries the rule
  // id + version so PATCH can do optimistic concurrency.
  const [dialogMode, setDialogMode] = useState<
    { type: 'closed' } | { type: 'create' } | { type: 'edit'; rule: PolicyRule }
  >({ type: 'closed' })
  const [deleteConfirm, setDeleteConfirm] = useState<PolicyRule | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)

  const selected = policyRules.find((r) => r.id === selectedRule)
  const meta = selected ? policyMeta[selected.id] : null
  const linkedEvents = selected
    ? auditEvents.filter((e) => e.policyRule === selected.name).slice(0, 3)
    : []

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-3">
          <h1 className="font-heading text-3xl font-medium tracking-tight text-foreground">
            Policies
          </h1>
          <p className="text-sm text-muted-foreground">
            Active guardrails and policy rules. Changes apply to agent context on the
            next skill invocation.
          </p>
        </div>
        {isAdmin && (
          <Button
            size="lg"
            onClick={() => {
              setMutationError(null)
              setDialogMode({ type: 'create' })
            }}
          >
            <Plus />
            New rule
          </Button>
        )}
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
            <CardHeader className="px-5 py-4 border-b border-border flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Policy Rules</CardTitle>
              <div className="relative w-64">
                <Search
                  className="pointer-events-none absolute top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
                  style={{ left: '0.75rem' }}
                />
                <Input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filter rules..."
                  style={{ height: '2.25rem', paddingLeft: '2.25rem', paddingRight: '0.75rem' }}
                />
              </div>
            </CardHeader>
            <CardContent className="p-0 divide-y divide-border">
              {policyRules.filter((rule) => {
                const q = query.trim().toLowerCase()
                if (!q) return true
                return (
                  rule.name.toLowerCase().includes(q) ||
                  rule.bundle.toLowerCase().includes(q) ||
                  rule.scope.toLowerCase().includes(q) ||
                  rule.description.toLowerCase().includes(q)
                )
              }).map((rule) => {
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

                  {isAdmin && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setMutationError(null)
                          setDialogMode({ type: 'edit', rule: selected })
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={updateRule.isPending}
                        onClick={() => {
                          updateRule.mutate({
                            id: selected.id,
                            isActive: !selected.isActive,
                            expectedVersion: selected.version,
                          })
                        }}
                      >
                        <Power className="h-3.5 w-3.5" />
                        {selected.isActive ? 'Disable' : 'Enable'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="ml-auto text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => setDeleteConfirm(selected)}
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </Button>
                    </div>
                  )}

                  {selected.rationale && (
                    <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-1">
                      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
                        <Lightbulb className="h-3 w-3" /> Rationale
                      </div>
                      <p className="text-sm text-foreground/85 leading-relaxed">
                        {selected.rationale}
                      </p>
                    </div>
                  )}

                  {selected.tags && selected.tags.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Tag className="h-3 w-3 text-muted-foreground" />
                      {selected.tags.map((t) => (
                        <Badge key={t} variant="secondary" className="text-xs">
                          {t}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {selected.examples && selected.examples.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Examples
                      </div>
                      <ul className="flex flex-col gap-1.5">
                        {selected.examples.map((ex, i) => (
                          <li
                            key={i}
                            className="flex items-start gap-2 rounded-md bg-secondary px-3 py-2 text-sm text-foreground/85 leading-relaxed"
                          >
                            <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-primary flex-shrink-0" />
                            <span>{ex}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

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

      {/* Create/Edit dialog */}
      <PolicyRuleDialog
        mode={dialogMode}
        onClose={() => {
          setDialogMode({ type: 'closed' })
          setMutationError(null)
        }}
        onSubmit={(input) => {
          setMutationError(null)
          if (dialogMode.type === 'create') {
            createRule.mutate(input, {
              onSuccess: () => setDialogMode({ type: 'closed' }),
              onError: (err) => setMutationError(err.message),
            })
          } else if (dialogMode.type === 'edit') {
            updateRule.mutate(
              { id: dialogMode.rule.id, ...input, expectedVersion: dialogMode.rule.version },
              {
                onSuccess: () => setDialogMode({ type: 'closed' }),
                onError: (err) => setMutationError(err.message),
              },
            )
          }
        }}
        error={mutationError}
        isPending={createRule.isPending || updateRule.isPending}
      />

      {/* Delete confirmation */}
      {deleteConfirm && (
        <ActionGuardModal
          isOpen
          title={`Disable policy rule: ${deleteConfirm.name}?`}
          description={`This soft-disables the rule (isActive=false). Agents will stop receiving it on the next skill invocation. The audit history is preserved. To hard-delete, use the API directly.`}
          confirmLabel="Disable rule"
          variant="warning"
          onConfirm={() => {
            deleteRule.mutate(
              { id: deleteConfirm.id, hard: false },
              { onSuccess: () => setDeleteConfirm(null) },
            )
          }}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}
    </div>
  )
}

// ─── Create/Edit Dialog ─────────────────────────────────

interface DialogProps {
  mode:
    | { type: 'closed' }
    | { type: 'create' }
    | { type: 'edit'; rule: PolicyRule }
  onClose: () => void
  onSubmit: (input: PolicyRuleInput) => void
  error: string | null
  isPending: boolean
}

function PolicyRuleDialog({ mode, onClose, onSubmit, error, isPending }: DialogProps) {
  const open = mode.type !== 'closed'
  const editing = mode.type === 'edit' ? mode.rule : null

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [bundle, setBundle] = useState('')
  const [decision, setDecision] = useState<'allow' | 'deny' | 'escalate' | 'simulate_only'>('allow')
  const [scope, setScope] = useState('')
  const [appliesToText, setAppliesToText] = useState('')
  const [rationale, setRationale] = useState('')
  const [examplesText, setExamplesText] = useState('')
  const [tagsText, setTagsText] = useState('')
  const [isActive, setIsActive] = useState(true)

  // Hydrate form when dialog opens or switches mode.
  // Using a key on the dialog could replace this — but plain hydration on
  // open avoids remount flicker for the modal.
  const hydrateKey = `${mode.type}:${editing?.id ?? 'new'}`
  const [lastKey, setLastKey] = useState<string>('')
  if (open && hydrateKey !== lastKey) {
    setLastKey(hydrateKey)
    setName(editing?.name ?? '')
    setDescription(editing?.description ?? '')
    setBundle(editing?.bundle ?? '')
    setDecision((editing?.decision as 'allow' | 'deny' | 'escalate' | 'simulate_only') ?? 'allow')
    setScope(editing?.scope ?? '')
    setAppliesToText((editing?.appliesTo ?? []).join('\n'))
    setRationale(editing?.rationale ?? '')
    setExamplesText((editing?.examples ?? []).join('\n'))
    setTagsText((editing?.tags ?? []).join(', '))
    setIsActive(editing?.isActive ?? true)
  }

  const handleSubmit = () => {
    const appliesTo = appliesToText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    const examples = examplesText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    const tags = tagsText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    onSubmit({
      name: name.trim(),
      description: description.trim(),
      bundle: bundle.trim(),
      decision,
      scope: scope.trim(),
      appliesTo,
      isActive,
      rationale: rationale.trim() || null,
      examples,
      tags,
    })
  }

  const valid =
    name.trim() &&
    description.trim() &&
    bundle.trim() &&
    scope.trim()

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <DialogContent
        className="w-[95vw] max-h-[92vh] overflow-y-auto p-0 sm:max-w-none"
        style={{ width: 'min(1100px, 95vw)' }}
      >
        <DialogHeader
          className="border-b border-border"
          style={{ padding: '1.75rem 2.5rem 1rem 2.5rem' }}
        >
          <DialogTitle className="flex items-center gap-2.5 text-lg">
            <Shield className="h-5 w-5 text-primary" />
            {editing ? 'Edit policy rule' : 'New policy rule'}
          </DialogTitle>
          <DialogDescription className="text-sm">
            {editing
              ? 'Update the rule. Agents pick up changes on the next skill invocation.'
              : 'Define a new policy rule. Active rules feed into agent context immediately.'}
          </DialogDescription>
        </DialogHeader>

        <div
          className="flex flex-col gap-7"
          style={{ padding: '1.75rem 2.5rem' }}
        >
          {/* Identity block */}
          <Section title="Identity" subtitle="How this rule is referenced in audit + agent prompts.">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <FormField label="Name" htmlFor="rule-name" hint={editing ? 'Immutable identifier.' : 'Snake_case identifier. Cannot be changed later.'}>
                <Input
                  id="rule-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="auto_approve_low_risk"
                  disabled={!!editing}
                  className="h-11"
                />
              </FormField>
              <FormField label="Bundle" htmlFor="rule-bundle" hint="Logical grouping (eg `default`, `prod-strict`).">
                <Input
                  id="rule-bundle"
                  value={bundle}
                  onChange={(e) => setBundle(e.target.value)}
                  placeholder="default"
                  className="h-11"
                />
              </FormField>
            </div>
          </Section>

          {/* Behavior block */}
          <Section title="Behavior" subtitle="What the rule does + where it applies.">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <FormField label="Decision" htmlFor="rule-decision" hint="The verdict when this rule matches.">
                <Select
                  value={decision}
                  onValueChange={(v) =>
                    setDecision(v as 'allow' | 'deny' | 'escalate' | 'simulate_only')
                  }
                >
                  <SelectTrigger id="rule-decision" className="w-full h-11 [&[data-size=default]]:h-11" data-size="default">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="allow">allow</SelectItem>
                    <SelectItem value="deny">deny</SelectItem>
                    <SelectItem value="escalate">escalate</SelectItem>
                    <SelectItem value="simulate_only">simulate_only</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="Scope" htmlFor="rule-scope" hint="Entity type the rule applies to.">
                <Input
                  id="rule-scope"
                  value={scope}
                  onChange={(e) => setScope(e.target.value)}
                  placeholder="changes / access / incidents / global"
                  className="h-11"
                />
              </FormField>
            </div>

            <FormField label="Description" htmlFor="rule-desc" hint="Short statement of what the rule enforces. Shown to agents + humans.">
              <Textarea
                id="rule-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this rule enforce?"
                rows={3}
                className="min-h-[80px] text-sm"
              />
            </FormField>

            <FormField
              label="Applies to"
              htmlFor="rule-applies"
              hint="One target per line. Agents match candidate work against these."
            >
              <Textarea
                id="rule-applies"
                value={appliesToText}
                onChange={(e) => setAppliesToText(e.target.value)}
                placeholder={'service:payment\nservice:orders\nenvironment:production'}
                rows={4}
                className="min-h-[110px] font-mono text-xs"
              />
            </FormField>
          </Section>

          {/* Agent context block */}
          <Section
            title="Agent context"
            subtitle="Free-form prose fed verbatim to skill prompts. Helps agents reason about WHY a rule exists, not just what it forbids."
          >
            <FormField
              label="Rationale"
              htmlFor="rule-rationale"
              hint="Why does this rule exist? Agents quote this when explaining enforcement to humans."
            >
              <Textarea
                id="rule-rationale"
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
                placeholder="We've had 3 weekend incidents from Friday deploys in last quarter. Rule prevents repeat exposure during low-staffed windows."
                rows={4}
                className="min-h-[110px] text-sm"
              />
            </FormField>

            <FormField
              label="Examples"
              htmlFor="rule-examples"
              hint="Concrete past enforcement, one per line. Agents pattern-match new candidates against these."
            >
              <Textarea
                id="rule-examples"
                value={examplesText}
                onChange={(e) => setExamplesText(e.target.value)}
                placeholder={'CHG-1234 was auto-approved because risk=low and CI passed.\nCHG-5678 was denied because rollback plan missing.'}
                rows={4}
                className="min-h-[110px] text-sm"
              />
            </FormField>

            <FormField label="Tags" htmlFor="rule-tags" hint="Comma-separated. Used for filtering on the Policies page.">
              <Input
                id="rule-tags"
                value={tagsText}
                onChange={(e) => setTagsText(e.target.value)}
                placeholder="security, prod, auto-approve"
                className="h-11"
              />
            </FormField>
          </Section>

          {/* Activation */}
          <Section title="Activation">
            <label className="flex items-center gap-3 rounded-md border border-border bg-secondary/40 px-4 py-3 cursor-pointer hover:border-primary/40 transition-colors">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="h-4 w-4 rounded border-border accent-primary"
              />
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-foreground">
                  Active (feed to agent context)
                </span>
                <span className="text-xs text-muted-foreground">
                  Inactive rules stay in DB but are excluded from agent skill prompts.
                </span>
              </div>
            </label>
          </Section>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        <DialogFooter
          className="border-t border-border bg-card sticky bottom-0"
          style={{ padding: '1rem 2.5rem 1.5rem 2.5rem' }}
        >
          <Button variant="ghost" size="lg" onClick={onClose}>
            Cancel
          </Button>
          <Button size="lg" onClick={handleSubmit} disabled={!valid || isPending}>
            {isPending ? 'Saving…' : editing ? 'Save changes' : 'Create rule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function StatTile({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Card>
      <CardContent className="p-6 flex flex-col items-center justify-center text-center">
        <div className={cn('text-4xl font-semibold tabular-nums leading-none', color)}>
          {value}
        </div>
        <div className="text-xs uppercase tracking-wider text-muted-foreground mt-3">
          {label}
        </div>
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

// ─── Form helpers ───────────────────────────────────────

function Section({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h4 className="text-sm font-semibold text-foreground">{title}</h4>
        {subtitle && (
          <p className="text-xs text-muted-foreground leading-relaxed">{subtitle}</p>
        )}
      </div>
      <div className="flex flex-col gap-5">{children}</div>
    </section>
  )
}

function FormField({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string
  htmlFor: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground leading-relaxed">{hint}</p>}
    </div>
  )
}
