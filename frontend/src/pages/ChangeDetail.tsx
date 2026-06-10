import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft,
  GitPullRequest,
  GitBranch,
  ExternalLink,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  Eye,
  FileText,
  FilePlus,
  FileX,
  FilePen,
  Play,
  Ban,
  ArrowUpRight,
  MessageSquare,
  LayoutGrid,
  List,
  ShieldAlert,
  CircleDot,
  Zap,
  Lock,
  Server,
  CheckSquare,
  Square,
  Code,
  FlaskConical,
  Loader2,
  Minus,
  Plus,
} from 'lucide-react'
import { useChange } from '@/hooks/useData'
import { useChangeExecute, useChangeSimulate, useChangeEscalate, useTriageChangeAgent } from '@/hooks/useMutations'
import { ReanalyzeButton } from '@/components/shared'
import {
  RiskBadge,
  ApprovalBadge,
  PolicyBadge,
  SystemChip,
  OwnerChip,
  BlastRadiusItemRow,
  RecommendationCard,
  StatusTimeline,
  ActionGuardModal,
  BlastRadiusGraphPanel,
  ContextualAssistant,
} from '@/components/shared'
import { formatDate } from '@/lib/utils'
import { useRole, type ActionPermission } from '@/lib/roles'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion'
import { cn } from '@/lib/utils'

type Tab = 'assessment' | 'blast_radius' | 'recommendations' | 'execution' | 'audit' | 'artifacts'

// ---------------------------------------------------------------------------
// Mock data for engineer-specific artifact surfaces
// ---------------------------------------------------------------------------
interface FileImpact {
  path: string
  changeType: 'modified' | 'added' | 'deleted'
  linesAdded: number
  linesRemoved: number
}

interface CICheck {
  name: string
  status: 'pass' | 'fail' | 'pending'
  duration?: string
}

interface SimulationResult {
  status: 'completed' | 'pending' | 'not_run'
  dryRunSummary: string
  conflicts: string[]
  warnings: string[]
  executionPlan: { step: string; expectedOutcome: string }[]
}

const mockFilesImpacted: Record<string, FileImpact[]> = {
  'chg-001': [
    { path: 'src/config/feature-flags.yaml', changeType: 'modified', linesAdded: 3, linesRemoved: 1 },
    { path: 'src/services/payments/config.ts', changeType: 'modified', linesAdded: 8, linesRemoved: 2 },
    { path: 'tests/payments/feature-flags.test.ts', changeType: 'modified', linesAdded: 15, linesRemoved: 0 },
  ],
  'chg-002': [
    { path: 'migrations/2026_03_15_add_orders_v2.sql', changeType: 'added', linesAdded: 47, linesRemoved: 0 },
    { path: 'migrations/2026_03_15_migrate_orders_data.sql', changeType: 'added', linesAdded: 32, linesRemoved: 0 },
    { path: 'src/models/order.ts', changeType: 'modified', linesAdded: 24, linesRemoved: 8 },
    { path: 'src/repositories/orderRepository.ts', changeType: 'modified', linesAdded: 36, linesRemoved: 12 },
    { path: 'src/services/orderService.ts', changeType: 'modified', linesAdded: 18, linesRemoved: 6 },
    { path: 'tests/models/order.test.ts', changeType: 'modified', linesAdded: 42, linesRemoved: 15 },
    { path: 'docs/schema/orders-v2.md', changeType: 'added', linesAdded: 28, linesRemoved: 0 },
    { path: 'src/legacy/orderCompat.ts', changeType: 'deleted', linesAdded: 0, linesRemoved: 89 },
  ],
  'chg-003': [
    { path: 'k8s/monitoring/alertmanager-config.yaml', changeType: 'modified', linesAdded: 12, linesRemoved: 4 },
    { path: 'k8s/monitoring/prometheus-rules.yaml', changeType: 'modified', linesAdded: 8, linesRemoved: 2 },
  ],
  'chg-004': [
    { path: 'terraform/modules/iam/main.tf', changeType: 'modified', linesAdded: 6, linesRemoved: 1 },
    { path: 'terraform/modules/iam/variables.tf', changeType: 'modified', linesAdded: 4, linesRemoved: 0 },
  ],
}

const mockPatchPreview: Record<string, string> = {
  'chg-001': `--- a/src/config/feature-flags.yaml
+++ b/src/config/feature-flags.yaml
@@ -12,7 +12,9 @@
 features:
   payments_v2:
-    enabled: false
+    enabled: true
+    rollout_percentage: 25
+    canary_regions: ["us-east-1"]
     owner: platform-payments`,
  'chg-002': `--- /dev/null
+++ b/migrations/2026_03_15_add_orders_v2.sql
@@ -0,0 +1,47 @@
+-- Migration: orders_v2 schema
+-- Author: sarah.chen
+-- Ticket: CHG-2002
+
+BEGIN;
+
+CREATE TABLE orders_v2 (
+    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
+    customer_id   UUID NOT NULL REFERENCES customers(id),
+    status        VARCHAR(32) NOT NULL DEFAULT 'draft',
+    total_cents   BIGINT NOT NULL DEFAULT 0,
+    currency      VARCHAR(3) NOT NULL DEFAULT 'USD',
+    metadata      JSONB DEFAULT '{}',
+    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
+    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
+);
+
+CREATE INDEX idx_orders_v2_customer
+    ON orders_v2(customer_id);
+CREATE INDEX idx_orders_v2_status
+    ON orders_v2(status);
+CREATE INDEX idx_orders_v2_created
+    ON orders_v2(created_at DESC);
+
+-- Migrate existing data
+INSERT INTO orders_v2 (id, customer_id, status, total_cents, currency, created_at, updated_at)
+SELECT id, customer_id, status, amount_cents, 'USD', created_at, updated_at
+FROM orders
+WHERE deleted_at IS NULL;
+
+COMMIT;`,
  'chg-003': `--- a/k8s/monitoring/alertmanager-config.yaml
+++ b/k8s/monitoring/alertmanager-config.yaml
@@ -8,6 +8,10 @@
 receivers:
   - name: 'platform-critical'
     slack_configs:
+      - channel: '#platform-alerts-critical'
+        send_resolved: true
+    pagerduty_configs:
+      - service_key: '<REDACTED>'
+        severity: 'critical'`,
  'chg-004': `--- a/terraform/modules/iam/main.tf
+++ b/terraform/modules/iam/main.tf
@@ -15,6 +15,11 @@
 resource "aws_iam_role" "service_role" {
   name = var.role_name
+
+  inline_policy {
+    name   = "read-only-s3"
+    policy = data.aws_iam_policy_document.s3_read.json
+  }
 }`,
}

