/**
 * Approvals — pending decision inbox (Phase 4 v2 — refined).
 *
 * Layout principles after the first pass feedback:
 *   - Full width container; no max-w cap.
 *   - Each approval is ONE Card with three vertical zones rather than a
 *     three-column grid that breaks at narrow viewports:
 *       1. Top: type / risk / urgency strip + title
 *       2. Body: 2-col on lg+ (left = context, right = analysis)
 *       3. Footer: action row (full width, evenly distributed)
 *   - Big text where it matters (title, action labels), generous padding
 *   - Tabs use proper gap so chips don't merge with adjacent labels
 *   - Stage strip and "why required" hint live above the title as
 *     status bars, not inline noise.
 */
import { useState } from 'react'
import {
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  ArrowUpRight,
  MessageSquare,
  Lock,
  FileCheck,
  Users,
  Info,
  ChevronDown,
  ChevronUp,
  Inbox,
} from 'lucide-react'
import { useApprovals } from '@/hooks/useData'
import { useApprovalDecision, ApprovalConflictError } from '@/hooks/useMutations'
import { ActionGuardModal } from '@/components/shared'
import { timeAgo } from '@/lib/utils'
import { useRole } from '@/lib/roles'
import type { Approval } from '@/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

type FilterType = 'all' | 'change' | 'access' | 'remediation' | 'escalation'

const typeLabels: Record<string, string> = {
  change: 'Change',
  access: 'Access',
  remediation: 'Remediation',
  escalation: 'Escalation',
}

function riskToBadge(riskLevel: string) {
  const map: Record<
    string,
    { variant: 'risk_critical' | 'risk_high' | 'risk_medium' | 'risk_low'; label: string }
  > = {
    critical: { variant: 'risk_critical', label: 'CRITICAL' },
    high: { variant: 'risk_high', label: 'HIGH' },
    medium: { variant: 'risk_medium', label: 'MEDIUM' },
    low: { variant: 'risk_low', label: 'LOW' },
  }
  return map[riskLevel] ?? map.medium
}

function urgencyAccent(approval: Approval): string {
  if (approval.riskLevel === 'critical') return 'border-l-4 border-l-risk-critical'
  if (approval.riskLevel === 'high') return 'border-l-4 border-l-risk-high'
  if (approval.type === 'escalation') return 'border-l-4 border-l-status-escalated'
  return 'border-l-4 border-l-border'
}

