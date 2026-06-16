import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft,
  BookOpen,
  MessageSquare,
  Send,
  Wrench,
  ArrowUpRight,
  Link2,
  RefreshCw,
  CheckCircle,
  Ban,
  Compass,
  ShieldCheck,
  Activity,
  Layers,
  Terminal,
  AlertTriangle,
  FileText,
  ClipboardCopy,
  Zap,
} from 'lucide-react'
import { useIncident } from '@/hooks/useData'
import {
  useIncidentUpdateStatus,
  useTriageIncidentAgent,
  useIncidentAddNote,
  useIncidentEscalate,
  useIncidentRoute,
  useIncidentLinkKB,
  useIncidentMarkAwaiting,
  useIncidentSaveDraft,
  useIncidentSendDraft,
  useIncidentEditNote,
  useIncidentDeleteNote,
  useIncidentUnlinkKB,
  useProposeRemediation,
} from '@/hooks/useMutations'
import { useAuth } from '@/lib/auth'
import type { Incident } from '@/types'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ReanalyzeButton } from '@/components/shared'
import { RiskBadge, SystemChip, ActionGuardModal, ContextualAssistant } from '@/components/shared'
import { formatDate, timeAgo } from '@/lib/utils'
import { useRole } from '@/lib/roles'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion'
import { cn } from '@/lib/utils'

const sevToRisk = { sev1: 'critical', sev2: 'high', sev3: 'medium', sev4: 'low' } as const

// ---------------------------------------------------------------------------
// Mock remediation data keyed by incident ID
// ---------------------------------------------------------------------------
interface RemediationData {
  proposedFix: string
  executionPlan: string[]
  blastRadius: string[]
  executionMode: string
  approvalRequired: { required: boolean; reason: string }
  safeToExecute: { safe: boolean; confidence: number }
}

const mockRemediations: Record<string, RemediationData> = {
  'inc-001': {
    proposedFix: `# payment-service/config/hikari.yaml
---
- path: /spring/datasource/hikari/maximum-pool-size
  op: replace
  old: 20
  new: 40

- path: /spring/datasource/hikari/connection-timeout
  op: replace
  old: 30000
  new: 45000`,
    executionPlan: [
      'Update HikariCP max-pool-size from 20 → 40 in payment-service config',
      'Update connection-timeout from 30s → 45s',
      'Rolling restart of payment-service pods (3 replicas, one at a time)',
      'Monitor connection count metrics for 15 min',
      'Verify 5xx rate drops below 0.1% threshold',
    ],
    blastRadius: ['payment-service (3 pods)', 'orders-db connection pool', 'stripe-integration (downstream latency)'],
    executionMode: 'config_only',
    approvalRequired: { required: true, reason: 'Sev2 incident — requires on-call lead approval' },
    safeToExecute: { safe: true, confidence: 94 },
  },
  'inc-002': {
    proposedFix: `# notification-service/k8s/consumer-deployment.yaml
---
spec:
  replicas: 6    # was: 3
  template:
    spec:
      containers:
      - name: notification-consumer
        env:
        - name: KAFKA_PARTITION_COUNT
          value: "6"   # was: "3"
        - name: KAFKA_MAX_POLL_RECORDS
          value: "500"  # was: "100"`,
    executionPlan: [
      'Scale consumer deployment replicas from 3 → 6',
      'Update Kafka partition count from 3 → 6 (requires topic reconfiguration)',
      'Increase max.poll.records from 100 → 500',
      'Apply deployment via kubectl rollout',
      'Monitor consumer lag via Grafana for 10 min',
    ],
    blastRadius: ['notification-service (consumer group)', 'notification-events (Kafka topic)', 'ses-sender (increased throughput)'],
    executionMode: 'code_deploy',
    approvalRequired: { required: true, reason: 'Kafka topic reconfiguration requires platform team sign-off' },
    safeToExecute: { safe: false, confidence: 72 },
  },
  'inc-003': {
    proposedFix: `# mobile-gateway/config/jwt-validation.yaml
---
- path: /auth/jwt/clockSkewLeeway
  op: replace
  old: 0
  new: 30

# Alternative: upgrade user-auth to v2.14.1
# helm upgrade user-auth ./charts/user-auth --set image.tag=v2.14.1`,
    executionPlan: [
      'Add 30s clock-skew leeway to JWT validation on mobile-gateway',
      'Rolling restart of mobile-gateway pods (2 replicas)',
      'Schedule user-auth upgrade to v2.14.1 in next maintenance window',
      'Monitor 401 error rate on mobile endpoints for 20 min',
    ],
    blastRadius: ['mobile-gateway (2 pods)', 'user-auth (JWT validation path)', 'redis-session-store (session refresh)'],
    executionMode: 'config_only',
    approvalRequired: { required: false, reason: 'Config-only fix for recurring sev3, auto-approval eligible' },
    safeToExecute: { safe: true, confidence: 91 },
  },
  'inc-004': {
    proposedFix: `# analytics-warehouse maintenance
---
-- Purge staging tables older than 14 days
DELETE FROM staging.raw_events
WHERE ingested_at < NOW() - INTERVAL '14 days';

-- Enable auto-vacuum
ALTER TABLE staging.raw_events
SET (autovacuum_enabled = true,
     autovacuum_vacuum_threshold = 10000);`,
    executionPlan: [
      'Run staging table purge for rows older than 14 days (est. 340 GB freed)',
      'Enable auto-vacuum on staging.raw_events table',
      'Verify disk usage drops below 70% threshold',
      'Set up recurring purge job via cron (daily at 02:00 UTC)',
    ],
    blastRadius: ['analytics-warehouse (primary node)', 'analytics-pipeline (ingest paused during vacuum)'],
    executionMode: 'db_maintenance',
    approvalRequired: { required: true, reason: 'Database DDL changes require DBA approval' },
    safeToExecute: { safe: true, confidence: 88 },
  },
}

function getRecommendedNextStep(incident: (typeof mockIncidents)[number]) {
  if (incident.severity === 'sev1' || incident.severity === 'sev2') {
    return {
      label: 'Escalate immediately',
      detail: 'High severity incident requires senior attention',
      accent: 'border-status-escalated',
      bg: 'bg-status-escalated/10',
      text: 'text-status-escalated',
    }
  }
  if (incident.isRecurring) {
    return {
      label: 'Check KB for known fix',
      detail: 'Recurring pattern detected, safe remediation may be available',
      accent: 'border-status-pending',
      bg: 'bg-status-pending/10',
      text: 'text-status-pending',
    }
  }
  if (incident.recommendedFix.toLowerCase().includes('config')) {
    return {
      label: 'Trigger safe fix',
      detail: 'Config-only remediation available, no code changes needed',
      accent: 'border-status-approved',
      bg: 'bg-status-approved/10',
      text: 'text-status-approved',
    }
  }
  return {
    label: 'Draft response and route',
    detail: 'Triage assessment needed before remediation',
    accent: 'border-accent',
    bg: 'bg-primary/10',
    text: 'text-primary',
  }
}

