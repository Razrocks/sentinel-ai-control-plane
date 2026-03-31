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
import { mockIncidents } from '@/data/mock'
import { RiskBadge, SystemChip, ActionGuardModal, ContextualAssistant } from '@/components/shared'
import { formatDate } from '@/lib/utils'
import { useRole } from '@/lib/roles'

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
    bg: 'bg-accent/10',
    text: 'text-accent',
  }
}

export default function IncidentDetail() {
  const { id } = useParams<{ id: string }>()
  const [guardModal, setGuardModal] = useState<{ open: boolean; title: string; description: string } | null>(null)
  const { role, canAction, getBlockedActions, config } = useRole()

  const incident = mockIncidents.find(i => i.id === id)
  if (!incident) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-text-muted">Incident not found</p>
      </div>
    )
  }

  const nextStep = getRecommendedNextStep(incident)
  const isConfigFix = incident.recommendedFix.toLowerCase().includes('config')
  const isHighSev = incident.severity === 'sev1' || incident.severity === 'sev2'
  const remediation = mockRemediations[incident.id]

  const allActions = [
    { key: 'draft_response', permission: 'draft_response', label: 'Draft Response', icon: Send, style: 'bg-accent/10 text-accent hover:bg-accent/20', desc: 'Generate a customer-facing response based on the diagnosis.' },
    { key: 'work_note', permission: 'work_note', label: 'Add Work Note', icon: MessageSquare, style: 'bg-surface-raised text-text-secondary hover:bg-surface-overlay hover:text-text-primary', desc: 'Add an internal work note.' },
    { key: 'route', permission: 'route', label: 'Route to Team', icon: ArrowUpRight, style: 'bg-surface-raised text-text-secondary hover:bg-surface-overlay hover:text-text-primary', desc: 'Route this incident to another team.' },
    { key: 'trigger_fix', permission: 'trigger_fix', label: 'Trigger Allowed Fix', icon: Wrench, style: 'bg-status-approved/10 text-status-approved hover:bg-status-approved/20', desc: 'Execute the recommended safe remediation action.' },
    { key: 'escalate', permission: 'escalate', label: 'Escalate', icon: ArrowUpRight, style: 'bg-status-escalated/10 text-status-escalated hover:bg-status-escalated/20', desc: 'Escalate this incident.' },
    { key: 'link_kb', permission: 'link_kb', label: 'Link KB Article', icon: Link2, style: 'bg-surface-raised text-text-secondary hover:bg-surface-overlay hover:text-text-primary', desc: 'Link a knowledge base article.' },
    { key: 'mark_awaiting', permission: 'assess', label: 'Mark Awaiting Approval', icon: CheckCircle, style: 'bg-surface-raised text-text-secondary hover:bg-surface-overlay hover:text-text-primary', desc: 'Mark as awaiting approval.' },
  ]

  // Split into available and requires-approval buckets
  const availableActions = allActions.filter(a => canAction(a.permission))
  const blockedActions = getBlockedActions()

  // Determine actions that are "requires approval" vs truly unavailable
  const approvalRequiredKeys = ['approve', 'execute', 'execute_grant']
  const requiresApproval = blockedActions.filter(b => approvalRequiredKeys.includes(b.action))
  const notAvailable = blockedActions.filter(b => !approvalRequiredKeys.includes(b.action))

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Link to="/incidents" className="mt-1 p-1 rounded hover:bg-surface-raised transition-colors">
          <ArrowLeft className="w-5 h-5 text-text-muted" />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-1">
            <span className="text-sm text-text-muted font-mono">{incident.incidentId}</span>
            <RiskBadge level={sevToRisk[incident.severity]} />
            <span className="text-sm text-text-secondary capitalize px-2 py-0.5 rounded bg-surface-raised">{incident.status}</span>
          </div>
          <h1 className="text-xl font-semibold text-text-primary break-words">{incident.title}</h1>
          <p className="text-sm text-text-secondary mt-1 break-words">{incident.description}</p>
        </div>
      </div>

      {/* Three-column grid */}
      <div className="grid grid-cols-[280px_1fr_280px] gap-5">
        {/* ── Left: Incident Context ── */}
        <div>
          <div className="bg-surface rounded-lg border border-border p-4 space-y-4">
            <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider">Incident Context</h3>
            <div className="space-y-3">
              <div>
                <div className="text-xs text-text-muted">Requester</div>
                <div className="text-sm text-text-primary">{incident.requester}</div>
              </div>
              <div>
                <div className="text-xs text-text-muted">Affected Service</div>
                <SystemChip name={incident.affectedService} />
              </div>
              <div>
                <div className="text-xs text-text-muted">Severity</div>
                <RiskBadge level={sevToRisk[incident.severity]} />
              </div>
              <div>
                <div className="text-xs text-text-muted">Assignment Group</div>
                <div className="text-sm text-text-primary">{incident.assignmentGroup}</div>
              </div>
              <div>
                <div className="text-xs text-text-muted">Related CIs</div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {incident.relatedCI.map(ci => <SystemChip key={ci} name={ci} />)}
                </div>
              </div>
              <div>
                <div className="text-xs text-text-muted">Related Changes</div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {incident.relatedChanges.length > 0 ? incident.relatedChanges.map(c => (
                    <Link key={c} to={`/changes/${c}`} className="text-xs text-accent font-mono hover:underline">{c}</Link>
                  )) : <span className="text-xs text-text-muted">None</span>}
                </div>
              </div>
              <div>
                <div className="text-xs text-text-muted">Created</div>
                <div className="text-sm text-text-secondary">{formatDate(incident.createdAt)}</div>
              </div>
              {incident.isRecurring && (
                <div className="flex items-center gap-1.5 bg-status-pending/10 border border-status-pending/20 rounded px-2 py-1.5">
                  <RefreshCw className="w-3.5 h-3.5 text-status-pending" />
                  <span className="text-xs text-status-pending font-medium">Recurring issue detected</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Center: Analysis workspace ── */}
        <div className="space-y-4 min-w-0">
          {/* Recommended Next Step callout */}
          <div className={`rounded-lg border-l-4 ${nextStep.accent} ${nextStep.bg} p-4`}>
            <div className="flex items-start gap-3">
              <Compass className={`w-5 h-5 ${nextStep.text} flex-shrink-0 mt-0.5`} />
              <div>
                <div className="text-xs font-medium text-text-muted uppercase tracking-wider mb-1">Recommended Next Step</div>
                <div className={`text-sm font-semibold ${nextStep.text}`}>{nextStep.label}</div>
                <div className="text-sm text-text-secondary mt-0.5">{nextStep.detail}</div>
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
              : { label: 'Triage and route — no safe fix path identified yet', icon: Compass, bg: 'bg-accent/10 border-accent/30', text: 'text-accent' }
            const StripIcon = strip.icon
            return (
              <div className={`flex items-center gap-2.5 px-4 py-2.5 rounded-lg border ${strip.bg}`}>
                <StripIcon className={`w-4 h-4 flex-shrink-0 ${strip.text}`} />
                <span className={`text-sm font-semibold ${strip.text}`}>{strip.label}</span>
              </div>
            )
          })()}

          {/* Diagnosis & Recommendation */}
          <div className="bg-surface rounded-lg border border-border p-4 space-y-4">
            <h3 className="text-sm font-medium text-text-primary">Diagnosis & Recommendation</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-surface-raised rounded p-3">
                <div className="text-xs text-text-muted mb-1">Likely Issue Type</div>
                <div className="text-sm font-medium text-text-primary">{incident.likelyIssueType}</div>
              </div>
              <div className="bg-surface-raised rounded p-3">
                <div className="text-xs text-text-muted mb-1">Root Cause Category</div>
                <div className="text-sm font-medium text-text-primary">{incident.rootCauseCategory}</div>
              </div>
            </div>
            <div className="bg-surface-raised rounded p-4">
              <div className="text-xs text-text-muted mb-2">Recommended Fix</div>
              <div className="text-sm text-text-primary leading-relaxed">{incident.recommendedFix}</div>
            </div>
            {incident.kbArticles.length > 0 && (
              <div>
                <div className="text-xs text-text-muted mb-2">Relevant KB Articles</div>
                <div className="space-y-1">
                  {incident.kbArticles.map(kb => (
                    <div key={kb} className="flex items-center gap-2 text-sm text-accent">
                      <BookOpen className="w-3.5 h-3.5" />{kb}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Execution Readiness */}
          <div className="bg-surface rounded-lg border border-border p-4 space-y-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-text-muted" />
              <h3 className="text-sm font-medium text-text-primary">Execution Readiness</h3>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-surface-raised rounded p-3">
                <div className="text-xs text-text-muted mb-1">Fix Type</div>
                <div className={`text-sm font-medium ${isConfigFix ? 'text-status-approved' : 'text-status-pending'}`}>
                  {isConfigFix ? 'Config Only' : 'Code Change'}
                </div>
              </div>
              <div className="bg-surface-raised rounded p-3">
                <div className="text-xs text-text-muted mb-1">Safe to Trigger?</div>
                <div className={`text-sm font-medium ${isConfigFix && !isHighSev ? 'text-status-approved' : 'text-status-pending'}`}>
                  {isConfigFix && !isHighSev ? 'Yes' : isConfigFix ? 'With Approval' : 'Needs Review'}
                </div>
              </div>
              <div className="bg-surface-raised rounded p-3">
                <div className="text-xs text-text-muted mb-1">Approval Required?</div>
                <div className={`text-sm font-medium ${isHighSev ? 'text-status-escalated' : 'text-text-primary'}`}>
                  {isHighSev ? 'Yes — High Sev' : isConfigFix ? 'Standard' : 'Yes'}
                </div>
              </div>
            </div>
            {isConfigFix && (
              <div className="text-xs text-text-secondary bg-surface-raised rounded px-3 py-2">
                Config-only remediations are auto-proposed by policy. Human approval is still required before execution.
              </div>
            )}
          </div>

          {/* Impact Assessment */}
          <div className="bg-surface rounded-lg border border-border p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-text-muted" />
              <h3 className="text-sm font-medium text-text-primary">Impact Assessment</h3>
            </div>
            <div className="space-y-3">
              <div>
                <div className="text-xs text-text-muted mb-2">Affected Configuration Items</div>
                <div className="flex flex-wrap gap-1.5">
                  {incident.relatedCI.map(ci => (
                    <SystemChip key={ci} name={ci} />
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-surface-raised rounded p-3">
                  <div className="text-xs text-text-muted mb-1">Blast Radius</div>
                  <div className="text-sm font-medium text-text-primary">
                    {incident.relatedCI.length} CI{incident.relatedCI.length !== 1 ? 's' : ''} impacted
                  </div>
                </div>
                <div className="bg-surface-raised rounded p-3">
                  <div className="text-xs text-text-muted mb-1">Related Changes</div>
                  <div className="text-sm font-medium text-text-primary">
                    {incident.relatedChanges.length > 0 ? (
                      <span className="text-accent">{incident.relatedChanges.length} linked</span>
                    ) : (
                      <span className="text-text-muted">None</span>
                    )}
                  </div>
                </div>
              </div>
              {incident.relatedChanges.length > 0 && (
                <div className="text-xs text-text-secondary bg-status-pending/10 border border-status-pending/20 rounded px-3 py-2">
                  This incident has linked changes. Review them to determine if the incident was caused by a recent deployment.
                </div>
              )}
            </div>
          </div>

          {/* Similar Incidents / Recurring Pattern */}
          {incident.isRecurring && (
            <div className="bg-surface rounded-lg border border-status-pending/30 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-status-pending" />
                <h3 className="text-sm font-medium text-status-pending">Recurring Pattern Detected</h3>
              </div>
              <div className="bg-surface-raised rounded p-3 space-y-2">
                <div className="text-sm text-text-primary leading-relaxed">
                  This issue has been reported multiple times. The pattern matches previous occurrences with the same root cause category: <span className="font-medium text-text-primary">{incident.rootCauseCategory}</span>.
                </div>
                <div className="text-sm text-text-secondary">
                  Consider a permanent fix or workflow adjustment to prevent recurrence. Review KB articles for documented remediation steps.
                </div>
              </div>
              {incident.kbArticles.length > 0 && (
                <div className="bg-status-pending/10 border border-status-pending/20 rounded px-3 py-2">
                  <div className="text-xs text-status-pending font-medium mb-1">Known Fix Available</div>
                  <div className="space-y-1">
                    {incident.kbArticles.map(kb => (
                      <div key={kb} className="flex items-center gap-2 text-sm text-accent">
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
            <div className={`bg-surface rounded-lg border p-4 space-y-4 ${
              (incident.isRecurring || isConfigFix)
                ? 'border-accent/40 ring-1 ring-accent/20'
                : 'border-border'
            }`}>
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-accent" />
                <h3 className="text-sm font-medium text-text-primary">Technical Remediation</h3>
                {(incident.isRecurring || isConfigFix) && (
                  <span className="ml-auto text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-accent/15 text-accent">
                    {isConfigFix ? 'Config-Only Fix' : 'Known Pattern'}
                  </span>
                )}
              </div>

              {/* Engineer view: full technical detail */}
              {role === 'engineer' || role === 'admin' ? (
                <>
                  {/* Proposed Fix — code/diff block */}
                  <div>
                    <div className="text-xs text-text-muted mb-2 font-medium uppercase tracking-wider">Proposed Fix</div>
                    <pre className="bg-[#0d1117] border border-border rounded-lg p-4 text-xs text-[#c9d1d9] font-mono leading-relaxed overflow-x-auto whitespace-pre">
                      {remediation.proposedFix}
                    </pre>
                  </div>

                  {/* Execution Plan */}
                  <div>
                    <div className="text-xs text-text-muted mb-2 font-medium uppercase tracking-wider">Execution Plan</div>
                    <ol className="space-y-1.5">
                      {remediation.executionPlan.map((step, i) => (
                        <li key={i} className="flex items-start gap-2.5">
                          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-accent/15 text-accent text-xs font-bold flex items-center justify-center mt-0.5">
                            {i + 1}
                          </span>
                          <span className="text-sm text-text-primary leading-relaxed">{step}</span>
                        </li>
                      ))}
                    </ol>
                  </div>

                  {/* Blast Radius */}
                  <div>
                    <div className="text-xs text-text-muted mb-2 font-medium uppercase tracking-wider">Blast Radius</div>
                    <div className="flex flex-wrap gap-1.5">
                      {remediation.blastRadius.map((item) => (
                        <span key={item} className="inline-flex items-center gap-1 px-2 py-1 rounded bg-surface-raised border border-border text-xs text-text-secondary">
                          <AlertTriangle className="w-3 h-3 text-status-pending" />
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Execution Mode + Approval + Safety grid */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-surface-raised rounded p-3">
                      <div className="text-xs text-text-muted mb-1">Execution Mode</div>
                      <div className="text-sm font-medium text-text-primary font-mono">{remediation.executionMode}</div>
                    </div>
                    <div className="bg-surface-raised rounded p-3">
                      <div className="text-xs text-text-muted mb-1">Approval Required</div>
                      <div className={`text-sm font-medium ${remediation.approvalRequired.required ? 'text-status-pending' : 'text-status-approved'}`}>
                        {remediation.approvalRequired.required ? 'Yes' : 'No'}
                      </div>
                      <div className="text-[11px] text-text-muted mt-0.5 leading-tight">{remediation.approvalRequired.reason}</div>
                    </div>
                    <div className="bg-surface-raised rounded p-3">
                      <div className="text-xs text-text-muted mb-1">Safe to Execute</div>
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
                    <div className="text-xs text-text-muted mb-2 font-medium uppercase tracking-wider">Remediation Plan</div>
                    <ol className="space-y-1.5">
                      {remediation.executionPlan.map((step, i) => (
                        <li key={i} className="flex items-start gap-2.5">
                          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-accent/15 text-accent text-xs font-bold flex items-center justify-center mt-0.5">
                            {i + 1}
                          </span>
                          <span className="text-sm text-text-primary leading-relaxed">{step}</span>
                        </li>
                      ))}
                    </ol>
                  </div>

                  {/* Compact approval status */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-surface-raised rounded p-3">
                      <div className="text-xs text-text-muted mb-1">Approval Status</div>
                      <div className={`text-sm font-medium ${remediation.approvalRequired.required ? 'text-status-pending' : 'text-status-approved'}`}>
                        {remediation.approvalRequired.required ? 'Approval Required' : 'Auto-Approved'}
                      </div>
                      <div className="text-[11px] text-text-muted mt-0.5 leading-tight">{remediation.approvalRequired.reason}</div>
                    </div>
                    <div className="bg-surface-raised rounded p-3">
                      <div className="text-xs text-text-muted mb-1">Safety Assessment</div>
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
        <div>
          <div className="bg-surface rounded-lg border border-border p-4 space-y-4">
            <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider">Actions <span className="text-accent">· {config.label}</span></h3>

            {/* Available Now */}
            {availableActions.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-medium text-status-approved uppercase tracking-wider">Available Now</h4>
                {availableActions.map(a => {
                  const Icon = a.icon
                  return (
                    <button
                      key={a.key}
                      onClick={() => setGuardModal({ open: true, title: a.label, description: a.desc })}
                      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-colors text-sm font-medium ${a.style}`}
                    >
                      <Icon className="w-4 h-4" /> {a.label}
                    </button>
                  )
                })}
              </div>
            )}

            {/* Requires Approval */}
            {requiresApproval.length > 0 && (
              <>
                <hr className="border-border" />
                <div className="space-y-2">
                  <h4 className="text-xs font-medium text-status-pending uppercase tracking-wider">Requires Approval</h4>
                  {requiresApproval.map(blocked => (
                    <div key={blocked.action} className="flex items-start gap-2 px-3 py-2 rounded-lg bg-status-pending/5 border border-status-pending/10 text-text-muted">
                      <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-status-pending" />
                      <div>
                        <div className="text-sm font-medium text-text-secondary">{blocked.label}</div>
                        <div className="text-xs">{blocked.reason}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Not Available */}
            {notAvailable.length > 0 && (
              <>
                <hr className="border-border" />
                <div className="space-y-2">
                  <h4 className="text-xs font-medium text-text-muted uppercase tracking-wider">Not Available</h4>
                  {notAvailable.map(blocked => (
                    <div key={blocked.action} className="flex items-start gap-2 px-3 py-2 rounded-lg text-text-muted">
                      <Ban className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <div>
                        <div className="text-sm font-medium">{blocked.label}</div>
                        <div className="text-xs">{blocked.reason}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Decision Impact — Approver only */}
          {(role === 'approver' || role === 'admin') && (
            <div className="bg-surface rounded-lg border border-accent/20 p-4 space-y-3 mt-4">
              <h3 className="text-xs font-medium text-accent uppercase tracking-wider flex items-center gap-1.5">
                <AlertTriangle className="w-3 h-3" />
                Decision Impact
              </h3>
              <div className="space-y-2">
                <div className="flex gap-2">
                  <CheckCircle className="w-3 h-3 text-status-approved flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="text-[10px] font-medium text-status-approved uppercase">If remediation approved</div>
                    <p className="text-xs text-text-secondary">
                      {remediation ? `Fix applied: ${remediation.executionMode}. ` : 'Recommended fix proceeds. '}
                      {incident.severity === 'sev1' || incident.severity === 'sev2' ? 'Active incident resolved faster.' : 'Issue resolved.'}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Ban className="w-3 h-3 text-status-denied flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="text-[10px] font-medium text-status-denied uppercase">If denied</div>
                    <p className="text-xs text-text-secondary">
                      {incident.severity === 'sev1' ? 'Sev1 incident remains unresolved. May trigger executive escalation.' :
                       incident.severity === 'sev2' ? 'Sev2 incident continues. Manual workaround needed.' :
                       'Incident requires alternative remediation path.'}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <ArrowUpRight className="w-3 h-3 text-status-escalated flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="text-[10px] font-medium text-status-escalated uppercase">If escalated</div>
                    <p className="text-xs text-text-secondary">Routes to SRE Lead for review. Incident SLA clock continues.</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Support Artifact Actions — IT Support only */}
          {role === 'it_support' && (
            <div className="bg-surface rounded-lg border border-border p-4 space-y-2 mt-4">
              <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider">Support Artifacts</h3>
              <button
                onClick={() => setGuardModal({ open: true, title: 'Draft Work Note', description: `Generate an internal work note summarizing triage status, diagnosis, and next steps for ${incident.incidentId}.` })}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
              >
                <ClipboardCopy className="w-4 h-4" /> Draft Work Note
              </button>
              <button
                onClick={() => setGuardModal({ open: true, title: 'Draft Customer Reply', description: `Generate a customer-facing status update for ${incident.incidentId} with ETA and impact summary.` })}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
              >
                <FileText className="w-4 h-4" /> Draft Customer Reply
              </button>
              <button
                onClick={() => setGuardModal({ open: true, title: 'Prepare Escalation Note', description: `Generate an escalation summary for ${incident.incidentId} including severity, impact, attempted actions, and recommended next owner.` })}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-status-escalated/10 text-status-escalated hover:bg-status-escalated/20 transition-colors"
              >
                <ArrowUpRight className="w-4 h-4" /> Prepare Escalation Note
              </button>
              {incident.kbArticles.length > 0 && (
                <button
                  onClick={() => setGuardModal({ open: true, title: 'Attach KB Article', description: `Link ${incident.kbArticles[0]} to ${incident.incidentId} and add remediation context from the article.` })}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-surface-raised text-text-secondary hover:bg-surface-overlay hover:text-text-primary transition-colors"
                >
                  <BookOpen className="w-4 h-4" /> Attach KB Article
                </button>
              )}
            </div>
          )}

          {/* Contextual Assistant */}
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
        </div>
      </div>

      {guardModal?.open && (
        <ActionGuardModal
          isOpen={true}
          title={guardModal.title}
          description={guardModal.description}
          confirmLabel="Confirm"
          onConfirm={() => setGuardModal(null)}
          onCancel={() => setGuardModal(null)}
          variant="info"
        />
      )}
    </div>
  )
}