export default function Approvals() {
  const { data: approvals = [], isLoading } = useApprovals()
  const [filter, setFilter] = useState<FilterType>('all')
  const approvalDecision = useApprovalDecision()

  const [guardModal, setGuardModal] = useState<{
    action: string
    label: string
    reason: string
  } | null>(null)
  const [conditionModal, setConditionModal] = useState<Approval | null>(null)
  const [conditionText, setConditionText] = useState('')
  const [expandedImpact, setExpandedImpact] = useState<string | null>(null)
  const { role, canAction, getActionPermission } = useRole()

  const isApproverRole =
    role === 'approver' || role === 'access_approver' || role === 'admin'

  const filtered = filter === 'all' ? approvals : approvals.filter((a) => a.type === filter)
  const pending = filtered.filter((a) => a.status === 'pending')
  const resolved = filtered.filter((a) => a.status !== 'pending')
  const pendingCount = approvals.filter((a) => a.status === 'pending').length

  const handleApprove = (approval: Approval) => {
    const perm = getActionPermission('approve', 'Approve')
    if (!perm.allowed) {
      setGuardModal({ action: 'approve', label: 'Approve', reason: perm.reason || 'Not permitted' })
      return
    }
    approvalDecision.mutate({
      id: approval.id,
      decision: 'approved',
      expectedVersion: approval.version,
    })
  }

  const handleApproveWithCondition = (approval: Approval) => {
    const perm = getActionPermission('approve', 'Approve with Condition')
    if (!perm.allowed) {
      setGuardModal({
        action: 'approve',
        label: 'Approve with Condition',
        reason: perm.reason || 'Not permitted',
      })
      return
    }
    setConditionModal(approval)
    setConditionText('')
  }

  const confirmCondition = () => {
    if (!conditionModal || !conditionText.trim()) return
    approvalDecision.mutate({
      id: conditionModal.id,
      decision: 'approved_with_condition',
      condition: conditionText.trim(),
      expectedVersion: conditionModal.version,
    })
    setConditionModal(null)
    setConditionText('')
  }

  const handleDeny = (approval: Approval) => {
    const perm = getActionPermission('deny', 'Deny')
    if (!perm.allowed) {
      setGuardModal({ action: 'deny', label: 'Deny', reason: perm.reason || 'Not permitted' })
      return
    }
    approvalDecision.mutate({
      id: approval.id,
      decision: 'denied',
      expectedVersion: approval.version,
    })
  }

  const tabs: { id: FilterType; label: string; count: number }[] = [
    { id: 'all', label: 'All', count: approvals.filter((a) => a.status === 'pending').length },
    {
      id: 'change',
      label: 'Changes',
      count: approvals.filter((a) => a.type === 'change' && a.status === 'pending').length,
    },
    {
      id: 'access',
      label: 'Access',
      count: approvals.filter((a) => a.type === 'access' && a.status === 'pending').length,
    },
    {
      id: 'remediation',
      label: 'Remediation',
      count: approvals.filter((a) => a.type === 'remediation' && a.status === 'pending').length,
    },
    {
      id: 'escalation',
      label: 'Escalation',
      count: approvals.filter((a) => a.type === 'escalation' && a.status === 'pending').length,
    },
  ]

  return (
    <div className="space-y-12">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-semibold text-foreground tracking-tight">Approvals</h1>
        <p className="text-base text-muted-foreground mt-4">
          {pendingCount} pending approval{pendingCount !== 1 ? 's' : ''} requiring action
        </p>
      </div>

      {/* Banners */}
      {approvalDecision.error instanceof ApprovalConflictError && (
        <Alert variant="warning">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Approval changed while you were deciding</AlertTitle>
          <AlertDescription>
            Another approver acted on this request first. The latest state has been reloaded — review it
            before deciding again.
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 h-8"
              onClick={() => approvalDecision.reset()}
            >
              Dismiss
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {approvalDecision.error && !(approvalDecision.error instanceof ApprovalConflictError) && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertTitle>Decision failed</AlertTitle>
          <AlertDescription>
            {approvalDecision.error.message}
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 h-8"
              onClick={() => approvalDecision.reset()}
            >
              Dismiss
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Tabs */}
      <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterType)}>
        <TabsList>
          {tabs.map((t) => (
            <TabsTrigger key={t.id} value={t.id} className="gap-2">
              <span>{t.label}</span>
              {t.count > 0 && (
                <span className="rounded-full bg-foreground/15 px-2 py-0.5 text-[10px] font-semibold">
                  {t.count}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-64 w-full" />
          ))}
        </div>
      )}

      {/* Pending */}
      {!isLoading && pending.length > 0 && (
        <section className="space-y-6">
          <SectionHeading count={pending.length}>Pending</SectionHeading>
          <div className="space-y-6">
            {pending.map((approval) => (
              <PendingApprovalCard
                key={approval.id}
                approval={approval}
                isApproverRole={isApproverRole}
                canAction={canAction}
                expandedImpact={expandedImpact === approval.id}
                onToggleImpact={() =>
                  setExpandedImpact(expandedImpact === approval.id ? null : approval.id)
                }
                onApprove={() => handleApprove(approval)}
                onApproveWithCondition={() => handleApproveWithCondition(approval)}
                onDeny={() => handleDeny(approval)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Resolved */}
      {!isLoading && resolved.length > 0 && (
        <section className="space-y-6">
          <SectionHeading count={resolved.length}>Resolved</SectionHeading>
          <Card>
            <CardContent className="p-0 divide-y divide-border">
              {resolved.map((approval) => (
                <ResolvedRow key={approval.id} approval={approval} />
              ))}
            </CardContent>
          </Card>
        </section>
      )}

      {/* Empty */}
      {!isLoading && filtered.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-20">
            <div className="rounded-full bg-secondary p-4 mb-4">
              <Inbox className="h-7 w-7 text-muted-foreground" />
            </div>
            <p className="text-base text-muted-foreground">No approvals matching this filter</p>
          </CardContent>
        </Card>
      )}

      {/* Condition dialog */}
      <Dialog
        open={!!conditionModal}
        onOpenChange={(open) => {
          if (!open) {
            setConditionModal(null)
            setConditionText('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileCheck className="h-5 w-5 text-status-pending" />
              Approve with Condition
            </DialogTitle>
            <DialogDescription>
              Specify the condition that must be met before this approval takes effect.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={conditionText}
            onChange={(e) => setConditionText(e.target.value)}
            placeholder="e.g., Execute only during scheduled maintenance window..."
            rows={4}
            autoFocus
          />
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setConditionModal(null)
                setConditionText('')
              }}
            >
              Cancel
            </Button>
            <Button onClick={confirmCondition} disabled={!conditionText.trim()}>
              Confirm Conditional Approval
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

// ─── Section heading ────────────────────────────────────

function SectionHeading({ count, children }: { count: number; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        {children}
      </h2>
      <span className="text-xs text-muted-foreground/70">({count})</span>
    </div>
  )
}

// ─── Pending approval card ───────────────────────────────

interface PendingCardProps {
  approval: Approval
  isApproverRole: boolean
  canAction: (action: string) => boolean
  expandedImpact: boolean
  onToggleImpact: () => void
  onApprove: () => void
  onApproveWithCondition: () => void
  onDeny: () => void
}

function PendingApprovalCard({
  approval,
  isApproverRole,
  canAction,
  expandedImpact,
  onToggleImpact,
  onApprove,
  onApproveWithCondition,
  onDeny,
}: PendingCardProps) {
  const risk = riskToBadge(approval.riskLevel)
  const canApprove = canAction('approve')

  return (
    <Card className={cn('overflow-hidden', urgencyAccent(approval))}>
      {/* Why-required strip — high-contrast policy explainer at top */}
      {isApproverRole && approval.whyYouAreRequired && (
        <div className="flex items-start gap-3 px-7 py-3.5 bg-primary/10 border-b border-primary/30">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/20 flex-shrink-0 mt-0.5">
            <Info className="h-3.5 w-3.5 text-primary" />
          </div>
          <span className="text-sm font-medium text-primary leading-relaxed">
            {approval.whyYouAreRequired}
          </span>
        </div>
      )}

      {/* Stage strip */}
      {isApproverRole && approval.coApprovals && approval.coApprovals.length > 1 && (
        <StageStrip approval={approval} />
      )}

      {/* Header */}
      <div className="px-7 pt-6 pb-5 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="uppercase text-[10px]">
            {typeLabels[approval.type] ?? approval.type}
          </Badge>
          <Badge variant={risk.variant} className="text-[10px]">
            {risk.label} RISK
          </Badge>
          <span className="text-xs text-muted-foreground ml-auto">
            Submitted {timeAgo(approval.createdAt)}
          </span>
        </div>
        <h3 className="text-xl font-semibold text-foreground leading-snug">{approval.title}</h3>
        <div className="text-sm text-muted-foreground">
          Requested by <span className="text-foreground font-medium">{approval.requester}</span> · System{' '}
          <code className="text-xs px-1.5 py-0.5 rounded bg-secondary text-foreground">
            {approval.impactedSystem}
          </code>
        </div>
      </div>

      <Separator />

      {/* Body — 2-col on lg, single col below */}
      <div className="px-7 py-6 grid grid-cols-1 lg:grid-cols-2 gap-x-10 gap-y-6">
        {/* Why approval is needed */}
        <SectionBlock label="Why approval is needed" body={approval.reason} />

        {/* Recommended action */}
        <SectionBlock label="Recommended action" body={approval.recommendedAction} highlight />

        {/* Co-approvals */}
        {approval.coApprovals && approval.coApprovals.length > 1 && (
          <div className="space-y-3">
            <SectionLabel icon={<Users className="h-3.5 w-3.5" />}>Co-approval chain</SectionLabel>
            <div className="space-y-2">
              {approval.coApprovals.map((co, i) => (
                <CoApprovalRow key={i} co={co} />
              ))}
            </div>
          </div>
        )}

        {/* Decision Impact — full-width expandable card. Big tap target,
            clear affordance: border + hover state + animated chevron. */}
        {isApproverRole && approval.decisionImpact && (
          <div className="space-y-3">
            <SectionLabel icon={<AlertTriangle className="h-3.5 w-3.5" />}>
              Decision impact
            </SectionLabel>
            <button
              type="button"
              onClick={onToggleImpact}
              aria-expanded={expandedImpact}
              className={cn(
                'group w-full flex items-center justify-between gap-3 rounded-md border px-5 h-12 text-left transition-colors',
                expandedImpact
                  ? 'border-primary/40 bg-secondary'
                  : 'border-border bg-secondary/40 hover:bg-secondary',
              )}
            >
              <span className="text-sm font-medium text-foreground">
                {expandedImpact ? 'Hide consequences' : 'Show consequences of each decision'}
              </span>
              <ChevronDown
                className={cn(
                  'h-4 w-4 text-muted-foreground transition-transform',
                  expandedImpact && 'rotate-180',
                )}
              />
            </button>
            {expandedImpact && (
              <div className="space-y-3 px-4 py-3 rounded-md border border-border-subtle bg-secondary/20">
                <ImpactRow
                  icon={<CheckCircle2 className="h-4 w-4 text-status-approved" />}
                  label="If approved"
                  color="text-status-approved"
                  text={approval.decisionImpact.approve}
                />
                <ImpactRow
                  icon={<XCircle className="h-4 w-4 text-status-denied" />}
                  label="If denied"
                  color="text-status-denied"
                  text={approval.decisionImpact.deny}
                />
                <ImpactRow
                  icon={<ArrowUpRight className="h-4 w-4 text-status-escalated" />}
                  label="If escalated"
                  color="text-status-escalated"
                  text={approval.decisionImpact.escalate}
                />
              </div>
            )}
          </div>
        )}
      </div>

      <Separator />

      {/* Action row — every button is h-11, min-w-[7.5rem], px-6 so
       *   labels sit comfortably inside their outline. Color intent kept
       *   as before:
       *     Escalate     → orange text + border
       *     Approve w/   → amber text + border
       *     Deny         → solid rose
       *     Approve      → solid emerald
       *   Min-width keeps Approve/Deny visually equal even though "Deny"
       *   is shorter than "Approve" — no more lopsided pair.
       */}
      <div className="px-7 py-4 flex flex-wrap items-center justify-end gap-3">
        {canAction('attach_notes') && (
          <Button
            variant="ghost"
            className="mr-auto h-11 px-5 text-muted-foreground hover:text-foreground"
          >
            <MessageSquare className="h-4 w-4" />
            Add note
          </Button>
        )}
        {canAction('escalate') && (
          <Button
            variant="outline"
            className="h-11 px-6 min-w-[7.5rem] border-status-escalated/50 text-status-escalated hover:bg-status-escalated/10 hover:border-status-escalated"
          >
            <ArrowUpRight className="h-4 w-4" />
            Escalate
          </Button>
        )}
        {canApprove ? (
          <>
            <Button
              variant="outline"
              onClick={onApproveWithCondition}
              className="h-11 px-6 min-w-[7.5rem] border-status-pending/50 text-status-pending hover:bg-status-pending/10 hover:border-status-pending"
            >
              <FileCheck className="h-4 w-4" />
              Approve with condition
            </Button>
            <Button
              onClick={onDeny}
              className="h-11 px-7 min-w-[7.5rem] bg-status-denied text-white hover:bg-status-denied/90 shadow-sm"
            >
              <XCircle className="h-4 w-4" />
              Deny
            </Button>
            <Button
              onClick={onApprove}
              className="h-11 px-7 min-w-[7.5rem] bg-status-approved text-white hover:bg-status-approved/90 shadow-sm"
            >
              <CheckCircle2 className="h-4 w-4" />
              Approve
            </Button>
          </>
        ) : (
          <Button variant="outline" disabled className="h-11 px-6">
            <Lock className="h-4 w-4" />
            Approver role required
          </Button>
        )}
      </div>
    </Card>
  )
}

// ─── Section block (label above + body text) ───────────

function SectionBlock({
  label,
  body,
  highlight,
}: {
  label: string
  body: string
  highlight?: boolean
}) {
  return (
    <div className="space-y-2">
      <SectionLabel>{label}</SectionLabel>
      <p
        className={cn(
          'text-sm leading-relaxed',
          highlight ? 'text-foreground font-medium' : 'text-foreground/85',
        )}
      >
        {body}
      </p>
    </div>
  )
}

function SectionLabel({
  children,
  icon,
}: {
  children: React.ReactNode
  icon?: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {icon}
      {children}
    </div>
  )
}

// ─── Stage strip ────────────────────────────────────────

function StageStrip({ approval }: { approval: Approval }) {
  const coApprovals = approval.coApprovals ?? []
  const approvedCount = coApprovals.filter((c) => c.status === 'approved').length
  const total = coApprovals.length
  const myEntry = coApprovals.find((c) => c.name === 'you')
  const pendingOthers = coApprovals.filter((c) => c.status === 'pending' && c.name !== 'you')
  const isMyTurnFinal = myEntry?.status === 'pending' && pendingOthers.length === 0
  const isMyTurnIntermediate = myEntry?.status === 'pending' && pendingOthers.length > 0
  const progressPct = total > 0 ? Math.round((approvedCount / total) * 100) : 0

  return (
    <div
      className={cn(
        'px-7 py-3.5 border-b border-border flex flex-wrap items-center gap-x-6 gap-y-2 text-sm',
        isMyTurnFinal
          ? 'bg-status-approved/10'
          : isMyTurnIntermediate
            ? 'bg-status-pending/10'
            : 'bg-secondary/40',
      )}
    >
      {/* Progress mini-bar */}
      <div className="flex items-center gap-2.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Stage
        </span>
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-24 rounded-full bg-secondary overflow-hidden">
            <div
              className={cn(
                'h-full transition-all',
                progressPct === 100 ? 'bg-status-approved' : 'bg-primary',
              )}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <span className="text-foreground font-semibold tabular-nums">
            {approvedCount}/{total}
          </span>
        </div>
      </div>

      {/* Your turn callout */}
      {myEntry && (
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold',
            isMyTurnFinal
              ? 'bg-status-approved/15 text-status-approved ring-1 ring-status-approved/30'
              : isMyTurnIntermediate
                ? 'bg-status-pending/15 text-status-pending ring-1 ring-status-pending/30'
                : 'bg-secondary text-muted-foreground',
          )}
        >
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
          {isMyTurnFinal
            ? 'Your decision is final'
            : isMyTurnIntermediate
              ? 'Your decision advances the chain'
              : 'You have decided'}
        </span>
      )}

      {/* Pending others — prominent, not muted */}
      {pendingOthers.length > 0 && (
        <span className="ml-auto flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Waiting on</span>
          <span className="flex flex-wrap items-center gap-1.5">
            {pendingOthers.map((c) => (
              <span
                key={c.name}
                className="inline-flex items-center gap-1 rounded-md bg-status-pending/15 text-status-pending px-2 py-0.5 font-medium ring-1 ring-status-pending/30"
              >
                <Clock className="h-3 w-3" />
                {c.name}
              </span>
            ))}
          </span>
        </span>
      )}
    </div>
  )
}

// ─── Co-approval row ────────────────────────────────────

function CoApprovalRow({
  co,
}: {
  co: { role: string; name: string; status: string; decidedAt?: string }
}) {
  const Icon =
    co.status === 'approved' ? CheckCircle2 : co.status === 'denied' ? XCircle : Clock
  const isYou = co.name === 'you'

  // Tier the row visually by status so the eye lands on pending first.
  const styles =
    co.status === 'approved'
      ? {
          ring: 'ring-status-approved/20',
          bg: 'bg-status-approved/8',
          iconColor: 'text-status-approved',
          chipBg: 'bg-status-approved/15 text-status-approved',
          chipLabel: 'Approved',
        }
      : co.status === 'denied'
        ? {
            ring: 'ring-status-denied/20',
            bg: 'bg-status-denied/8',
            iconColor: 'text-status-denied',
            chipBg: 'bg-status-denied/15 text-status-denied',
            chipLabel: 'Denied',
          }
        : {
            ring: 'ring-status-pending/30',
            bg: 'bg-status-pending/8',
            iconColor: 'text-status-pending',
            chipBg: 'bg-status-pending/15 text-status-pending',
            chipLabel: 'Awaiting',
          }

  return (
    <div
      className={cn(
        'flex items-center gap-3 px-3 py-2.5 rounded-md ring-1',
        styles.bg,
        styles.ring,
      )}
    >
      <Icon className={cn('h-4 w-4 flex-shrink-0', styles.iconColor)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'text-sm font-medium truncate',
              isYou ? 'text-primary' : 'text-foreground',
            )}
          >
            {isYou ? 'You' : co.name}
          </span>
          <span className="text-xs text-muted-foreground truncate">{co.role}</span>
        </div>
      </div>
      <span
        className={cn(
          'text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded',
          styles.chipBg,
        )}
      >
        {styles.chipLabel}
      </span>
      {co.decidedAt && (
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {timeAgo(co.decidedAt)}
        </span>
      )}
    </div>
  )
}

function ImpactRow({
  icon,
  label,
  color,
  text,
}: {
  icon: React.ReactNode
  label: string
  color: string
  text: string
}) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex-shrink-0">{icon}</span>
      <div className="min-w-0">
        <div className={cn('text-[10px] font-semibold uppercase tracking-wider', color)}>
          {label}
        </div>
        <p className="text-foreground text-sm leading-relaxed mt-0.5">{text}</p>
      </div>
    </div>
  )
}

// ─── Resolved row ───────────────────────────────────────

function ResolvedRow({ approval }: { approval: Approval }) {
  const Icon =
    approval.status === 'approved' || approval.status === 'approved_with_condition'
      ? CheckCircle2
      : XCircle
  const color =
    approval.status === 'approved'
      ? 'text-status-approved'
      : approval.status === 'approved_with_condition'
        ? 'text-status-pending'
        : 'text-status-denied'
  const variant: 'success' | 'warning' | 'danger' =
    approval.status === 'approved'
      ? 'success'
      : approval.status === 'approved_with_condition'
        ? 'warning'
        : 'danger'
  const label =
    approval.status === 'approved'
      ? 'Approved'
      : approval.status === 'approved_with_condition'
        ? 'Conditional'
        : 'Denied'

  return (
    <div className="flex items-center justify-between gap-4 px-6 py-4 opacity-80 hover:opacity-100 transition-opacity">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <Icon className={cn('h-4 w-4 flex-shrink-0', color)} />
        <div className="min-w-0 flex-1">
          <div className="text-sm text-foreground truncate font-medium">{approval.title}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {approval.requester} · {typeLabels[approval.type]} · {timeAgo(approval.createdAt)}
            {approval.status === 'approved_with_condition' && approval.condition && (
              <span className="ml-1 text-status-pending">· Condition: {approval.condition}</span>
            )}
          </div>
        </div>
      </div>
      <Badge variant={variant}>{label}</Badge>
    </div>
  )
}
