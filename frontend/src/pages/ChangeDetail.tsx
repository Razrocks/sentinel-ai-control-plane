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
import { mockChanges } from '@/data/mock'
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
  info: 'bg-accent/10',
  success: 'bg-status-approved/10',
}
const toneText: Record<string, string> = {
  critical: 'text-risk-critical',
  warning: 'text-risk-high',
  info: 'text-accent',
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

  const change = mockChanges.find(c => c.id === id)
  if (!change) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-text-muted">Change not found</p>
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

  const handleAction = (title: string, description: string) => {
    setGuardModal({ open: true, title, description, action: () => setGuardModal(null) })
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
    { key: 'request_review', permission: 'request_review', label: 'Request Review', icon: Eye, style: 'bg-accent/10 text-accent hover:bg-accent/20', desc: 'This will send the change for peer review.' },
    { key: 'simulate', permission: 'simulate', label: 'Simulate Only', icon: Play, style: 'bg-status-simulated/10 text-status-simulated hover:bg-status-simulated/20', desc: 'Run a dry-run simulation of this change.' },
    { key: 'open_pr', permission: 'open_pr', label: 'Open PR', icon: FileText, style: 'bg-surface-raised text-text-secondary hover:bg-surface-overlay hover:text-text-primary', desc: 'Create a pull request for the generated changes.' },
    { key: 'block', permission: 'block', label: 'Block', icon: Ban, style: 'bg-risk-critical/10 text-risk-critical hover:bg-risk-critical/20', desc: 'This will block the change and prevent further execution.' },
    { key: 'escalate', permission: 'escalate', label: 'Escalate', icon: ArrowUpRight, style: 'bg-status-escalated/10 text-status-escalated hover:bg-status-escalated/20', desc: 'Escalate this change for senior review and approval.' },
    { key: 'attach_notes', permission: 'attach_notes', label: 'Attach Notes', icon: MessageSquare, style: 'bg-surface-raised text-text-secondary hover:bg-surface-overlay hover:text-text-primary', desc: 'Add notes to this change.' },
  ] as const

  const availableActions = allActions.filter(a => canAction(a.permission))
  const blockedActionKeys = new Set(getBlockedActions().map(b => b.action))
  const requiresApprovalActions = allActions.filter(a => blockedActionKeys.has(a.permission))

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Link to="/changes" className="mt-1 p-1 rounded hover:bg-surface-raised transition-colors">
          <ArrowLeft className="w-5 h-5 text-text-muted" />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-1">
            <span className="text-sm text-text-muted font-mono">{change.ticketId}</span>
            <RiskBadge level={change.riskLevel} />
            <ApprovalBadge state={change.approvalState} />
            <PolicyBadge decision={change.policyDecision} />
          </div>
          <h1 className="text-xl font-semibold text-text-primary break-words">{change.title}</h1>
          <p className="text-sm text-text-secondary mt-1 break-words">{change.description}</p>
        </div>
      </div>

      {/* Three-column layout */}
      <div className="grid grid-cols-[280px_1fr_280px] gap-5">
        {/* Left: Context */}
        <div className="space-y-4">
          <div className="bg-surface rounded-lg border border-border p-4 space-y-4">
            <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider">Change Context</h3>

            <div className="space-y-3">
              <div>
                <div className="text-xs text-text-muted">Owner</div>
                <OwnerChip name={change.owner} />
              </div>
              <div>
                <div className="text-xs text-text-muted">Team</div>
                <div className="text-sm text-text-primary">{change.ownerTeam}</div>
              </div>
              <div>
                <div className="text-xs text-text-muted">Service</div>
                <SystemChip name={change.service} />
              </div>
              <div>
                <div className="text-xs text-text-muted">Environment</div>
                <span className="text-sm text-text-primary capitalize">{change.environment}</span>
              </div>
              <div>
                <div className="text-xs text-text-muted">CI Status</div>
                <div className="flex items-center gap-1.5">
                  <CIIcon className={`w-4 h-4 ${ciColor}`} />
                  <span className="text-sm text-text-primary capitalize">{change.ciStatus}</span>
                </div>
              </div>
              <div>
                <div className="text-xs text-text-muted">Linked PRs</div>
                {change.linkedPRs.map(pr => (
                  <div key={pr} className="flex items-center gap-1 text-sm text-accent">
                    <GitPullRequest className="w-3.5 h-3.5" />
                    {pr}
                    <ExternalLink className="w-3 h-3" />
                  </div>
                ))}
              </div>
              <div>
                <div className="text-xs text-text-muted">Maintenance Window</div>
                <div className="text-sm text-text-primary">{change.maintenanceWindow || 'None scheduled'}</div>
              </div>
              <div>
                <div className="text-xs text-text-muted">Rollback Plan</div>
                <div className="flex items-center gap-1.5">
                  {change.rollbackPlan ? (
                    <><CheckCircle className="w-4 h-4 text-status-approved" /><span className="text-sm text-status-approved">Available</span></>
                  ) : (
                    <><AlertTriangle className="w-4 h-4 text-risk-high" /><span className="text-sm text-risk-high">Missing</span></>
                  )}
                </div>
              </div>
              <div>
                <div className="text-xs text-text-muted">Created</div>
                <div className="text-sm text-text-secondary">{formatDate(change.createdAt)}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Center: Assessment content */}
        <div className="space-y-4 min-w-0">
          {/* ── Recommended Next Step callout ── */}
          <div className={`rounded-lg border ${toneBorder[nextStep.tone]} ${toneBg[nextStep.tone]} p-4 flex items-start gap-3`}>
            <NextStepIcon className={`w-5 h-5 mt-0.5 flex-shrink-0 ${toneText[nextStep.tone]}`} />
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Recommended Next Step</span>
              </div>
              <div className={`text-sm font-semibold ${toneText[nextStep.tone]}`}>{nextStep.label}</div>
              <p className="text-xs text-text-secondary mt-0.5">{nextStep.description}</p>
            </div>
          </div>

          {/* ── Tabs ── */}
          <div className="flex gap-1 bg-surface rounded-lg border border-border p-1">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors flex items-center gap-1.5 ${
                  activeTab === tab.id
                    ? 'bg-accent text-white'
                    : 'text-text-secondary hover:text-text-primary hover:bg-surface-raised'
                }`}
              >
                {tab.label}
                {tab.count !== undefined && (
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                    activeTab === tab.id ? 'bg-white/20' : 'bg-surface-overlay'
                  }`}>
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* ── Assessment tab ── */}
          {activeTab === 'assessment' && (
            <div className="space-y-4">
              {/* Summary card */}
              <div className="bg-surface rounded-lg border border-border p-4 space-y-3">
                <h3 className="text-sm font-medium text-text-primary">Change Assessment Summary</h3>
                <p className="text-sm text-text-secondary">{change.description}</p>
              </div>

              {/* Affected Systems */}
              <div className="bg-surface rounded-lg border border-border p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Server className="w-4 h-4 text-text-muted" />
                  <h3 className="text-sm font-medium text-text-primary">Affected Systems</h3>
                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-surface-overlay text-text-secondary">
                    {change.blastRadius.length}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {change.blastRadius.map(item => (
                    <div
                      key={item.id}
                      className="flex items-center gap-1.5 bg-surface-raised rounded px-2.5 py-1.5 border border-border"
                    >
                      <CircleDot className={`w-3 h-3 ${
                        item.criticality === 'critical' ? 'text-risk-critical' :
                        item.criticality === 'high' ? 'text-risk-high' :
                        item.criticality === 'medium' ? 'text-risk-medium' :
                        'text-risk-low'
                      }`} />
                      <span className="text-xs font-medium text-text-primary">{item.name}</span>
                      <span className="text-[10px] text-text-muted capitalize">({item.type})</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Risk Factors */}
              <div className="bg-surface rounded-lg border border-border p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-text-muted" />
                  <h3 className="text-sm font-medium text-text-primary">Risk Factors</h3>
                  {activeRisks.length > 0 ? (
                    <span className="text-xs px-1.5 py-0.5 rounded-full bg-risk-high/10 text-risk-high">
                      {activeRisks.length} active
                    </span>
                  ) : (
                    <span className="text-xs px-1.5 py-0.5 rounded-full bg-status-approved/10 text-status-approved">
                      clear
                    </span>
                  )}
                </div>
                {activeRisks.length === 0 ? (
                  <p className="text-sm text-text-muted">No risk factors detected. This change looks safe to proceed.</p>
                ) : (
                  <div className="space-y-2">
                    {activeRisks.map((risk, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <AlertTriangle className={`w-3.5 h-3.5 flex-shrink-0 ${
                          risk.severity === 'critical' ? 'text-risk-critical' :
                          risk.severity === 'high' ? 'text-risk-high' : 'text-risk-medium'
                        }`} />
                        <span className="text-sm text-text-secondary">{risk.label}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Evidence & Readiness */}
              <div className="bg-surface rounded-lg border border-border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-text-muted" />
                    <h3 className="text-sm font-medium text-text-primary">Evidence & Readiness</h3>
                  </div>
                  <span className="text-xs text-text-muted">
                    {readinessMet}/{readinessTotal} met
                  </span>
                </div>
                {/* Progress bar */}
                <div className="w-full h-1.5 bg-surface-raised rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      readinessMet === readinessTotal ? 'bg-status-approved' :
                      readinessMet >= readinessTotal / 2 ? 'bg-accent' : 'bg-risk-high'
                    }`}
                    style={{ width: `${(readinessMet / readinessTotal) * 100}%` }}
                  />
                </div>
                <div className="space-y-1.5">
                  {readiness.map((item, i) => (
                    <div key={i} className="flex items-center gap-2">
                      {item.met ? (
                        <CheckSquare className="w-3.5 h-3.5 text-status-approved flex-shrink-0" />
                      ) : (
                        <Square className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
                      )}
                      <span className={`text-sm ${item.met ? 'text-text-secondary' : 'text-text-muted'}`}>
                        {item.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Linked Approvals */}
              <div className="bg-surface rounded-lg border border-border p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Lock className="w-4 h-4 text-text-muted" />
                  <h3 className="text-sm font-medium text-text-primary">Linked Approvals</h3>
                </div>
                <div className="bg-surface-raised rounded p-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ApprovalBadge state={change.approvalState} />
                    <span className="text-sm text-text-primary capitalize">Change Approval</span>
                  </div>
                  <span className="text-xs text-text-muted">
                    {change.approvalState === 'approved' && 'Approved — ready to proceed'}
                    {change.approvalState === 'pending' && 'Waiting for approver sign-off'}
                    {change.approvalState === 'denied' && 'Denied — cannot proceed'}
                    {change.approvalState === 'not_required' && 'No approval required'}
                  </span>
                </div>
                {change.policyDecision === 'deny' && (
                  <div className="bg-surface-raised rounded p-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <PolicyBadge decision={change.policyDecision} />
                      <span className="text-sm text-text-primary">Policy Override</span>
                    </div>
                    <span className="text-xs text-risk-critical">Blocked — needs senior escalation</span>
                  </div>
                )}
                {change.policyDecision === 'escalate' && (
                  <div className="bg-surface-raised rounded p-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <PolicyBadge decision={change.policyDecision} />
                      <span className="text-sm text-text-primary">Escalation Review</span>
                    </div>
                    <span className="text-xs text-status-escalated">Pending engineering review</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'blast_radius' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium text-text-primary">Impact Map</h3>
                  <p className="text-xs text-text-muted mt-0.5">Systems affected by this change</p>
                </div>
                <div className="flex items-center gap-1 bg-surface rounded-lg border border-border p-0.5">
                  <button
                    onClick={() => setBlastView('graph')}
                    className={`p-1.5 rounded transition-colors ${blastView === 'graph' ? 'bg-accent text-white' : 'text-text-muted hover:text-text-secondary'}`}
                  >
                    <LayoutGrid className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setBlastView('list')}
                    className={`p-1.5 rounded transition-colors ${blastView === 'list' ? 'bg-accent text-white' : 'text-text-muted hover:text-text-secondary'}`}
                  >
                    <List className="w-4 h-4" />
                  </button>
                </div>
              </div>
              {blastView === 'graph' ? (
                <BlastRadiusGraphPanel items={change.blastRadius} serviceName={change.service} />
              ) : (
                <div className="bg-surface rounded-lg border border-border overflow-hidden divide-y divide-border">
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
            <div className="bg-surface rounded-lg border border-border p-4">
              <h3 className="text-sm font-medium text-text-primary mb-3">Execution Log</h3>
              <p className="text-sm text-text-muted">No execution actions taken yet.</p>
            </div>
          )}

          {activeTab === 'audit' && (
            <div className="bg-surface rounded-lg border border-border overflow-hidden">
              <div className="px-4 py-3 border-b border-border">
                <h3 className="text-sm font-medium text-text-primary">Audit Trail</h3>
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
                <div className="bg-surface rounded-lg border border-border p-4 space-y-3">
                  <h3 className="text-sm font-medium text-text-primary flex items-center gap-2">
                    <GitPullRequest className="w-4 h-4 text-accent" />
                    Pull Request Status
                  </h3>
                  <div className="grid grid-cols-4 gap-4">
                    <div>
                      <div className="text-xs text-text-muted">Branch</div>
                      <div className="text-sm text-text-primary font-mono truncate">{prStatus.branch}</div>
                    </div>
                    <div>
                      <div className="text-xs text-text-muted">PR State</div>
                      <span className={`inline-flex items-center gap-1 text-sm font-medium ${
                        prStatus.prState === 'merged' ? 'text-status-approved' :
                        prStatus.prState === 'open' ? 'text-accent' :
                        prStatus.prState === 'draft' ? 'text-text-muted' :
                        'text-risk-critical'
                      }`}>
                        <GitBranch className="w-3.5 h-3.5" />
                        {prStatus.prState}
                      </span>
                    </div>
                    <div>
                      <div className="text-xs text-text-muted">Review</div>
                      <span className={`text-sm font-medium ${
                        prStatus.reviewStatus === 'approved' ? 'text-status-approved' :
                        prStatus.reviewStatus === 'changes_requested' ? 'text-risk-high' :
                        prStatus.reviewStatus === 'pending' ? 'text-status-pending' :
                        'text-text-muted'
                      }`}>
                        {prStatus.reviewStatus === 'none' ? '—' : prStatus.reviewStatus.replace('_', ' ')}
                      </span>
                    </div>
                    <div>
                      <div className="text-xs text-text-muted">Merge Ready</div>
                      <span className={`text-sm font-medium ${prStatus.mergeReady ? 'text-status-approved' : 'text-text-muted'}`}>
                        {prStatus.mergeReady ? 'Yes' : 'No'}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* CI Checks */}
              {ciChecks.length > 0 && (
                <div className="bg-surface rounded-lg border border-border p-4 space-y-3">
                  <h3 className="text-sm font-medium text-text-primary flex items-center gap-2">
                    <FlaskConical className="w-4 h-4 text-accent" />
                    CI Pipeline
                    <span className={`text-xs px-2 py-0.5 rounded ${
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
                          <span className="text-sm text-text-primary">{check.name}</span>
                        </div>
                        {check.duration && <span className="text-xs text-text-muted font-mono">{check.duration}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Files Impacted */}
              {filesImpacted.length > 0 && (
                <div className="bg-surface rounded-lg border border-border p-4 space-y-3">
                  <h3 className="text-sm font-medium text-text-primary flex items-center gap-2">
                    <FileText className="w-4 h-4 text-accent" />
                    Files Impacted
                    <span className="text-xs text-text-muted">({filesImpacted.length} files)</span>
                  </h3>
                  <div className="divide-y divide-border/50">
                    {filesImpacted.map((file) => (
                      <div key={file.path} className="flex items-center justify-between py-2 gap-3">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          {file.changeType === 'added' && <FilePlus className="w-4 h-4 text-status-approved flex-shrink-0" />}
                          {file.changeType === 'modified' && <FilePen className="w-4 h-4 text-status-pending flex-shrink-0" />}
                          {file.changeType === 'deleted' && <FileX className="w-4 h-4 text-risk-critical flex-shrink-0" />}
                          <span className="text-sm text-text-primary font-mono truncate">{file.path}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs font-mono flex-shrink-0">
                          {file.linesAdded > 0 && <span className="text-status-approved">+{file.linesAdded}</span>}
                          {file.linesRemoved > 0 && <span className="text-risk-critical">−{file.linesRemoved}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-4 pt-2 border-t border-border/50 text-xs text-text-muted">
                    <span className="text-status-approved">+{filesImpacted.reduce((s, f) => s + f.linesAdded, 0)}</span>
                    <span className="text-risk-critical">−{filesImpacted.reduce((s, f) => s + f.linesRemoved, 0)}</span>
                    <span>across {filesImpacted.length} files</span>
                  </div>
                </div>
              )}

              {/* Patch Preview */}
              {patchPreview && (
                <div className="bg-surface rounded-lg border border-border overflow-hidden">
                  <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                    <h3 className="text-sm font-medium text-text-primary flex items-center gap-2">
                      <Code className="w-4 h-4 text-accent" />
                      Diff Preview
                    </h3>
                    <span className="text-xs text-text-muted">Proposed changes</span>
                  </div>
                  <pre className="p-4 text-xs font-mono text-text-secondary overflow-x-auto leading-relaxed bg-surface-raised">
                    {patchPreview.split('\n').map((line, i) => (
                      <div key={i} className={
                        line.startsWith('+') && !line.startsWith('+++') ? 'text-status-approved' :
                        line.startsWith('-') && !line.startsWith('---') ? 'text-risk-critical' :
                        line.startsWith('@@') ? 'text-accent' :
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
                <div className={`bg-surface rounded-lg border ${
                  simulation.status === 'completed' && simulation.conflicts.length > 0 ? 'border-risk-high/40' :
                  simulation.status === 'completed' ? 'border-status-approved/40' :
                  simulation.status === 'pending' ? 'border-status-pending/40' :
                  'border-border'
                } p-4 space-y-3`}>
                  <h3 className="text-sm font-medium text-text-primary flex items-center gap-2">
                    <FlaskConical className="w-4 h-4 text-accent" />
                    Simulation Results
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      simulation.status === 'completed' ? 'bg-status-approved/10 text-status-approved' :
                      simulation.status === 'pending' ? 'bg-status-pending/10 text-status-pending' :
                      'bg-surface-raised text-text-muted'
                    }`}>
                      {simulation.status === 'not_run' ? 'Not run' : simulation.status}
                    </span>
                  </h3>

                  <p className="text-sm text-text-secondary">{simulation.dryRunSummary}</p>

                  {simulation.conflicts.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="text-xs font-medium text-risk-critical uppercase tracking-wider">Conflicts ({simulation.conflicts.length})</div>
                      {simulation.conflicts.map((c, i) => (
                        <div key={i} className="flex items-start gap-2 text-sm text-text-secondary bg-risk-critical/5 border border-risk-critical/20 rounded p-2">
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
                        <div key={i} className="flex items-start gap-2 text-sm text-text-secondary bg-risk-high/5 border border-risk-high/20 rounded p-2">
                          <AlertTriangle className="w-3.5 h-3.5 text-risk-high flex-shrink-0 mt-0.5" />
                          <span>{w}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {simulation.executionPlan.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-xs font-medium text-text-muted uppercase tracking-wider">Execution Plan</div>
                      {simulation.executionPlan.map((step, i) => (
                        <div key={i} className="flex items-start gap-3 text-sm">
                          <span className="w-5 h-5 rounded-full bg-accent/10 text-accent text-xs flex items-center justify-center flex-shrink-0 mt-0.5 font-medium">{i + 1}</span>
                          <div className="min-w-0">
                            <div className="text-text-primary">{step.step}</div>
                            <div className="text-xs text-text-muted mt-0.5">{step.expectedOutcome}</div>
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
        <div className="space-y-4">
          {/* Available Now */}
          {availableActions.length > 0 && (
            <div className="bg-surface rounded-lg border border-border p-4 space-y-3">
              <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider">
                Available Now
                <span className="text-accent ml-1">· {config.label}</span>
              </h3>

              {availableActions.map(a => {
                const Icon = a.icon
                return (
                  <button
                    key={a.key}
                    onClick={() => handleAction(a.label, a.desc)}
                    disabled={a.disabled}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-colors text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed ${a.style}`}
                  >
                    <Icon className="w-4 h-4" /> {a.label}
                  </button>
                )
              })}
            </div>
          )}

          {/* Decision Impact — Approver only */}
          {(role === 'approver' || role === 'admin') && (
            <div className="bg-surface rounded-lg border border-accent/20 p-4 space-y-3">
              <h3 className="text-xs font-medium text-accent uppercase tracking-wider flex items-center gap-1.5">
                <AlertTriangle className="w-3 h-3" />
                Decision Impact
              </h3>
              <div className="space-y-2">
                <div className="flex gap-2">
                  <CheckCircle className="w-3 h-3 text-status-approved flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="text-[10px] font-medium text-status-approved uppercase">If approved</div>
                    <p className="text-xs text-text-secondary">
                      {change.status === 'approved' ? 'Change proceeds to controlled execution. ' : 'Change moves to approved state. '}
                      {change.blastRadius.length} system{change.blastRadius.length !== 1 ? 's' : ''} affected.
                      {change.rollbackPlan ? ' Rollback plan is ready.' : ' No rollback plan attached.'}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <XCircle className="w-3 h-3 text-status-denied flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="text-[10px] font-medium text-status-denied uppercase">If denied</div>
                    <p className="text-xs text-text-secondary">
                      Change blocked. {change.owner} notified. {change.ticketId} returns to draft state.
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <ArrowUpRight className="w-3 h-3 text-status-escalated flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="text-[10px] font-medium text-status-escalated uppercase">If escalated</div>
                    <p className="text-xs text-text-secondary">
                      Routes to {change.riskLevel === 'critical' ? 'VP Engineering' : 'senior reviewer'}. SLA clock pauses.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Requires Approval */}
          {requiresApprovalActions.length > 0 && (
            <div className="bg-surface rounded-lg border border-border p-4 space-y-2">
              <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider">Requires Approval</h3>
              {requiresApprovalActions.map(a => {
                const Icon = a.icon
                const blocked = getBlockedActions().find(b => b.action === a.permission)
                return (
                  <div key={a.key} className="w-full flex items-start gap-2 px-3 py-2 rounded-lg bg-surface-raised opacity-50">
                    <Icon className="w-4 h-4 text-text-muted flex-shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-text-muted">{a.label}</div>
                      {blocked && (
                        <div className="text-[10px] text-text-muted/70 leading-tight mt-0.5">{blocked.reason}</div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Policy State */}
          <div className="bg-surface rounded-lg border border-border p-4 space-y-2">
            <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider">Policy State</h3>
            {change.policyDecision === 'deny' && (
              <div className="text-xs text-risk-critical flex items-center gap-1.5">
                <Ban className="w-3.5 h-3.5" /> Direct execution blocked by policy
              </div>
            )}
            {change.policyDecision === 'escalate' && (
              <div className="text-xs text-status-escalated flex items-center gap-1.5">
                <ArrowUpRight className="w-3.5 h-3.5" /> Requires human escalation
              </div>
            )}
            {!change.rollbackPlan && (
              <div className="text-xs text-risk-high flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" /> Rollback plan required
              </div>
            )}
            {change.approvalState === 'pending' && (
              <div className="text-xs text-status-pending flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" /> Approval pending
              </div>
            )}
            {change.policyDecision === 'allow' && change.rollbackPlan && change.approvalState === 'approved' && (
              <div className="text-xs text-status-approved flex items-center gap-1.5">
                <CheckCircle className="w-3.5 h-3.5" /> Ready for controlled execution
              </div>
            )}
          </div>

          {/* Contextual Assistant */}
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