const mockPRStatus: Record<string, { branch: string; prState: 'open' | 'merged' | 'draft' | 'closed'; reviewStatus: 'approved' | 'changes_requested' | 'pending' | 'none'; mergeReady: boolean }> = {
  'chg-001': { branch: 'feat/enable-payments-v2-flag', prState: 'open', reviewStatus: 'approved', mergeReady: true },
  'chg-002': { branch: 'feat/orders-v2-schema-migration', prState: 'open', reviewStatus: 'changes_requested', mergeReady: false },
  'chg-003': { branch: 'fix/monitoring-alert-routing', prState: 'draft', reviewStatus: 'none', mergeReady: false },
  'chg-004': { branch: 'feat/iam-s3-read-policy', prState: 'open', reviewStatus: 'pending', mergeReady: false },
}

const mockCIChecks: Record<string, CICheck[]> = {
  'chg-001': [
    { name: 'Unit Tests', status: 'pass', duration: '1m 23s' },
    { name: 'Integration Tests', status: 'pass', duration: '4m 12s' },
    { name: 'Lint & Format', status: 'pass', duration: '32s' },
    { name: 'Security Scan', status: 'pass', duration: '2m 05s' },
    { name: 'Build', status: 'pass', duration: '1m 48s' },
  ],
  'chg-002': [
    { name: 'Unit Tests', status: 'pass', duration: '1m 45s' },
    { name: 'Integration Tests', status: 'fail', duration: '5m 38s' },
    { name: 'Lint & Format', status: 'pass', duration: '28s' },
    { name: 'Security Scan', status: 'pass', duration: '2m 11s' },
    { name: 'Migration Dry Run', status: 'fail', duration: '0m 52s' },
    { name: 'Build', status: 'pass', duration: '2m 02s' },
  ],
  'chg-003': [
    { name: 'Config Validation', status: 'pass', duration: '18s' },
    { name: 'Lint', status: 'pass', duration: '12s' },
    { name: 'Staging Deploy Preview', status: 'pending' },
  ],
  'chg-004': [
    { name: 'Terraform Plan', status: 'pass', duration: '1m 03s' },
    { name: 'Policy Check (OPA)', status: 'pending' },
    { name: 'Security Scan', status: 'pass', duration: '45s' },
  ],
}

const mockSimulationResults: Record<string, SimulationResult> = {
  'chg-001': {
    status: 'completed',
    dryRunSummary: 'Feature flag toggled in staging. 0 errors, 0 regressions detected across 12 test suites.',
    conflicts: [],
    warnings: ['Rollout percentage set to 25% — monitor error rates before expanding.'],
    executionPlan: [
      { step: 'Validate feature flag schema', expectedOutcome: 'Schema validation passes' },
      { step: 'Apply flag to staging environment', expectedOutcome: 'Flag enabled for 25% of traffic in us-east-1' },
      { step: 'Run smoke tests against staging', expectedOutcome: 'All payment endpoints return 200 OK' },
      { step: 'Promote to production', expectedOutcome: 'Flag live with canary region restriction' },
    ],
  },
  'chg-002': {
    status: 'completed',
    dryRunSummary: 'Migration simulation completed with 2 warnings. Schema changes applied successfully to shadow database. Data migration dry-run processed 145,203 rows.',
    conflicts: [
      'Column "amount_cents" in legacy table has 12 NULL values — will fail NOT NULL constraint on orders_v2.total_cents',
      'Index idx_orders_v2_customer may conflict with existing partial index on orders table',
    ],
    warnings: [
      'Estimated migration time: ~8 minutes for 145K rows — consider batched execution',
      'Foreign key to customers table will acquire ROW SHARE lock during migration',
    ],
    executionPlan: [
      { step: 'Acquire advisory lock', expectedOutcome: 'Lock acquired, prevents concurrent migrations' },
      { step: 'Create orders_v2 table', expectedOutcome: 'Table created with all indexes' },
      { step: 'Migrate existing data (batched)', expectedOutcome: '145,203 rows migrated in ~8 min' },
      { step: 'Validate row counts', expectedOutcome: 'Source and target counts match' },
      { step: 'Swap table references', expectedOutcome: 'Application reads from orders_v2' },
      { step: 'Verify application health', expectedOutcome: 'All health checks pass within 60s' },
    ],
  },
  'chg-003': {
    status: 'pending',
    dryRunSummary: 'Simulation queued — waiting for staging cluster availability.',
    conflicts: [],
    warnings: [],
    executionPlan: [
      { step: 'Validate alertmanager config syntax', expectedOutcome: 'Config passes amtool check' },
      { step: 'Apply to staging alertmanager', expectedOutcome: 'Config reload successful' },
      { step: 'Send test alert', expectedOutcome: 'Alert routes to correct Slack channel' },
    ],
  },
  'chg-004': {
    status: 'not_run',
    dryRunSummary: 'Simulation has not been initiated for this change.',
    conflicts: [],
    warnings: [],
    executionPlan: [
      { step: 'Run terraform plan', expectedOutcome: '2 resources to add, 0 to change, 0 to destroy' },
      { step: 'Validate IAM policy document', expectedOutcome: 'Policy allows s3:GetObject and s3:ListBucket only' },
      { step: 'Apply in staging account', expectedOutcome: 'Role updated with new inline policy' },
    ],
  },
}