export default function IncidentDetail() {
  const { id } = useParams<{ id: string }>()
  const [guardModal, setGuardModal] = useState<{ open: boolean; title: string; description: string; action?: () => void } | null>(null)
  // Per-action dialog state. We open these instead of the generic guard
  // modal when an action needs structured input (note text, escalate
  // reason, target team, KB id, draft response).
  const [actionDialog, setActionDialog] = useState<
    | { kind: 'note' }
    | { kind: 'customer_reply' }
    | { kind: 'escalate' }
    | { kind: 'route' }
    | { kind: 'link_kb' }
    | { kind: 'draft' }
    | null
  >(null)
  const [dialogText, setDialogText] = useState('')
  const { role, canAction, getBlockedActions, config } = useRole()

  const { data: incident, isLoading } = useIncident(id!)
  const updateStatus = useIncidentUpdateStatus()
  const triageAgent = useTriageIncidentAgent()
  const addNote = useIncidentAddNote()
  const escalate = useIncidentEscalate()
  const routeIncident = useIncidentRoute()
  const linkKB = useIncidentLinkKB()
  const markAwaiting = useIncidentMarkAwaiting()
  const saveDraft = useIncidentSaveDraft()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    )
  }

  if (!incident) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Incident not found</p>
      </div>
    )
  }

  const nextStep = getRecommendedNextStep(incident)
  const isConfigFix = incident.recommendedFix.toLowerCase().includes('config')
  const isHighSev = incident.severity === 'sev1' || incident.severity === 'sev2'
  const remediation = mockRemediations[incident.id]

  const allActions = [
    { key: 'draft_response', permission: 'draft_response', label: 'Draft Response', icon: Send, style: 'bg-primary/10 text-primary hover:bg-primary/20', desc: 'Generate a customer-facing response based on the diagnosis.' },
    { key: 'work_note', permission: 'work_note', label: 'Add Work Note', icon: MessageSquare, style: 'bg-muted text-foreground/80 hover:bg-primary hover:text-foreground', desc: 'Add an internal work note.' },
    { key: 'route', permission: 'route', label: 'Route to Team', icon: ArrowUpRight, style: 'bg-muted text-foreground/80 hover:bg-primary hover:text-foreground', desc: 'Route this incident to another team.' },
    { key: 'trigger_fix', permission: 'trigger_fix', label: 'Trigger Allowed Fix', icon: Wrench, style: 'bg-status-approved/10 text-status-approved hover:bg-status-approved/20', desc: 'Execute the recommended safe remediation action.' },
    { key: 'escalate', permission: 'escalate', label: 'Escalate', icon: ArrowUpRight, style: 'bg-status-escalated/10 text-status-escalated hover:bg-status-escalated/20', desc: 'Escalate this incident.' },
    { key: 'link_kb', permission: 'link_kb', label: 'Link KB Article', icon: Link2, style: 'bg-muted text-foreground/80 hover:bg-primary hover:text-foreground', desc: 'Link a knowledge base article.' },
    { key: 'mark_awaiting', permission: 'assess', label: 'Mark Awaiting Approval', icon: CheckCircle, style: 'bg-muted text-foreground/80 hover:bg-primary hover:text-foreground', desc: 'Mark as awaiting approval.' },
  ]

  // Split into available and requires-approval buckets
  const availableActions = allActions.filter(a => canAction(a.permission))
  const blockedActions = getBlockedActions()

  // Determine actions that are "requires approval" vs truly unavailable
  const approvalRequiredKeys = ['approve', 'execute', 'execute_grant']
  const requiresApproval = blockedActions.filter(b => approvalRequiredKeys.includes(b.action))
  const notAvailable = blockedActions.filter(b => !approvalRequiredKeys.includes(b.action))

  return (
    <div className="flex flex-col gap-10">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Link
          to="/incidents"
          className="mt-1 flex h-9 w-9 items-center justify-center rounded-md hover:bg-muted transition-colors"
        >
          <ArrowLeft className="h-5 w-5 text-muted-foreground" />
        </Link>
        <div className="flex-1 min-w-0 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-mono text-muted-foreground">{incident.incidentId}</span>
            <RiskBadge level={sevToRisk[incident.severity]} />
            <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium uppercase tracking-wider text-foreground">
              {incident.status}
            </span>
          </div>
          <h1 className="font-heading text-3xl font-medium tracking-tight text-foreground break-words">
            {incident.title}
          </h1>
          <p className="text-sm text-muted-foreground break-words">{incident.description}</p>
        </div>
      </div>

      {/* Meta strip — flat row of facts under the header */}
      <Card>
        <CardContent className="grid grid-cols-2 gap-x-6 gap-y-4 py-5 md:grid-cols-4 lg:grid-cols-6">
          <Field label="Requester">
            <span className="text-sm text-foreground">{incident.requester}</span>
          </Field>
          <Field label="Service">
            <SystemChip name={incident.affectedService} />
          </Field>
          <Field label="Assignment">
            <span className="text-sm text-foreground">{incident.assignmentGroup}</span>
          </Field>
          <Field label="Related CIs">
            <div className="flex flex-wrap gap-1">
              {incident.relatedCI.slice(0, 2).map(ci => <SystemChip key={ci} name={ci} />)}
              {incident.relatedCI.length > 2 && (
                <span className="text-xs text-muted-foreground">+{incident.relatedCI.length - 2}</span>
              )}
            </div>
          </Field>
          <Field label="Related Changes">
            <div className="flex flex-wrap gap-1.5">
              {incident.relatedChanges.length > 0 ? incident.relatedChanges.map(c => (
                <Link key={c} to={`/changes/${c}`} className="text-xs font-mono text-primary hover:underline">{c}</Link>
              )) : <span className="text-xs text-muted-foreground">None</span>}
            </div>
          </Field>
          <Field label="Created">
            <span className="text-sm text-foreground">{formatDate(incident.createdAt)}</span>
          </Field>
          {incident.isRecurring && (
            <div className="col-span-full flex items-center gap-2 rounded-md border border-status-pending/30 bg-status-pending/10 px-3 py-2">
              <RefreshCw className="h-4 w-4 text-status-pending" />
              <span className="text-sm font-medium text-status-pending">Recurring issue detected</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Body — wider main column + narrow right rail */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">
        {/* ── Main: Analysis workspace ── */}
        <div className="flex flex-col gap-5 min-w-0">
          {/* Recommended Next Step callout */}
          <div className={`rounded-lg border-l-4 ${nextStep.accent} ${nextStep.bg} p-4`}>
            <div className="flex items-start gap-3">
              <Compass className={`w-5 h-5 ${nextStep.text} flex-shrink-0 mt-0.5`} />
              <div>
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Recommended Next Step</div>
                <div className={`text-sm font-semibold ${nextStep.text}`}>{nextStep.label}</div>
                <div className="text-sm text-foreground/80 mt-0.5">{nextStep.detail}</div>
              </div>
            </div>
          </div>

          {/* Support Resolution Status Strip — IT Support / Operator only */}
          {(role === 'it_support' || role === 'operator') && (() => {
            const safeNow = isConfigFix && !isHighSev && remediation?.safeToExecute?.safe
            const draftOnly = isHighSev || (remediation?.approvalRequired?.required && !isConfigFix)
            const configSafe = isConfigFix && remediation?.approvalRequired?.required
            const strip = safeNow
              ? { label: 'Support can execute config-only fix', icon: Zap, bg: 'bg-status-approved/10 border-status-approved/30', text: 'text-status-approved' }
              : configSafe
              ? { label: 'Config fix available — approval required first', icon: ShieldCheck, bg: 'bg-status-pending/10 border-status-pending/30', text: 'text-status-pending' }
              : draftOnly
              ? { label: 'Draft only until approval — escalate before remediation', icon: AlertTriangle, bg: 'bg-risk-high/10 border-risk-high/30', text: 'text-risk-high' }
              : { label: 'Triage and route — no safe fix path identified yet', icon: Compass, bg: 'bg-primary/10 border-accent/30', text: 'text-primary' }
            const StripIcon = strip.icon
            return (
              <div className={`flex items-center gap-3 px-4 py-2.5 rounded-lg border ${strip.bg}`}>
                <StripIcon className={`w-4 h-4 flex-shrink-0 ${strip.text}`} />
                <span className={`text-sm font-semibold ${strip.text}`}>{strip.label}</span>
              </div>
            )
          })()}

          {/* Main detail sections — collapsible accordion so users see only
              what they need. Diagnosis is open by default since it's the
              headline data; the rest collapse out of the way. */}
          <Card className="py-0">
            <Accordion type="multiple" defaultValue={['diagnosis', 'execution']}>
              <AccordionItem value="diagnosis" className="border-b last:border-b-0">
                <AccordionTrigger className="px-6 text-sm font-semibold">
                  Diagnosis & Recommendation
                </AccordionTrigger>
                <AccordionContent className="px-6 pb-5 flex flex-col gap-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-muted rounded-md p-3">
                      <div className="text-xs text-muted-foreground mb-1">Likely Issue Type</div>
                      <div className="text-sm font-medium text-foreground">{incident.likelyIssueType}</div>
                    </div>
                    <div className="bg-muted rounded-md p-3">
                      <div className="text-xs text-muted-foreground mb-1">Root Cause Category</div>
                      <div className="text-sm font-medium text-foreground">{incident.rootCauseCategory}</div>
                    </div>
                  </div>
                  <div className="bg-muted rounded-md p-4">
                    <div className="text-xs text-muted-foreground mb-2">Recommended Fix</div>
                    <div className="text-sm text-foreground leading-relaxed">{incident.recommendedFix}</div>
                  </div>
                  {incident.kbArticles.length > 0 && (
                    <div>
                      <div className="text-xs text-muted-foreground mb-2">Relevant KB Articles</div>
                      <div className="flex flex-col gap-1.5">
                        {incident.kbArticles.map(kb => (
                          <div key={kb} className="flex items-center gap-2 text-sm text-primary">
                            <BookOpen className="h-3.5 w-3.5" />{kb}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="execution" className="border-b last:border-b-0">
                <AccordionTrigger className="px-6 text-sm font-semibold">
                  <span className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                    Execution Readiness
                  </span>
                </AccordionTrigger>
                <AccordionContent className="px-6 pb-5 flex flex-col gap-3">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-muted rounded-md p-3">
                      <div className="text-xs text-muted-foreground mb-1">Fix Type</div>
                      <div className={`text-sm font-medium ${isConfigFix ? 'text-status-approved' : 'text-status-pending'}`}>
                        {isConfigFix ? 'Config Only' : 'Code Change'}
                      </div>
                    </div>
                    <div className="bg-muted rounded-md p-3">
                      <div className="text-xs text-muted-foreground mb-1">Safe to Trigger?</div>
                      <div className={`text-sm font-medium ${isConfigFix && !isHighSev ? 'text-status-approved' : 'text-status-pending'}`}>
                        {isConfigFix && !isHighSev ? 'Yes' : isConfigFix ? 'With Approval' : 'Needs Review'}
                      </div>
                    </div>
                    <div className="bg-muted rounded-md p-3">
                      <div className="text-xs text-muted-foreground mb-1">Approval Required?</div>
                      <div className={`text-sm font-medium ${isHighSev ? 'text-status-escalated' : 'text-foreground'}`}>
                        {isHighSev ? 'Yes — High Sev' : isConfigFix ? 'Standard' : 'Yes'}
                      </div>
                    </div>
                  </div>
                  {isConfigFix && (
                    <div className="text-xs text-foreground/85 bg-muted rounded-md px-3 py-2">
                      Config-only remediations are auto-proposed by policy. Human approval is still required before execution.
                    </div>
                  )}
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="impact" className="border-b last:border-b-0">
                <AccordionTrigger className="px-6 text-sm font-semibold">
                  <span className="flex items-center gap-2">
                    <Activity className="h-4 w-4 text-muted-foreground" />
                    Impact Assessment
                  </span>
                </AccordionTrigger>
                <AccordionContent className="px-6 pb-5 flex flex-col gap-3">
                  <div>
                    <div className="text-xs text-muted-foreground mb-2">Affected Configuration Items</div>
                    <div className="flex flex-wrap gap-1.5">
                      {incident.relatedCI.map(ci => (
                        <SystemChip key={ci} name={ci} />
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-muted rounded-md p-3">
                      <div className="text-xs text-muted-foreground mb-1">Blast Radius</div>
                      <div className="text-sm font-medium text-foreground">
                        {incident.relatedCI.length} CI{incident.relatedCI.length !== 1 ? 's' : ''} impacted
                      </div>
                    </div>
                    <div className="bg-muted rounded-md p-3">
                      <div className="text-xs text-muted-foreground mb-1">Related Changes</div>
                      <div className="text-sm font-medium text-foreground">
                        {incident.relatedChanges.length > 0 ? (
                          <span className="text-primary">{incident.relatedChanges.length} linked</span>
                        ) : (
                          <span className="text-muted-foreground">None</span>
                        )}
                      </div>
                    </div>
                  </div>
                  {incident.relatedChanges.length > 0 && (
                    <div className="text-xs text-foreground/85 bg-status-pending/10 border border-status-pending/20 rounded-md px-3 py-2">
                      This incident has linked changes. Review them to determine if the incident was caused by a recent deployment.
                    </div>
                  )}
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </Card>

          {/* A6 — multi-option remediation proposal. Renders the picker if
              already generated; offers a button to generate otherwise.
              Each option highlights the recommended one + trade-offs. */}
          <RemediationOptionsSection incident={incident} />

          {/* Linked KB articles — inline editable list. Add via the Link KB
              Article action button (right rail); unlink inline with X. */}
          <KBLinksSection
            incident={incident}
            onAdd={() => {
              setDialogText('')
              setActionDialog({ kind: 'link_kb' })
            }}
          />

          {/* Draft customer reply — in-progress text saved server-side so
              other team members can pick it up. Send promotes it into a
              real customer_reply note + clears the draft. Agent context
              also reads incident.draftResponse so re-triage knows. */}
          {incident.draftResponse && incident.draftResponse.trim() && (
            <DraftResponseCard
              incident={incident}
              onContinueEdit={() => {
                setDialogText(incident.draftResponse ?? '')
                setActionDialog({ kind: 'draft' })
              }}
            />
          )}

          {/* Notes thread — work notes + customer replies + escalation reasons.
              Mirrors the Approvals notes pattern. Agent context loader feeds
              these into triage_incident skill input as humanNotes prose. */}
          {(incident.notes?.length ?? 0) > 0 && (
            <IncidentNotesSection incident={incident} />
          )}

          {/* Similar Incidents / Recurring Pattern */}
          {incident.isRecurring && (
            <div className="bg-card rounded-lg border border-status-pending/30 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-status-pending" />
                <h3 className="text-sm font-medium text-status-pending">Recurring Pattern Detected</h3>
              </div>
              <div className="bg-muted rounded p-3 space-y-2">
                <div className="text-sm text-foreground leading-relaxed">
                  This issue has been reported multiple times. The pattern matches previous occurrences with the same root cause category: <span className="font-medium text-foreground">{incident.rootCauseCategory}</span>.
                </div>
                <div className="text-sm text-foreground/80">
                  Consider a permanent fix or workflow adjustment to prevent recurrence. Review KB articles for documented remediation steps.
                </div>
              </div>
              {incident.kbArticles.length > 0 && (
                <div className="bg-status-pending/10 border border-status-pending/20 rounded px-3 py-2">
                  <div className="text-xs text-status-pending font-medium mb-1">Known Fix Available</div>
                  <div className="space-y-1">
                    {incident.kbArticles.map(kb => (
                      <div key={kb} className="flex items-center gap-2 text-sm text-primary">
                        <BookOpen className="w-3.5 h-3.5" />{kb}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Technical Remediation */}
          {remediation && (
            <div className={`bg-card rounded-lg border p-4 space-y-4 ${
              (incident.isRecurring || isConfigFix)
                ? 'border-accent/40 ring-1 ring-accent/20'
                : 'border-border'
            }`}>
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-medium text-foreground">Technical Remediation</h3>
                {(incident.isRecurring || isConfigFix) && (
                  <span className="ml-auto text-xs font-semibold uppercase tracking-wider px-2 py-1 rounded-full bg-primary/15 text-primary">
                    {isConfigFix ? 'Config-Only Fix' : 'Known Pattern'}
                  </span>
                )}
              </div>

              {/* Engineer view: full technical detail */}
              {role === 'engineer' || role === 'admin' ? (
                <>
                  {/* Proposed Fix — code/diff block */}
                  <div>
                    <div className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wider">Proposed Fix</div>
                    <pre className="bg-[#0d1117] border border-border rounded-lg p-4 text-xs text-[#c9d1d9] font-mono leading-relaxed overflow-x-auto whitespace-pre">
                      {remediation.proposedFix}
                    </pre>
                  </div>

                  {/* Execution Plan */}
                  <div>
                    <div className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wider">Execution Plan</div>
                    <ol className="space-y-1.5">
                      {remediation.executionPlan.map((step, i) => (
                        <li key={i} className="flex items-start gap-3">
                          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/15 text-primary text-xs font-bold flex items-center justify-center mt-0.5">
                            {i + 1}
                          </span>
                          <span className="text-sm text-foreground leading-relaxed">{step}</span>
                        </li>
                      ))}
                    </ol>
                  </div>

                  {/* Blast Radius */}
                  <div>
                    <div className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wider">Blast Radius</div>
                    <div className="flex flex-wrap gap-1.5">
                      {remediation.blastRadius.map((item) => (
                        <span key={item} className="inline-flex items-center gap-1 px-2 py-1 rounded bg-muted border border-border text-xs text-foreground/80">
                          <AlertTriangle className="w-3 h-3 text-status-pending" />
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Execution Mode + Approval + Safety grid */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-muted rounded p-3">
                      <div className="text-xs text-muted-foreground mb-1">Execution Mode</div>
                      <div className="text-sm font-medium text-foreground font-mono">{remediation.executionMode}</div>
                    </div>
                    <div className="bg-muted rounded p-3">
                      <div className="text-xs text-muted-foreground mb-1">Approval Required</div>
                      <div className={`text-sm font-medium ${remediation.approvalRequired.required ? 'text-status-pending' : 'text-status-approved'}`}>
                        {remediation.approvalRequired.required ? 'Yes' : 'No'}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 leading-tight">{remediation.approvalRequired.reason}</div>
                    </div>
                    <div className="bg-muted rounded p-3">
                      <div className="text-xs text-muted-foreground mb-1">Safe to Execute</div>
                      <div className={`text-sm font-medium ${remediation.safeToExecute.safe ? 'text-status-approved' : 'text-status-escalated'}`}>
                        {remediation.safeToExecute.safe ? 'Yes' : 'No'} — {remediation.safeToExecute.confidence}%
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                /* Operator / IT Support view: simplified summary */
                <>
                  {/* Simplified execution plan */}
                  <div>
                    <div className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wider">Remediation Plan</div>
                    <ol className="space-y-1.5">
                      {remediation.executionPlan.map((step, i) => (
                        <li key={i} className="flex items-start gap-3">
                          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/15 text-primary text-xs font-bold flex items-center justify-center mt-0.5">
                            {i + 1}
                          </span>
                          <span className="text-sm text-foreground leading-relaxed">{step}</span>
                        </li>
                      ))}
                    </ol>
                  </div>

                  {/* Compact approval status */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-muted rounded p-3">
                      <div className="text-xs text-muted-foreground mb-1">Approval Status</div>
                      <div className={`text-sm font-medium ${remediation.approvalRequired.required ? 'text-status-pending' : 'text-status-approved'}`}>
                        {remediation.approvalRequired.required ? 'Approval Required' : 'Auto-Approved'}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 leading-tight">{remediation.approvalRequired.reason}</div>
                    </div>
                    <div className="bg-muted rounded p-3">
                      <div className="text-xs text-muted-foreground mb-1">Safety Assessment</div>
                      <div className={`text-sm font-medium ${remediation.safeToExecute.safe ? 'text-status-approved' : 'text-status-escalated'}`}>
                        {remediation.safeToExecute.safe ? 'Safe to Execute' : 'Needs Review'}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* ── Right: Action Rail ── */}
        <div className="flex flex-col gap-5">
          {/* AI Re-analyze */}
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="text-sm font-semibold">AI Analysis</CardTitle>
            </CardHeader>
            <CardContent className="py-4">
              <ReanalyzeButton
                kind="incident"
                entityIdOrTicket={incident.incidentId}
                userRole={role}
                mutate={triageAgent.mutate}
                isPending={triageAgent.isPending}
                isError={triageAgent.isError}
                isSuccess={triageAgent.isSuccess}
                error={triageAgent.error}
                data={triageAgent.data}
              />
            </CardContent>
          </Card>

          {/* Mini assistant — sits high up so quick prompts are visible without scrolling */}
          <ContextualAssistant
            entityType="incident"
            entityId={incident.id}
            entityTitle={incident.title}
            quickActions={role === 'it_support' ? [
              { label: 'Draft work note', prompt: `Draft an internal work note for ${incident.incidentId}` },
              { label: 'Draft customer reply', prompt: `Draft a customer-facing response for ${incident.incidentId}` },
              { label: 'Prepare escalation note', prompt: `Prepare an escalation summary for ${incident.incidentId}` },
              { label: 'Attach relevant KB', prompt: `Which KB articles are relevant to ${incident.incidentId}?` },
              { label: 'Summarize recurring issue', prompt: `Summarize the recurring pattern for ${incident.incidentId}` },
            ] : role === 'engineer' ? [
              { label: 'Root cause analysis', prompt: `What is the likely root cause for ${incident.incidentId}?` },
              { label: 'Show remediation diff', prompt: `Show me the proposed config/code change for ${incident.incidentId}` },
              { label: 'Simulation feasibility', prompt: `Can we safely simulate the fix for ${incident.incidentId}?` },
            ] : [
              { label: 'Diagnose this', prompt: `What is the likely root cause for ${incident.incidentId}?` },
              { label: 'KB articles', prompt: `Are there relevant KB articles for ${incident.incidentId}?` },
              { label: 'Draft response', prompt: `Draft a status update for ${incident.incidentId}` },
            ]}
          />

          <Card>
            <CardHeader className="border-b">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm font-semibold">Actions</CardTitle>
                <Badge variant="secondary" className="text-[10px] uppercase tracking-wider">
                  {config.label}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-5 py-5">
              {availableActions.length > 0 && (
                <div className="flex flex-col gap-2.5">
                  <RailLabel tone="success">Available now</RailLabel>
                  <div className="flex flex-col gap-2">
                    {availableActions.map((a) => {
                      const Icon = a.icon
                      return (
                        <button
                          key={a.key}
                          onClick={() => {
                            setDialogText('')
                            // Each action either opens its own input dialog or
                            // (for trigger_fix) fires the existing GuardModal
                            // confirm flow that updates status.
                            if (a.key === 'trigger_fix') {
                              setGuardModal({
                                open: true,
                                title: a.label,
                                description: a.desc,
                                action: () => {
                                  const nextStatus =
                                    incident.status === 'investigating' ? 'identified' : 'monitoring'
                                  updateStatus.mutate({
                                    id: incident.incidentId,
                                    status: nextStatus,
                                    expectedVersion: incident.version,
                                  })
                                  setGuardModal(null)
                                },
                              })
                            } else if (a.key === 'work_note') {
                              setActionDialog({ kind: 'note' })
                            } else if (a.key === 'draft_response') {
                              setDialogText(incident.draftResponse ?? '')
                              setActionDialog({ kind: 'draft' })
                            } else if (a.key === 'escalate') {
                              setActionDialog({ kind: 'escalate' })
                            } else if (a.key === 'route') {
                              setActionDialog({ kind: 'route' })
                            } else if (a.key === 'link_kb') {
                              setActionDialog({ kind: 'link_kb' })
                            } else if (a.key === 'mark_awaiting') {
                              markAwaiting.mutate({
                                id: incident.incidentId,
                                awaiting: !incident.awaitingApproval,
                              })
                            } else {
                              setGuardModal({
                                open: true,
                                title: a.label,
                                description: a.desc,
                              })
                            }
                          }}
                          className={`flex h-11 items-center gap-3 rounded-md px-4 text-sm font-medium transition-colors ${a.style}`}
                        >
                          <Icon className="h-4 w-4 flex-shrink-0" />
                          <span className="flex-1 text-left">{a.label}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {requiresApproval.length > 0 && (
                <div className="flex flex-col gap-2.5">
                  <RailLabel tone="warning">Requires approval</RailLabel>
                  <div className="flex flex-col gap-2">
                    {requiresApproval.map((blocked) => (
                      <div
                        key={blocked.action}
                        className="flex items-start gap-3 rounded-md border border-status-pending/20 bg-status-pending/5 px-3 py-2.5"
                      >
                        <CheckCircle className="h-4 w-4 flex-shrink-0 mt-0.5 text-status-pending" />
                        <div className="flex flex-col gap-1 min-w-0">
                          <div className="text-sm font-medium text-foreground">{blocked.label}</div>
                          <div className="text-xs text-muted-foreground leading-relaxed">
                            {blocked.reason}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {notAvailable.length > 0 && (
                <div className="flex flex-col gap-2.5">
                  <RailLabel>Not available</RailLabel>
                  <div className="flex flex-col gap-2">
                    {notAvailable.map((blocked) => (
                      <div
                        key={blocked.action}
                        className="flex items-start gap-3 rounded-md px-3 py-2.5 text-muted-foreground"
                      >
                        <Ban className="h-4 w-4 flex-shrink-0 mt-0.5" />
                        <div className="flex flex-col gap-1 min-w-0">
                          <div className="text-sm font-medium text-foreground/80">{blocked.label}</div>
                          <div className="text-xs leading-relaxed">{blocked.reason}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {(role === 'approver' || role === 'admin') && (
            <Card>
              <CardHeader className="border-b">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-primary" />
                  Decision Impact
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 py-4">
                <ImpactRow
                  icon={<CheckCircle className="h-4 w-4 text-status-approved" />}
                  label="If remediation approved"
                  tone="text-status-approved"
                  text={
                    (remediation ? `Fix applied: ${remediation.executionMode}. ` : 'Recommended fix proceeds. ') +
                    (incident.severity === 'sev1' || incident.severity === 'sev2'
                      ? 'Active incident resolved faster.'
                      : 'Issue resolved.')
                  }
                />
                <ImpactRow
                  icon={<Ban className="h-4 w-4 text-status-denied" />}
                  label="If denied"
                  tone="text-status-denied"
                  text={
                    incident.severity === 'sev1'
                      ? 'Sev1 incident remains unresolved. May trigger executive escalation.'
                      : incident.severity === 'sev2'
                        ? 'Sev2 incident continues. Manual workaround needed.'
                        : 'Incident requires alternative remediation path.'
                  }
                />
                <ImpactRow
                  icon={<ArrowUpRight className="h-4 w-4 text-status-escalated" />}
                  label="If escalated"
                  tone="text-status-escalated"
                  text="Routes to SRE Lead for review. Incident SLA clock continues."
                />
              </CardContent>
            </Card>
          )}

          {/* Support Artifact Actions — IT Support only */}
          {role === 'it_support' && (
            <Card>
              <CardHeader className="border-b">
                <CardTitle className="text-sm font-semibold">Support Artifacts</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 py-4">
                <button
                  onClick={() => setGuardModal({ open: true, title: 'Draft Work Note', description: `Generate an internal work note summarizing triage status, diagnosis, and next steps for ${incident.incidentId}.` })}
                  className="flex h-11 w-full items-center gap-3 rounded-md bg-primary/10 px-4 text-sm font-medium text-primary hover:bg-primary/20 transition-colors"
                >
                  <ClipboardCopy className="h-4 w-4 flex-shrink-0" /> <span className="flex-1 text-left">Draft Work Note</span>
                </button>
                <button
                  onClick={() => setGuardModal({ open: true, title: 'Draft Customer Reply', description: `Generate a customer-facing status update for ${incident.incidentId} with ETA and impact summary.` })}
                  className="flex h-11 w-full items-center gap-3 rounded-md bg-primary/10 px-4 text-sm font-medium text-primary hover:bg-primary/20 transition-colors"
                >
                  <FileText className="h-4 w-4 flex-shrink-0" /> <span className="flex-1 text-left">Draft Customer Reply</span>
                </button>
                <button
                  onClick={() => setGuardModal({ open: true, title: 'Prepare Escalation Note', description: `Generate an escalation summary for ${incident.incidentId} including severity, impact, attempted actions, and recommended next owner.` })}
                  className="flex h-11 w-full items-center gap-3 rounded-md bg-status-escalated/10 px-4 text-sm font-medium text-status-escalated hover:bg-status-escalated/20 transition-colors"
                >
                  <ArrowUpRight className="h-4 w-4 flex-shrink-0" /> <span className="flex-1 text-left">Prepare Escalation Note</span>
                </button>
                {incident.kbArticles.length > 0 && (
                  <button
                    onClick={() => setGuardModal({ open: true, title: 'Attach KB Article', description: `Link ${incident.kbArticles[0]} to ${incident.incidentId} and add remediation context from the article.` })}
                    className="flex h-11 w-full items-center gap-3 rounded-md bg-muted px-4 text-sm font-medium text-foreground/85 hover:bg-muted/70 transition-colors"
                  >
                    <BookOpen className="h-4 w-4 flex-shrink-0" /> <span className="flex-1 text-left">Attach KB Article</span>
                  </button>
                )}
              </CardContent>
            </Card>
          )}

        </div>
      </div>

      {guardModal?.open && (
        <ActionGuardModal
          isOpen={true}
          title={guardModal.title}
          description={guardModal.description}
          confirmLabel="Confirm"
          onConfirm={() => { guardModal.action ? guardModal.action() : setGuardModal(null) }}
          onCancel={() => setGuardModal(null)}
          variant="info"
        />
      )}

      {/* Action dialogs — one per structured-input action. Reuses a single
          `dialogText` state since only one is open at a time. */}
      <Dialog
        open={actionDialog !== null}
        onOpenChange={(o) => {
          if (!o) {
            setActionDialog(null)
            setDialogText('')
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {actionDialog?.kind === 'note' && 'Add work note'}
              {actionDialog?.kind === 'customer_reply' && 'Draft customer reply'}
              {actionDialog?.kind === 'escalate' && 'Escalate incident'}
              {actionDialog?.kind === 'route' && 'Route to team'}
              {actionDialog?.kind === 'link_kb' && 'Link KB article'}
              {actionDialog?.kind === 'draft' && 'Draft response'}
            </DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-3 py-2">
            {(actionDialog?.kind === 'note' ||
              actionDialog?.kind === 'customer_reply' ||
              actionDialog?.kind === 'escalate' ||
              actionDialog?.kind === 'draft') && (
              <>
                <Label htmlFor="dlg-text">
                  {actionDialog.kind === 'escalate' ? 'Reason' : 'Content'}
                </Label>
                <Textarea
                  id="dlg-text"
                  value={dialogText}
                  onChange={(e) => setDialogText(e.target.value)}
                  rows={5}
                  placeholder={
                    actionDialog.kind === 'note'
                      ? 'Internal triage note…'
                      : actionDialog.kind === 'customer_reply'
                        ? 'Customer-facing reply text…'
                        : actionDialog.kind === 'escalate'
                          ? 'Why does this need to escalate?'
                          : 'Rolling draft response — saved for later iteration.'
                  }
                />
              </>
            )}
            {actionDialog?.kind === 'route' && (
              <>
                <Label htmlFor="dlg-team">Target team</Label>
                <Input
                  id="dlg-team"
                  value={dialogText}
                  onChange={(e) => setDialogText(e.target.value)}
                  placeholder="eg sre-platform"
                />
              </>
            )}
            {actionDialog?.kind === 'link_kb' && (
              <>
                <Label htmlFor="dlg-kb">KB article ID</Label>
                <Input
                  id="dlg-kb"
                  value={dialogText}
                  onChange={(e) => setDialogText(e.target.value)}
                  placeholder="eg KB-1234"
                />
              </>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setActionDialog(null)
                setDialogText('')
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={!dialogText.trim()}
              onClick={() => {
                const value = dialogText.trim()
                if (!value || !actionDialog) return
                const inc = incident.incidentId
                if (actionDialog.kind === 'note') {
                  addNote.mutate({ id: inc, content: value, kind: 'work_note' })
                } else if (actionDialog.kind === 'customer_reply') {
                  addNote.mutate({ id: inc, content: value, kind: 'customer_reply' })
                } else if (actionDialog.kind === 'escalate') {
                  escalate.mutate({ id: inc, reason: value, expectedVersion: incident.version })
                } else if (actionDialog.kind === 'route') {
                  routeIncident.mutate({ id: inc, team: value })
                } else if (actionDialog.kind === 'link_kb') {
                  linkKB.mutate({ id: inc, kbArticleId: value })
                } else if (actionDialog.kind === 'draft') {
                  saveDraft.mutate({ id: inc, draft: value })
                }
                setActionDialog(null)
                setDialogText('')
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Right rail helpers ─────────────────────────────────

function RailLabel({
  children,
  tone,
}: {
  children: React.ReactNode
  tone?: 'success' | 'warning'
}) {
  return (
    <div
      className={cn(
        'text-xs font-semibold uppercase tracking-wider',
        tone === 'success'
          ? 'text-status-approved'
          : tone === 'warning'
            ? 'text-status-pending'
            : 'text-muted-foreground',
      )}
    >
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

function ImpactRow({
  icon,
  label,
  tone,
  text,
}: {
  icon: React.ReactNode
  label: string
  tone: string
  text: string
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex-shrink-0">{icon}</span>
      <div className="flex flex-col gap-1 min-w-0">
        <div className={cn('text-xs font-semibold uppercase tracking-wider', tone)}>{label}</div>
        <p className="text-sm leading-relaxed text-foreground/85">{text}</p>
      </div>
    </div>
  )
}

// ─── Notes thread ─────────────────────────────────────

/**
 * Renders the work-note + customer-reply thread attached to an incident.
 * Mirrors Approvals NotesSection: actor + timeAgo header, "(edited)" marker,
 * inline edit/delete scoped to author or admin. Kind tag distinguishes
 * internal work notes from customer-facing replies.
 */
function IncidentNotesSection({ incident }: { incident: Incident }) {
  const notes = incident.notes ?? []
  const { user } = useAuth()
  const currentName = user?.name ?? ''
  const isAdmin = user?.role === 'admin'
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const editNote = useIncidentEditNote()
  const deleteNote = useIncidentDeleteNote()

  return (
    <div className="rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between">
        <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
          Notes &middot; {notes.length}
        </h3>
      </div>
      <ul className="flex flex-col gap-3 px-5 py-4">
        {notes.map((n) => {
          const canEdit = isAdmin || n.actor === currentName
          const isEditing = editingId === n.id
          const kindLabel = n.kind === 'customer_reply' ? 'Customer reply' : 'Work note'
          const kindClass =
            n.kind === 'customer_reply'
              ? 'bg-primary/10 text-primary'
              : 'bg-muted text-foreground/85'
          return (
            <li
              key={n.id}
              className="rounded-md border border-border bg-card/40 px-3 py-2.5"
            >
              <div className="flex items-center justify-between gap-3 mb-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`text-xs font-semibold uppercase tracking-wider rounded px-1.5 py-0.5 flex-shrink-0 ${kindClass}`}
                  >
                    {kindLabel}
                  </span>
                  <span className="text-sm font-medium text-foreground truncate">
                    {n.actor}
                  </span>
                  <span className="text-xs text-muted-foreground flex-shrink-0">
                    {timeAgo(n.createdAt)}
                  </span>
                  {n.editedBy && (
                    <span
                      className="text-xs text-muted-foreground/80 italic flex-shrink-0"
                      title={`Last edited by ${n.editedBy}`}
                    >
                      (edited)
                    </span>
                  )}
                </div>
                {canEdit && !isEditing && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => {
                        setEditingId(n.id)
                        setDraft(n.content)
                      }}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-muted"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => {
                        if (confirm('Delete this note?')) {
                          deleteNote.mutate({ id: incident.incidentId, noteId: n.id })
                        }
                      }}
                      className="text-xs text-muted-foreground hover:text-destructive transition-colors px-1.5 py-0.5 rounded hover:bg-destructive/10"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
              {isEditing ? (
                <div className="flex flex-col gap-2">
                  <Textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    rows={3}
                    autoFocus
                  />
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditingId(null)
                        setDraft('')
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      disabled={!draft.trim() || editNote.isPending}
                      onClick={() => {
                        editNote.mutate(
                          {
                            id: incident.incidentId,
                            noteId: n.id,
                            content: draft.trim(),
                          },
                          {
                            onSuccess: () => {
                              setEditingId(null)
                              setDraft('')
                            },
                          },
                        )
                      }}
                    >
                      Save
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">
                  {n.content}
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ─── Draft response card ─────────────────────────────

/**
 * Surfaces an in-progress customer reply draft inline on the incident page
 * so any team member can see "X is mid-drafting a reply" without opening
 * the dialog. Send promotes the text into a real customer_reply note.
 */
function DraftResponseCard({
  incident,
  onContinueEdit,
}: {
  incident: Incident
  onContinueEdit: () => void
}) {
  const sendDraft = useIncidentSendDraft()
  const draft = incident.draftResponse ?? ''
  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 text-card-foreground shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 border-b border-primary/20 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          <span className="text-base font-semibold text-foreground">
            Draft customer reply
          </span>
          <span className="text-xs font-medium uppercase tracking-wider rounded px-1.5 py-0.5 bg-primary/15 text-primary">
            In progress
          </span>
        </div>
        <span className="text-xs text-muted-foreground">
          Last edited {timeAgo(incident.updatedAt)}
        </span>
      </div>
      <div className="px-5 py-4 flex flex-col gap-4">
        <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap rounded-md bg-card/60 border border-border px-3 py-2.5">
          {draft}
        </p>
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onContinueEdit}>
            Continue editing
          </Button>
          <Button
            size="sm"
            disabled={sendDraft.isPending}
            onClick={() => {
              if (confirm('Send this draft as the customer reply? Clears the draft.')) {
                sendDraft.mutate({ id: incident.incidentId })
              }
            }}
          >
            Send as customer reply
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── KB links section ─────────────────────────────────

/**
 * Inline list of linked KB articles. Each pill has an X to unlink. Empty
 * state shows a + Add affordance that triggers the existing Link KB Article
 * action dialog (handled in parent IncidentDetail state).
 */
function KBLinksSection({
  incident,
  onAdd,
}: {
  incident: Incident
  onAdd: () => void
}) {
  const unlink = useIncidentUnlinkKB()
  const articles = incident.kbArticles ?? []
  return (
    <div className="rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 border-b border-border/60 flex items-center justify-between">
        <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-muted-foreground" />
          KB articles &middot; {articles.length}
        </h3>
        <Button variant="ghost" size="sm" onClick={onAdd}>
          + Link article
        </Button>
      </div>
      <div className="px-5 py-4">
        {articles.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No KB articles linked yet. Use <span className="font-medium text-foreground">Link KB Article</span> to attach one — agent context loader feeds linked articles into triage prompts.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {articles.map((kb) => (
              <span
                key={kb}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-3 py-1.5 text-sm font-mono text-foreground/85"
              >
                <BookOpen className="h-3.5 w-3.5 text-primary" />
                {kb}
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(`Unlink ${kb} from this incident?`)) {
                      unlink.mutate({ id: incident.incidentId, kbArticleId: kb })
                    }
                  }}
                  className="ml-1 text-muted-foreground hover:text-destructive transition-colors"
                  aria-label={`Unlink ${kb}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Remediation options (A6) ─────────────────────────

/**
 * Multi-option remediation picker. Shows 2-3 options from the
 * `propose_bounded_remediation` skill side-by-side; recommended is
 * tinted primary. Renders an empty state with a trigger button when
 * `proposedRemediations` is null. The picker is read-only for now —
 * acting on a choice goes through the standard execute-change flow.
 */
function RemediationOptionsSection({ incident }: { incident: Incident }) {
  const propose = useProposeRemediation()
  const data = incident.proposedRemediations
  const [intent, setIntent] = useState<'rollback' | 'config_change' | 'restart' | 'failover' | 'auto_choose'>('auto_choose')

  if (!data) {
    return (
      <div className="rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border/60 flex items-center justify-between">
          <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Wrench className="h-4 w-4 text-muted-foreground" />
            Remediation options
          </h3>
        </div>
        <div className="px-5 py-5 flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Ask the agent to draft 2-3 bounded remediation options for this incident. Each option is single-service, single-environment, single-change-type — the picker highlights the recommended one and its trade-offs.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="intent-sel" className="text-xs text-muted-foreground">
              Intent
            </Label>
            <select
              id="intent-sel"
              value={intent}
              onChange={(e) => setIntent(e.target.value as typeof intent)}
              className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground"
            >
              <option value="auto_choose">auto-choose</option>
              <option value="rollback">rollback</option>
              <option value="config_change">config change</option>
              <option value="restart">restart</option>
              <option value="failover">failover</option>
            </select>
            <Button
              size="sm"
              disabled={propose.isPending}
              onClick={() => propose.mutate({ id: incident.incidentId, intent })}
            >
              {propose.isPending ? 'Generating…' : 'Propose options'}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 border-b border-border/60 flex items-center justify-between">
        <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
          <Wrench className="h-4 w-4 text-muted-foreground" />
          Remediation options &middot; {data.options.length}
        </h3>
        <Button
          variant="ghost"
          size="sm"
          disabled={propose.isPending}
          onClick={() => propose.mutate({ id: incident.incidentId, intent })}
        >
          {propose.isPending ? 'Regenerating…' : 'Regenerate'}
        </Button>
      </div>
      <div className="px-5 py-4 flex flex-col gap-3">
        {data.rationale && (
          <p className="text-sm text-foreground/85 leading-relaxed rounded-md bg-muted px-3 py-2">
            {data.rationale}
          </p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {data.options.map((opt) => {
            const isRecommended = opt.id === data.recommendedOptionId
            return (
              <div
                key={opt.id}
                className={cn(
                  'rounded-lg border p-3 flex flex-col gap-2',
                  isRecommended
                    ? 'border-primary/40 bg-primary/5'
                    : 'border-border bg-card/40',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-foreground truncate" title={opt.title}>
                    {opt.label}
                  </span>
                  {isRecommended && (
                    <span className="text-xs font-semibold uppercase tracking-wider rounded px-1.5 py-0.5 bg-primary/15 text-primary flex-shrink-0">
                      Recommended
                    </span>
                  )}
                </div>
                <p className="text-xs text-foreground/85 leading-relaxed line-clamp-3" title={opt.description}>
                  {opt.description}
                </p>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  <RiskBadge level={opt.estimatedRiskLevel} size="sm" />
                  <span className="text-xs font-mono rounded bg-muted px-1.5 py-0.5 text-foreground/80">
                    {opt.riskDelta}
                  </span>
                  <span className="text-xs rounded bg-muted px-1.5 py-0.5 text-foreground/80">
                    {opt.changeType}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground italic mt-1">
                  {opt.optionRationale}
                </p>
                <div className="text-xs text-foreground/80 mt-1">
                  <span className="font-medium">Rollback{opt.rollbackTested ? ' (tested)' : ''}:</span>{' '}
                  {opt.rollbackPlan}
                </div>
                {opt.suggestedMaintenanceWindow && (
                  <div className="text-xs text-foreground/70 mt-1">
                    <span className="font-medium">Window:</span>{' '}
                    {opt.suggestedMaintenanceWindow}
                  </div>
                )}
                {opt.estimatedBlastRadius.length > 0 && (
                  <div className="text-xs text-foreground/70 mt-1">
                    <span className="font-medium">Blast radius:</span>{' '}
                    {opt.estimatedBlastRadius.map((b) => b.name).join(', ')}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        {data.warnings && data.warnings.length > 0 && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 flex flex-col gap-1">
            <span className="text-xs font-semibold text-amber-300 uppercase tracking-wider">
              Warnings
            </span>
            <ul className="text-xs text-amber-200/90 flex flex-col gap-1">
              {data.warnings.map((w, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span
                    className={cn(
                      'text-xs font-semibold uppercase tracking-wider rounded px-1.5 flex-shrink-0',
                      w.severity === 'block' && 'bg-red-500/15 text-red-300',
                      w.severity === 'warn' && 'bg-amber-500/15 text-amber-300',
                      w.severity === 'info' && 'bg-muted text-foreground/70',
                    )}
                  >
                    {w.severity}
                  </span>
                  <span>{w.note}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