// ---------------------------------------------------------------------------
// Next-step logic — determines the single most important operator action
// ---------------------------------------------------------------------------
function getNextStep(change: (typeof mockChanges)[number]): {
  icon: typeof ShieldAlert
  label: string
  description: string
  tone: 'critical' | 'warning' | 'info' | 'success'
} {
  if (change.policyDecision === 'deny') {
    return {
      icon: Ban,
      label: 'Escalate to senior review',
      description: 'Policy has blocked this change — escalation is required before any further action.',
      tone: 'critical',
    }
  }
  if (change.policyDecision === 'escalate') {
    return {
      icon: ArrowUpRight,
      label: 'Request engineering review',
      description: 'High blast radius requires sign-off from an engineering lead before proceeding.',
      tone: 'warning',
    }
  }
  if (!change.rollbackPlan) {
    return {
      icon: AlertTriangle,
      label: 'Request rollback plan',
      description: 'A rollback plan is required before approval can proceed. Ask the owner to attach one.',
      tone: 'warning',
    }
  }
  if (change.approvalState === 'pending') {
    return {
      icon: Clock,
      label: 'Route for approval',
      description: 'Assessment is complete — route this change for approver sign-off.',
      tone: 'info',
    }
  }
  if (change.ciStatus === 'failing') {
    return {
      icon: XCircle,
      label: 'Wait for CI',
      description: 'Build must pass before this change can move forward. Monitor the pipeline.',
      tone: 'warning',
    }
  }
  return {
    icon: Play,
    label: 'Ready to simulate',
    description: 'All checks passed — safe to run a dry-run simulation.',
    tone: 'success',
  }
}

const toneBorder: Record<string, string> = {
  critical: 'border-risk-critical/40',
  warning: 'border-risk-high/40',
  info: 'border-accent/40',
  success: 'border-status-approved/40',
}
const toneBg: Record<string, string> = {
  critical: 'bg-risk-critical/10',
  warning: 'bg-risk-high/10',
  info: 'bg-primary/10',
  success: 'bg-status-approved/10',
}
const toneText: Record<string, string> = {
  critical: 'text-risk-critical',
  warning: 'text-risk-high',
  info: 'text-primary',
  success: 'text-status-approved',
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function ChangeDetail() {
  const { id } = useParams<{ id: string }>()
  const [activeTab, setActiveTab] = useState<Tab>('assessment')
  const [blastView, setBlastView] = useState<'graph' | 'list'>('graph')
  const [guardModal, setGuardModal] = useState<{ open: boolean; title: string; description: string; action: () => void } | null>(null)
  const { role, canAction, getBlockedActions, getActionPermission, config } = useRole()

  const { data: change, isLoading } = useChange(id!)
  const executeChange = useChangeExecute()
  const simulateChange = useChangeSimulate()
  const escalateChange = useChangeEscalate()
  const triageAgent = useTriageChangeAgent()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Loading change...</p>
      </div>
    )
  }

  if (!change) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Change not found</p>
      </div>
    )
  }

  const ciIcon = change.ciStatus === 'passing' ? CheckCircle : change.ciStatus === 'failing' ? XCircle : Clock
  const ciColor = change.ciStatus === 'passing' ? 'text-status-approved' : change.ciStatus === 'failing' ? 'text-risk-critical' : 'text-status-pending'
  const CIIcon = ciIcon

  const isEngineerOrAdmin = role === 'engineer' || role === 'admin'

  const filesImpacted = mockFilesImpacted[change.id] ?? []
  const patchPreview = mockPatchPreview[change.id] ?? ''
  const prStatus = mockPRStatus[change.id]
  const ciChecks = mockCIChecks[change.id] ?? []
  const simulation = mockSimulationResults[change.id]

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'assessment', label: 'Assessment' },
    { id: 'blast_radius', label: 'Blast Radius', count: change.blastRadius.length },
    { id: 'recommendations', label: 'Recommendations', count: change.recommendations.length },
    { id: 'execution', label: 'Execution' },
    { id: 'audit', label: 'Audit', count: change.auditEvents.length },
    { id: 'artifacts', label: 'Code & PR', count: filesImpacted.length || undefined },
  ]

  const handleAction = (actionKey: string, title: string, description: string) => {
    if (actionKey === 'simulate') {
      setGuardModal({
        open: true,
        title: 'Run Simulation',
        description,
        action: () => {
          simulateChange.mutate(change!.id)
          setGuardModal(null)
        },
      })
    } else if (actionKey === 'escalate') {
      setGuardModal({
        open: true,
        title: 'Escalate Change',
        description,
        action: () => {
          escalateChange.mutate({ changeId: change!.id })
          setGuardModal(null)
        },
      })
    } else if (actionKey === 'execute') {
      setGuardModal({
        open: true,
        title: 'Execute Change',
        description: 'This will deploy the change to the target environment.',
        action: () => {
          executeChange.mutate(change!.id)
          setGuardModal(null)
        },
      })
    } else {
      setGuardModal({ open: true, title, description, action: () => setGuardModal(null) })
    }
  }

  // --- Next step ---
  const nextStep = getNextStep(change)
  const NextStepIcon = nextStep.icon

  // --- Risk factors ---
  const riskFactors: { label: string; present: boolean; severity: 'critical' | 'high' | 'medium' }[] = [
    { label: 'Policy has blocked execution', present: change.policyDecision === 'deny', severity: 'critical' },
    { label: 'Policy requires escalation', present: change.policyDecision === 'escalate', severity: 'high' },
    { label: 'Missing rollback plan', present: !change.rollbackPlan, severity: 'high' },
    { label: 'CI pipeline failing', present: change.ciStatus === 'failing', severity: 'high' },
    { label: 'High blast radius (5+ systems)', present: change.blastRadius.length >= 5, severity: 'medium' },
    { label: 'No linked pull requests', present: change.linkedPRs.length === 0, severity: 'medium' },
    { label: 'No maintenance window scheduled', present: !change.maintenanceWindow, severity: 'medium' },
  ]
  const activeRisks = riskFactors.filter(r => r.present)

  // --- Readiness checklist ---
  const readiness: { label: string; met: boolean }[] = [
    { label: 'CI pipeline passing', met: change.ciStatus === 'passing' },
    { label: 'Rollback plan attached', met: change.rollbackPlan },
    { label: 'Maintenance window scheduled', met: !!change.maintenanceWindow },
    { label: 'Pull request linked', met: change.linkedPRs.length > 0 },
    { label: 'Approval granted', met: change.approvalState === 'approved' },
    { label: 'Policy allows execution', met: change.policyDecision === 'allow' },
  ]
  const readinessMet = readiness.filter(r => r.met).length
  const readinessTotal = readiness.length

  // --- Actions split into available / requires-approval ---
  const allActions = [
    { key: 'approve', permission: 'approve', label: 'Approve for Draft', icon: CheckCircle, style: 'bg-status-approved/10 text-status-approved hover:bg-status-approved/20', disabled: change.policyDecision === 'deny', desc: 'This will mark the change as approved for draft mode. No production changes will be made.' },
    { key: 'request_review', permission: 'request_review', label: 'Request Review', icon: Eye, style: 'bg-primary/10 text-primary hover:bg-primary/20', desc: 'This will send the change for peer review.' },
    { key: 'simulate', permission: 'simulate', label: 'Simulate Only', icon: Play, style: 'bg-status-simulated/10 text-status-simulated hover:bg-status-simulated/20', desc: 'Run a dry-run simulation of this change.' },
    { key: 'open_pr', permission: 'open_pr', label: 'Open PR', icon: FileText, style: 'bg-muted text-foreground/80 hover:bg-primary hover:text-foreground', desc: 'Create a pull request for the generated changes.' },
    { key: 'block', permission: 'block', label: 'Block', icon: Ban, style: 'bg-risk-critical/10 text-risk-critical hover:bg-risk-critical/20', desc: 'This will block the change and prevent further execution.' },
    { key: 'escalate', permission: 'escalate', label: 'Escalate', icon: ArrowUpRight, style: 'bg-status-escalated/10 text-status-escalated hover:bg-status-escalated/20', desc: 'Escalate this change for senior review and approval.' },
    { key: 'attach_notes', permission: 'attach_notes', label: 'Attach Notes', icon: MessageSquare, style: 'bg-muted text-foreground/80 hover:bg-primary hover:text-foreground', desc: 'Add notes to this change.' },
  ] as const

  const availableActions = allActions.filter(a => canAction(a.permission))
  const blockedActionKeys = new Set(getBlockedActions().map(b => b.action))
  const requiresApprovalActions = allActions.filter(a => blockedActionKeys.has(a.permission))

  return (
    <div className="flex flex-col gap-10">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Link
          to="/changes"
          className="mt-1 flex h-9 w-9 items-center justify-center rounded-md hover:bg-muted transition-colors"
        >
          <ArrowLeft className="h-5 w-5 text-muted-foreground" />
        </Link>
        <div className="flex-1 min-w-0 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-mono text-muted-foreground">{change.ticketId}</span>
            <RiskBadge level={change.riskLevel} />
            <ApprovalBadge state={change.approvalState} />
            <PolicyBadge decision={change.policyDecision} />
          </div>
          <h1 className="font-heading text-3xl font-medium tracking-tight text-foreground break-words">
            {change.title}
          </h1>
          <p className="text-sm text-muted-foreground break-words">{change.description}</p>
        </div>
      </div>

      {/* Three-column layout */}
      <div className="grid grid-cols-[280px_1fr_280px] gap-5">
        {/* Left: Context */}
        <div className="space-y-4">
          <div className="bg-card rounded-lg border border-border p-4 space-y-4">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Change Context</h3>

            <div className="space-y-3">
              <div>
                <div className="text-xs text-muted-foreground">Owner</div>
                <OwnerChip name={change.owner} />
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Team</div>
                <div className="text-sm text-foreground">{change.ownerTeam}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Service</div>
                <SystemChip name={change.service} />
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Environment</div>
                <span className="text-sm text-foreground capitalize">{change.environment}</span>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">CI Status</div>
                <div className="flex items-center gap-1.5">
                  <CIIcon className={`w-4 h-4 ${ciColor}`} />
                  <span className="text-sm text-foreground capitalize">{change.ciStatus}</span>
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Linked PRs</div>
                {change.linkedPRs.map(pr => (
                  <div key={pr} className="flex items-center gap-1 text-sm text-primary">
                    <GitPullRequest className="w-3.5 h-3.5" />
                    {pr}
                    <ExternalLink className="w-3 h-3" />
                  </div>
                ))}
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Maintenance Window</div>
                <div className="text-sm text-foreground">{change.maintenanceWindow || 'None scheduled'}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Rollback Plan</div>
                <div className="flex items-center gap-1.5">
                  {change.rollbackPlan ? (
                    <><CheckCircle className="w-4 h-4 text-status-approved" /><span className="text-sm text-status-approved">Available</span></>
                  ) : (
                    <><AlertTriangle className="w-4 h-4 text-risk-high" /><span className="text-sm text-risk-high">Missing</span></>
                  )}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Created</div>
                <div className="text-sm text-foreground/80">{formatDate(change.createdAt)}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Center: Assessment content */}
        <div className="flex flex-col gap-6 min-w-0">
          {/* ── Recommended Next Step callout ── */}
          <div className={`rounded-lg border ${toneBorder[nextStep.tone]} ${toneBg[nextStep.tone]} p-4 flex items-start gap-3`}>
            <NextStepIcon className={`w-5 h-5 mt-0.5 flex-shrink-0 ${toneText[nextStep.tone]}`} />
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recommended Next Step</span>
              </div>
              <div className={`text-sm font-semibold ${toneText[nextStep.tone]}`}>{nextStep.label}</div>
              <p className="text-xs text-foreground/80 mt-0.5">{nextStep.description}</p>
            </div>
          </div>

          {/* Tabs — segmented nav with vertical dividers + flex-1 spread
              so each section breathes evenly across the row. */}
          <div className="flex h-11 items-stretch rounded-lg border bg-card p-1 shadow-sm overflow-x-auto">
            {tabs.map((tab, i) => (
              <div key={tab.id} className="flex flex-1 items-stretch min-w-0">
                {i > 0 && activeTab !== tab.id && activeTab !== tabs[i - 1].id && (
                  <span className="my-1.5 w-px bg-border flex-shrink-0" />
                )}
                <button
                  onClick={() => setActiveTab(tab.id)}
                  data-active={activeTab === tab.id ? '' : undefined}
                  className="group inline-flex h-full w-full flex-1 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium text-muted-foreground transition-all hover:text-foreground hover:bg-muted/60 data-active:bg-primary data-active:text-primary-foreground data-active:shadow-sm data-active:hover:bg-primary whitespace-nowrap"
                >
                  {tab.label}
                  {tab.count !== undefined && (
                    <span className={`inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded px-1.5 text-xs font-semibold tabular-nums transition-colors ${
                      activeTab === tab.id
                        ? 'bg-white/25 text-primary-foreground'
                        : 'bg-muted text-foreground/85 group-hover:bg-foreground/10'
                    }`}>
                      {tab.count}
                    </span>
                  )}
                </button>
              </div>
            ))}
          </div>

          {/* ── Assessment tab ── */}
          {activeTab === 'assessment' && (
            <div className="flex flex-col gap-4">
              {/* Summary card — always visible, no accordion */}
              <Card>
                <CardHeader className="border-b">
                  <CardTitle className="text-sm font-semibold">Change Assessment Summary</CardTitle>
                </CardHeader>
                <CardContent className="py-4">
                  <p className="text-sm text-foreground/85 leading-relaxed">{change.description}</p>
                </CardContent>
              </Card>

              {/* Remaining sections collapsible. Affected Systems + Risk Factors
                  open by default since they carry the headline data; the other
                  two collapse so the page is not overwhelming. */}
              <Card className="py-0">
                <Accordion type="multiple" defaultValue={['systems', 'risks']}>
                  <AccordionItem value="systems" className="border-b last:border-b-0">
                    <AccordionTrigger className="px-6 text-sm font-semibold">
                      <span className="flex items-center gap-2">
                        <Server className="h-4 w-4 text-muted-foreground" />
                        Affected Systems
                        <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-muted px-1.5 text-xs font-semibold tabular-nums text-foreground/80">
                          {change.blastRadius.length}
                        </span>
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="px-6 pb-5">
                      <div className="flex flex-wrap gap-2">
                        {change.blastRadius.map(item => (
                          <div
                            key={item.id}
                            className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-1.5"
                          >
                            <CircleDot className={`h-3 w-3 ${
                              item.criticality === 'critical' ? 'text-risk-critical' :
                              item.criticality === 'high' ? 'text-risk-high' :
                              item.criticality === 'medium' ? 'text-risk-medium' :
                              'text-risk-low'
                            }`} />
                            <span className="text-xs font-medium text-foreground">{item.name}</span>
                            <span className="text-xs text-muted-foreground capitalize">({item.type})</span>
                          </div>
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem value="risks" className="border-b last:border-b-0">
                    <AccordionTrigger className="px-6 text-sm font-semibold">
                      <span className="flex items-center gap-2">
                        <ShieldAlert className="h-4 w-4 text-muted-foreground" />
                        Risk Factors
                        {activeRisks.length > 0 ? (
                          <span className="inline-flex h-5 items-center rounded-full bg-risk-high/15 px-2 text-xs font-semibold text-risk-high">
                            {activeRisks.length} active
                          </span>
                        ) : (
                          <span className="inline-flex h-5 items-center rounded-full bg-status-approved/15 px-2 text-xs font-semibold text-status-approved">
                            clear
                          </span>
                        )}
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="px-6 pb-5 flex flex-col gap-2">
                      {activeRisks.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No risk factors detected. This change looks safe to proceed.</p>
                      ) : (
                        activeRisks.map((risk, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <AlertTriangle className={`h-3.5 w-3.5 flex-shrink-0 ${
                              risk.severity === 'critical' ? 'text-risk-critical' :
                              risk.severity === 'high' ? 'text-risk-high' : 'text-risk-medium'
                            }`} />
                            <span className="text-sm text-foreground/85">{risk.label}</span>
                          </div>
                        ))
                      )}
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem value="readiness" className="border-b last:border-b-0">
                    <AccordionTrigger className="px-6 text-sm font-semibold">
                      <span className="flex items-center gap-2">
                        <Zap className="h-4 w-4 text-muted-foreground" />
                        Evidence & Readiness
                        <span className="ml-1 inline-flex h-5 items-center rounded-full bg-muted px-2 text-xs font-semibold text-muted-foreground">
                          {readinessMet}/{readinessTotal}
                        </span>
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="px-6 pb-5 flex flex-col gap-3">
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-full rounded-full transition-all ${
                            readinessMet === readinessTotal ? 'bg-status-approved' :
                            readinessMet >= readinessTotal / 2 ? 'bg-primary' : 'bg-risk-high'
                          }`}
                          style={{ width: `${(readinessMet / readinessTotal) * 100}%` }}
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        {readiness.map((item, i) => (
                          <div key={i} className="flex items-center gap-2">
                            {item.met ? (
                              <CheckSquare className="h-3.5 w-3.5 flex-shrink-0 text-status-approved" />
                            ) : (
                              <Square className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                            )}
                            <span className={`text-sm ${item.met ? 'text-foreground/85' : 'text-muted-foreground'}`}>
                              {item.label}
                            </span>
                          </div>
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem value="approvals" className="border-b last:border-b-0">
                    <AccordionTrigger className="px-6 text-sm font-semibold">
                      <span className="flex items-center gap-2">
                        <Lock className="h-4 w-4 text-muted-foreground" />
                        Linked Approvals
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="px-6 pb-5 flex flex-col gap-2">
                      <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <ApprovalBadge state={change.approvalState} />
                          <span className="text-sm text-foreground capitalize">Change Approval</span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {change.approvalState === 'approved' && 'Approved — ready to proceed'}
                          {change.approvalState === 'pending' && 'Waiting for approver sign-off'}
                          {change.approvalState === 'denied' && 'Denied — cannot proceed'}
                          {change.approvalState === 'not_required' && 'No approval required'}
                        </span>
                      </div>
                      {change.policyDecision === 'deny' && (
                        <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <PolicyBadge decision={change.policyDecision} />
                            <span className="text-sm text-foreground">Policy Override</span>
                          </div>
                          <span className="text-xs text-risk-critical">Blocked — needs senior escalation</span>
                        </div>
                      )}
                      {change.policyDecision === 'escalate' && (
                        <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <PolicyBadge decision={change.policyDecision} />
                            <span className="text-sm text-foreground">Escalation Review</span>
                          </div>
                          <span className="text-xs text-status-escalated">Pending engineering review</span>
                        </div>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </Card>
            </div>
          )}

          {activeTab === 'blast_radius' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium text-foreground">Impact Map</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">Systems affected by this change</p>
                </div>
                <div className="flex items-center gap-1 bg-card rounded-lg border border-border p-0.5">
                  <button
                    onClick={() => setBlastView('graph')}
                    className={`p-1.5 rounded transition-colors ${blastView === 'graph' ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground/80'}`}
                  >
                    <LayoutGrid className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setBlastView('list')}
                    className={`p-1.5 rounded transition-colors ${blastView === 'list' ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground/80'}`}
                  >
                    <List className="w-4 h-4" />
                  </button>
                </div>
              </div>
              {blastView === 'graph' ? (
                <BlastRadiusGraphPanel items={change.blastRadius} serviceName={change.service} />
              ) : (
                <div className="bg-card rounded-lg border border-border overflow-hidden divide-y divide-border">
                  {change.blastRadius.map(item => (
                    <BlastRadiusItemRow key={item.id} item={item} />
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'recommendations' && (
            <div className="space-y-3">
              {change.recommendations.map(rec => (
                <RecommendationCard key={rec.id} recommendation={rec} />
              ))}
            </div>
          )}

          {activeTab === 'execution' && (
            <div className="bg-card rounded-lg border border-border p-4">
              <h3 className="text-sm font-medium text-foreground mb-3">Execution Log</h3>
              <p className="text-sm text-muted-foreground">No execution actions taken yet.</p>
            </div>
          )}

          {activeTab === 'audit' && (
            <div className="bg-card rounded-lg border border-border overflow-hidden">
              <div className="px-4 py-3 border-b border-border">
                <h3 className="text-sm font-medium text-foreground">Audit Trail</h3>
              </div>
              <StatusTimeline
                events={change.auditEvents.map(e => ({
                  id: e.id,
                  timestamp: e.timestamp,
                  action: e.action,
                  actor: e.actor,
                  result: e.result,
                }))}
              />
            </div>
          )}

          {/* ── Code & PR / Artifacts tab ── */}
          {activeTab === 'artifacts' && (
            <div className="space-y-4">
              {/* PR & Branch Status */}
              {prStatus && (
                <div className="bg-card rounded-lg border border-border p-4 space-y-3">
                  <h3 className="text-sm font-medium text-foreground flex items-center gap-2">
                    <GitPullRequest className="w-4 h-4 text-primary" />
                    Pull Request Status
                  </h3>
                  <div className="grid grid-cols-4 gap-4">
                    <div>
                      <div className="text-xs text-muted-foreground">Branch</div>
                      <div className="text-sm text-foreground font-mono truncate">{prStatus.branch}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">PR State</div>
                      <span className={`inline-flex items-center gap-1 text-sm font-medium ${
                        prStatus.prState === 'merged' ? 'text-status-approved' :
                        prStatus.prState === 'open' ? 'text-primary' :
                        prStatus.prState === 'draft' ? 'text-muted-foreground' :
                        'text-risk-critical'
                      }`}>
                        <GitBranch className="w-3.5 h-3.5" />
                        {prStatus.prState}
                      </span>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Review</div>
                      <span className={`text-sm font-medium ${
                        prStatus.reviewStatus === 'approved' ? 'text-status-approved' :
                        prStatus.reviewStatus === 'changes_requested' ? 'text-risk-high' :
                        prStatus.reviewStatus === 'pending' ? 'text-status-pending' :
                        'text-muted-foreground'
                      }`}>
                        {prStatus.reviewStatus === 'none' ? '—' : prStatus.reviewStatus.replace('_', ' ')}
                      </span>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Merge Ready</div>
                      <span className={`text-sm font-medium ${prStatus.mergeReady ? 'text-status-approved' : 'text-muted-foreground'}`}>
                        {prStatus.mergeReady ? 'Yes' : 'No'}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* CI Checks */}
              {ciChecks.length > 0 && (
                <div className="bg-card rounded-lg border border-border p-4 space-y-3">
                  <h3 className="text-sm font-medium text-foreground flex items-center gap-2">
                    <FlaskConical className="w-4 h-4 text-primary" />
                    CI Pipeline
                    <span className={`text-xs px-2 py-1 rounded ${
                      ciChecks.every(c => c.status === 'pass') ? 'bg-status-approved/10 text-status-approved' :
                      ciChecks.some(c => c.status === 'fail') ? 'bg-risk-critical/10 text-risk-critical' :
                      'bg-status-pending/10 text-status-pending'
                    }`}>
                      {ciChecks.filter(c => c.status === 'pass').length}/{ciChecks.length} passing
                    </span>
                  </h3>
                  <div className="divide-y divide-border/50">
                    {ciChecks.map((check) => (
                      <div key={check.name} className="flex items-center justify-between py-2">
                        <div className="flex items-center gap-2">
                          {check.status === 'pass' && <CheckCircle className="w-4 h-4 text-status-approved" />}
                          {check.status === 'fail' && <XCircle className="w-4 h-4 text-risk-critical" />}
                          {check.status === 'pending' && <Loader2 className="w-4 h-4 text-status-pending animate-spin" />}
                          <span className="text-sm text-foreground">{check.name}</span>
                        </div>
                        {check.duration && <span className="text-xs text-muted-foreground font-mono">{check.duration}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Files Impacted */}
              {filesImpacted.length > 0 && (
                <div className="bg-card rounded-lg border border-border p-4 space-y-3">
                  <h3 className="text-sm font-medium text-foreground flex items-center gap-2">
                    <FileText className="w-4 h-4 text-primary" />
                    Files Impacted
                    <span className="text-xs text-muted-foreground">({filesImpacted.length} files)</span>
                  </h3>
                  <div className="divide-y divide-border/50">
                    {filesImpacted.map((file) => (
                      <div key={file.path} className="flex items-center justify-between py-2 gap-3">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          {file.changeType === 'added' && <FilePlus className="w-4 h-4 text-status-approved flex-shrink-0" />}
                          {file.changeType === 'modified' && <FilePen className="w-4 h-4 text-status-pending flex-shrink-0" />}
                          {file.changeType === 'deleted' && <FileX className="w-4 h-4 text-risk-critical flex-shrink-0" />}
                          <span className="text-sm text-foreground font-mono truncate">{file.path}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs font-mono flex-shrink-0">
                          {file.linesAdded > 0 && <span className="text-status-approved">+{file.linesAdded}</span>}
                          {file.linesRemoved > 0 && <span className="text-risk-critical">−{file.linesRemoved}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-4 pt-2 border-t border-border/50 text-xs text-muted-foreground">
                    <span className="text-status-approved">+{filesImpacted.reduce((s, f) => s + f.linesAdded, 0)}</span>
                    <span className="text-risk-critical">−{filesImpacted.reduce((s, f) => s + f.linesRemoved, 0)}</span>
                    <span>across {filesImpacted.length} files</span>
                  </div>
                </div>
              )}

              {/* Patch Preview */}
              {patchPreview && (
                <div className="bg-card rounded-lg border border-border overflow-hidden">
                  <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                    <h3 className="text-sm font-medium text-foreground flex items-center gap-2">
                      <Code className="w-4 h-4 text-primary" />
                      Diff Preview
                    </h3>
                    <span className="text-xs text-muted-foreground">Proposed changes</span>
                  </div>
                  <pre className="p-4 text-xs font-mono text-foreground/80 overflow-x-auto leading-relaxed bg-muted">
                    {patchPreview.split('\n').map((line, i) => (
                      <div key={i} className={
                        line.startsWith('+') && !line.startsWith('+++') ? 'text-status-approved' :
                        line.startsWith('-') && !line.startsWith('---') ? 'text-risk-critical' :
                        line.startsWith('@@') ? 'text-primary' :
                        ''
                      }>
                        {line}
                      </div>
                    ))}
                  </pre>
                </div>
              )}

              {/* Simulation Results */}
              {simulation && (
                <div className={`bg-card rounded-lg border ${
                  simulation.status === 'completed' && simulation.conflicts.length > 0 ? 'border-risk-high/40' :
                  simulation.status === 'completed' ? 'border-status-approved/40' :
                  simulation.status === 'pending' ? 'border-status-pending/40' :
                  'border-border'
                } p-4 space-y-3`}>
                  <h3 className="text-sm font-medium text-foreground flex items-center gap-2">
                    <FlaskConical className="w-4 h-4 text-primary" />
                    Simulation Results
                    <span className={`text-xs px-2 py-1 rounded ${
                      simulation.status === 'completed' ? 'bg-status-approved/10 text-status-approved' :
                      simulation.status === 'pending' ? 'bg-status-pending/10 text-status-pending' :
                      'bg-muted text-muted-foreground'
                    }`}>
                      {simulation.status === 'not_run' ? 'Not run' : simulation.status}
                    </span>
                  </h3>

                  <p className="text-sm text-foreground/80">{simulation.dryRunSummary}</p>

                  {simulation.conflicts.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="text-xs font-medium text-risk-critical uppercase tracking-wider">Conflicts ({simulation.conflicts.length})</div>
                      {simulation.conflicts.map((c, i) => (
                        <div key={i} className="flex items-start gap-2 text-sm text-foreground/80 bg-risk-critical/5 border border-risk-critical/20 rounded p-2">
                          <XCircle className="w-3.5 h-3.5 text-risk-critical flex-shrink-0 mt-0.5" />
                          <span>{c}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {simulation.warnings.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="text-xs font-medium text-risk-high uppercase tracking-wider">Warnings ({simulation.warnings.length})</div>
                      {simulation.warnings.map((w, i) => (
                        <div key={i} className="flex items-start gap-2 text-sm text-foreground/80 bg-risk-high/5 border border-risk-high/20 rounded p-2">
                          <AlertTriangle className="w-3.5 h-3.5 text-risk-high flex-shrink-0 mt-0.5" />
                          <span>{w}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {simulation.executionPlan.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Execution Plan</div>
                      {simulation.executionPlan.map((step, i) => (
                        <div key={i} className="flex items-start gap-3 text-sm">
                          <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center flex-shrink-0 mt-0.5 font-medium">{i + 1}</span>
                          <div className="min-w-0">
                            <div className="text-foreground">{step.step}</div>
                            <div className="text-xs text-muted-foreground mt-0.5">{step.expectedOutcome}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: Actions */}
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="text-sm font-semibold">AI Analysis</CardTitle>
            </CardHeader>
            <CardContent className="py-4">
              <ReanalyzeButton
                kind="change"
                entityIdOrTicket={change.ticketId}
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

          {/* Sentinel mini assistant — high up so common asks one click away. */}
          <ContextualAssistant
            entityType="change"
            entityId={change.id}
            entityTitle={change.title}
            quickActions={[
              { label: 'Assess risk', prompt: `What is the risk assessment for ${change.ticketId}?` },
              { label: 'Blast radius?', prompt: `What systems are affected by ${change.ticketId}?` },
              { label: 'Route for review', prompt: `Who should review ${change.ticketId}? Draft the routing.` },
            ]}
          />

          {availableActions.length > 0 && (
            <Card>
              <CardHeader className="border-b">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-sm font-semibold">Available Now</CardTitle>
                  <Badge variant="secondary" className="text-[10px] uppercase tracking-wider">{config.label}</Badge>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 py-4">
                {availableActions.map(a => {
                  const Icon = a.icon
                  return (
                    <button
                      key={a.key}
                      onClick={() => handleAction(a.key, a.label, a.desc)}
                      disabled={a.disabled}
                      className={`flex h-11 w-full items-center gap-3 rounded-md px-4 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${a.style}`}
                    >
                      <Icon className="h-4 w-4 flex-shrink-0" />
                      <span className="flex-1 text-left">{a.label}</span>
                    </button>
                  )
                })}
              </CardContent>
            </Card>
          )}

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
                  label="If approved"
                  tone="text-status-approved"
                  text={
                    (change.status === 'approved' ? 'Change proceeds to controlled execution. ' : 'Change moves to approved state. ') +
                    `${change.blastRadius.length} system${change.blastRadius.length !== 1 ? 's' : ''} affected.` +
                    (change.rollbackPlan ? ' Rollback plan is ready.' : ' No rollback plan attached.')
                  }
                />
                <ImpactRow
                  icon={<XCircle className="h-4 w-4 text-status-denied" />}
                  label="If denied"
                  tone="text-status-denied"
                  text={`Change blocked. ${change.owner} notified. ${change.ticketId} returns to draft state.`}
                />
                <ImpactRow
                  icon={<ArrowUpRight className="h-4 w-4 text-status-escalated" />}
                  label="If escalated"
                  tone="text-status-escalated"
                  text={`Routes to ${change.riskLevel === 'critical' ? 'VP Engineering' : 'senior reviewer'}. SLA clock pauses.`}
                />
              </CardContent>
            </Card>
          )}

          {requiresApprovalActions.length > 0 && (
            <Card>
              <CardHeader className="border-b">
                <CardTitle className="text-sm font-semibold">Requires Approval</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 py-4">
                {requiresApprovalActions.map(a => {
                  const Icon = a.icon
                  const blocked = getBlockedActions().find(b => b.action === a.permission)
                  return (
                    <div key={a.key} className="flex items-start gap-3 rounded-md border border-status-pending/20 bg-status-pending/5 px-3 py-2.5">
                      <Icon className="h-4 w-4 flex-shrink-0 mt-0.5 text-status-pending" />
                      <div className="flex flex-col gap-1 min-w-0">
                        <div className="text-sm font-medium text-foreground">{a.label}</div>
                        {blocked && <div className="text-xs text-muted-foreground leading-relaxed">{blocked.reason}</div>}
                      </div>
                    </div>
                  )
                })}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="border-b">
              <CardTitle className="text-sm font-semibold">Policy State</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 py-4">
              {change.policyDecision === 'deny' && (
                <div className="flex items-center gap-2 text-sm text-risk-critical">
                  <Ban className="h-4 w-4" /> Direct execution blocked by policy
                </div>
              )}
              {change.policyDecision === 'escalate' && (
                <div className="flex items-center gap-2 text-sm text-status-escalated">
                  <ArrowUpRight className="h-4 w-4" /> Requires human escalation
                </div>
              )}
              {!change.rollbackPlan && (
                <div className="flex items-center gap-2 text-sm text-risk-high">
                  <AlertTriangle className="h-4 w-4" /> Rollback plan required
                </div>
              )}
              {change.approvalState === 'pending' && (
                <div className="flex items-center gap-2 text-sm text-status-pending">
                  <Clock className="h-4 w-4" /> Approval pending
                </div>
              )}
              {change.policyDecision === 'allow' && change.rollbackPlan && change.approvalState === 'approved' && (
                <div className="flex items-center gap-2 text-sm text-status-approved">
                  <CheckCircle className="h-4 w-4" /> Ready for controlled execution
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {guardModal?.open && (
        <ActionGuardModal
          isOpen={true}
          title={guardModal.title}
          description={guardModal.description}
          confirmLabel="Confirm"
          onConfirm={guardModal.action}
          onCancel={() => setGuardModal(null)}
          variant="warning"
        />
      )}
    </div>
  )
}

// ─── Right rail helper ─────────────────────────────────

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
