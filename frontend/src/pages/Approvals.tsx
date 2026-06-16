/**
 * Approvals — Linear-style refined inbox.
 *
 * Built entirely on the shadcn preset primitives (radix-vega style):
 *   - Card with `--card-spacing` for consistent gutters
 *   - Tabs `variant="line"` for understated filter row
 *   - Avatar primitive for co-approver chips
 *   - Badge with subtle ring outline matching the rest of the system
 *   - Dialog with built-in glass overlay for the condition modal
 *
 * No hand-built variants. No inline-style hacks. Everything composes
 * from primitives + theme tokens.
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
  Inbox,
  Search,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { useApprovals } from '@/hooks/useData'
import {
  useApprovalDecision,
  useApprovalAddNote,
  useApprovalEscalate,
  useEditApprovalNote,
  useDeleteApprovalNote,
  ApprovalConflictError,
} from '@/hooks/useMutations'
import { ActionGuardModal } from '@/components/shared'
import { timeAgo, cn } from '@/lib/utils'
import { useRole } from '@/lib/roles'
import { useAuth } from '@/lib/auth'
import type { Approval } from '@/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  CardAction,
} from '@/components/ui/card'
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
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

type FilterType = 'all' | 'change' | 'access' | 'remediation' | 'escalation'

const typeLabels: Record<string, string> = {
  change: 'Change',
  access: 'Access',
  remediation: 'Remediation',
  escalation: 'Escalation',
}

function riskTone(level: string) {
  const map: Record<string, { dot: string; label: string; text: string }> = {
    critical: { dot: 'bg-risk-critical', text: 'text-risk-critical', label: 'CRITICAL' },
    high: { dot: 'bg-risk-high', text: 'text-risk-high', label: 'HIGH' },
    medium: { dot: 'bg-risk-medium', text: 'text-risk-medium', label: 'MEDIUM' },
    low: { dot: 'bg-risk-low', text: 'text-risk-low', label: 'LOW' },
  }
  return map[level] ?? map.medium
}

function urgencyRail(approval: Approval): string {
  if (approval.riskLevel === 'critical') return 'before:bg-risk-critical'
  if (approval.riskLevel === 'high') return 'before:bg-risk-high'
  if (approval.type === 'escalation') return 'before:bg-status-escalated'
  return 'before:bg-transparent'
}

export default function Approvals() {
  const { data: approvals = [], isLoading } = useApprovals()
  const [filter, setFilter] = useState<FilterType>('all')
  const [query, setQuery] = useState('')
  const approvalDecision = useApprovalDecision()
  const approvalNote = useApprovalAddNote()
  const approvalEscalate = useApprovalEscalate()

  const [guardModal, setGuardModal] = useState<{
    action: string
    label: string
    reason: string
  } | null>(null)
  const [conditionModal, setConditionModal] = useState<Approval | null>(null)
  const [conditionText, setConditionText] = useState('')
  const [noteModal, setNoteModal] = useState<Approval | null>(null)
  const [noteText, setNoteText] = useState('')
  const [escalateModal, setEscalateModal] = useState<Approval | null>(null)
  const [escalateReason, setEscalateReason] = useState('')
  const [expandedImpact, setExpandedImpact] = useState<string | null>(null)
  // Track which pending approvals are expanded to full-card view. Compact-by-default
  // prevents the inbox from feeling like a wall of giant cards. First urgent item
  // auto-opens so users don't always have to click into something.
  const [expandedPending, setExpandedPending] = useState<Set<string>>(new Set())
  const togglePendingExpand = (id: string) =>
    setExpandedPending((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const { role, canAction, getActionPermission } = useRole()

  const isApproverRole =
    role === 'approver' || role === 'access_approver' || role === 'admin'

  const q = query.trim().toLowerCase()
  const filtered = (filter === 'all' ? approvals : approvals.filter((a) => a.type === filter)).filter((a) => {
    if (!q) return true
    return (
      a.title.toLowerCase().includes(q) ||
      (a.impactedSystem ?? '').toLowerCase().includes(q) ||
      (a.requester ?? '').toLowerCase().includes(q)
    )
  })
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

  const handleAddNote = (approval: Approval) => {
    setNoteModal(approval)
    setNoteText('')
  }

  const confirmNote = () => {
    if (!noteModal || !noteText.trim()) return
    approvalNote.mutate(
      { id: noteModal.id, content: noteText.trim() },
      {
        onSuccess: () => {
          setNoteModal(null)
          setNoteText('')
        },
      },
    )
  }

  const handleEscalate = (approval: Approval) => {
    const perm = getActionPermission('escalate', 'Escalate')
    if (!perm.allowed) {
      setGuardModal({
        action: 'escalate',
        label: 'Escalate',
        reason: perm.reason || 'Not permitted',
      })
      return
    }
    setEscalateModal(approval)
    setEscalateReason('')
  }

  const confirmEscalate = () => {
    if (!escalateModal || !escalateReason.trim()) return
    approvalEscalate.mutate(
      {
        id: escalateModal.id,
        reason: escalateReason.trim(),
        expectedVersion: escalateModal.version,
      },
      {
        onSuccess: () => {
          setEscalateModal(null)
          setEscalateReason('')
        },
      },
    )
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
    <div className="flex flex-col gap-10">
      {/* Header */}
      <div className="flex flex-col gap-3">
        <h1 className="font-heading text-3xl font-medium tracking-tight text-foreground">
          Approvals
        </h1>
        <p className="text-sm text-muted-foreground">
          {pendingCount} pending {pendingCount === 1 ? 'approval' : 'approvals'} requiring action.
        </p>
      </div>

      {/* Banners */}
      {approvalDecision.error instanceof ApprovalConflictError && (
        <Alert variant="warning">
          <AlertTriangle />
          <AlertTitle>Approval changed while you were deciding</AlertTitle>
          <AlertDescription>
            Another approver acted on this request first. The latest state has been reloaded — review it
            before deciding again.
            <Button
              variant="ghost"
              size="sm"
              className="mt-3"
              onClick={() => approvalDecision.reset()}
            >
              Dismiss
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {approvalDecision.error && !(approvalDecision.error instanceof ApprovalConflictError) && (
        <Alert variant="destructive">
          <XCircle />
          <AlertTitle>Decision failed</AlertTitle>
          <AlertDescription>
            {approvalDecision.error.message}
            <Button
              variant="ghost"
              size="sm"
              className="mt-3"
              onClick={() => approvalDecision.reset()}
            >
              Dismiss
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Filter + search rail */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterType)}>
          <TabsList className="h-11 gap-1 p-1">
            {tabs.map((t) => (
              <TabsTrigger
                key={t.id}
                value={t.id}
                className="h-9 gap-2 px-4 text-sm font-medium flex-none"
              >
                <span>{t.label}</span>
                {t.count > 0 && (
                  <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px] font-semibold">
                    {t.count}
                  </Badge>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="relative w-full lg:w-80">
          <Search
            className="pointer-events-none absolute top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
            style={{ left: '0.875rem' }}
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title, system, requester..."
            style={{ height: '2.75rem', paddingLeft: '2.75rem', paddingRight: '1rem' }}
          />
        </div>
      </div>

      {isLoading && (
        <div className="flex flex-col gap-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-64 w-full" />
          ))}
        </div>
      )}

      {!isLoading && pending.length > 0 && (
        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <SectionLabel>Pending · {pending.length}</SectionLabel>
            {pending.length > 1 && (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() =>
                    setExpandedPending(new Set(pending.map((p) => p.id)))
                  }
                >
                  Expand all
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setExpandedPending(new Set())}
                >
                  Collapse all
                </Button>
              </div>
            )}
          </div>
          <div className="flex flex-col gap-3">
            {pending.map((approval) =>
              expandedPending.has(approval.id) ? (
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
                  onAddNote={() => handleAddNote(approval)}
                  onEscalate={() => handleEscalate(approval)}
                  onCollapse={() => togglePendingExpand(approval.id)}
                />
              ) : (
                <PendingMiniRow
                  key={approval.id}
                  approval={approval}
                  onExpand={() => togglePendingExpand(approval.id)}
                />
              ),
            )}
          </div>
        </section>
      )}

      {!isLoading && resolved.length > 0 && (
        <section className="flex flex-col gap-4">
          <SectionLabel>Resolved · {resolved.length}</SectionLabel>
          <Card>
            <CardContent className="p-0">
              <ul className="flex flex-col divide-y divide-border">
                {resolved.map((approval) => (
                  <ResolvedRow key={approval.id} approval={approval} />
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>
      )}

      {!isLoading && filtered.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-20">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Inbox className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">No approvals match this filter.</p>
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
              Approve with condition
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
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Note dialog */}
      <Dialog
        open={!!noteModal}
        onOpenChange={(open) => {
          if (!open) {
            setNoteModal(null)
            setNoteText('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-primary" />
              Add note
            </DialogTitle>
            <DialogDescription>
              Attach a note to this approval. Visible in the audit trail.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Capture rationale, clarification needed, or context for other approvers..."
            rows={5}
            autoFocus
          />
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setNoteModal(null)
                setNoteText('')
              }}
            >
              Cancel
            </Button>
            <Button onClick={confirmNote} disabled={!noteText.trim() || approvalNote.isPending}>
              {approvalNote.isPending ? 'Saving…' : 'Add note'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Escalate dialog */}
      <Dialog
        open={!!escalateModal}
        onOpenChange={(open) => {
          if (!open) {
            setEscalateModal(null)
            setEscalateReason('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowUpRight className="h-5 w-5 text-status-escalated" />
              Escalate approval
            </DialogTitle>
            <DialogDescription>
              Hand off to a senior reviewer. Approval status changes to <code>escalated</code>.
              Reason is recorded as a note + audit event.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={escalateReason}
            onChange={(e) => setEscalateReason(e.target.value)}
            placeholder="Why does this need senior review? (eg blast radius higher than expected, missing rollback plan...)"
            rows={5}
            autoFocus
          />
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setEscalateModal(null)
                setEscalateReason('')
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={confirmEscalate}
              disabled={!escalateReason.trim() || approvalEscalate.isPending}
              className="bg-status-escalated text-white hover:bg-status-escalated/90"
            >
              {approvalEscalate.isPending ? 'Escalating…' : 'Escalate'}
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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  )
}

// ─── Pending card ───────────────────────────────────────

interface PendingCardProps {
  approval: Approval
  isApproverRole: boolean
  canAction: (action: string) => boolean
  expandedImpact: boolean
  onToggleImpact: () => void
  onApprove: () => void
  onApproveWithCondition: () => void
  onDeny: () => void
  onAddNote: () => void
  onEscalate: () => void
  onCollapse?: () => void
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
  onAddNote,
  onEscalate,
  onCollapse,
}: PendingCardProps) {
  const risk = riskTone(approval.riskLevel)
  const canApprove = canAction('approve')

  return (
    <Card
      className={cn(
        'relative overflow-hidden before:absolute before:top-0 before:bottom-0 before:left-0 before:w-1 before:content-[""]',
        urgencyRail(approval),
      )}
    >
      {/* Why required strip */}
      {isApproverRole && approval.whyYouAreRequired && (
        <div className="flex items-start gap-3 border-b border-primary/25 bg-primary/10 px-6 py-3">
          <Info className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
          <p className="text-sm font-medium text-primary leading-relaxed">
            {approval.whyYouAreRequired}
          </p>
        </div>
      )}

      {/* Stage strip */}
      {isApproverRole && approval.coApprovals && approval.coApprovals.length > 1 && (
        <StageStrip approval={approval} />
      )}

      <CardHeader className="border-b">
        <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
          <span>{typeLabels[approval.type] ?? approval.type}</span>
          <span className="text-muted-foreground/50">·</span>
          <span className={cn('flex items-center gap-1', risk.text)}>
            <span className={cn('h-1.5 w-1.5 rounded-full', risk.dot)} />
            {risk.label} RISK
          </span>
        </div>
        <CardTitle className="font-heading text-xl leading-tight">
          {approval.title}
        </CardTitle>
        <CardDescription>
          Requested by <span className="text-foreground font-medium">{approval.requester}</span> · System{' '}
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground font-mono">
            {approval.impactedSystem}
          </code>
        </CardDescription>
        <CardAction>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              Submitted {timeAgo(approval.createdAt)}
            </span>
            {onCollapse && (
              <Button
                size="icon"
                variant="ghost"
                onClick={onCollapse}
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                aria-label="Collapse"
              >
                <ChevronDown className="h-4 w-4 rotate-180" />
              </Button>
            )}
          </div>
        </CardAction>
      </CardHeader>

      <CardContent className="grid grid-cols-1 gap-x-12 gap-y-6 py-6 lg:grid-cols-2">
        <Block label="Why approval is needed">
          <p className="text-sm text-foreground leading-relaxed">{approval.reason}</p>
        </Block>
        <Block label="Recommended action" highlight>
          <p className="text-sm text-foreground leading-relaxed">{approval.recommendedAction}</p>
        </Block>

        {approval.coApprovals && approval.coApprovals.length > 1 && (
          <Block
            label={
              <>
                <Users className="h-3.5 w-3.5" />
                Co-approval chain
              </>
            }
          >
            <ul className="flex flex-col gap-2">
              {approval.coApprovals.map((co, i) => (
                <li key={i}>
                  <CoApprovalRow co={co} />
                </li>
              ))}
            </ul>
          </Block>
        )}

        {isApproverRole && approval.decisionImpact && (
          <Block
            label={
              <>
                <AlertTriangle className="h-3.5 w-3.5" />
                Decision impact
              </>
            }
          >
            <button
              type="button"
              onClick={onToggleImpact}
              aria-expanded={expandedImpact}
              className={cn(
                'group/impact flex h-11 w-full items-center justify-between rounded-md border bg-muted px-4 text-left transition-colors hover:bg-[color-mix(in_oklch,var(--muted),var(--foreground)_5%)]',
                expandedImpact ? 'border-primary/40' : 'border-border',
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
              <div className="mt-3 flex flex-col gap-3 rounded-md border border-border bg-muted/50 px-4 py-3">
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
          </Block>
        )}

        {/* Notes thread — surfaces ANY note attached by humans during triage
            (rationale, clarification asks, escalation reasons). Each note is
            editable + deletable by its author or admin. Agent context loader
            reads the same list and feeds it into support_approval_decision. */}
        {(approval.notes?.length ?? 0) > 0 && (
          <NotesSection approval={approval} />
        )}
      </CardContent>

      <Separator />

      <CardFooter className="flex flex-wrap items-center justify-end gap-3 py-5">
        {canAction('attach_notes') && (
          <Button variant="ghost" size="lg" className="mr-auto px-5" onClick={onAddNote}>
            <MessageSquare />
            Add note
          </Button>
        )}
        {canAction('escalate') && (
          <Button
            variant="outline"
            size="lg"
            onClick={onEscalate}
            className="min-w-[10rem] px-6 border-status-escalated/40 text-status-escalated hover:bg-status-escalated/10 hover:text-status-escalated"
          >
            <ArrowUpRight />
            Escalate
          </Button>
        )}
        {canApprove ? (
          <>
            <Button
              variant="outline"
              size="lg"
              onClick={onApproveWithCondition}
              className="min-w-[12rem] px-6 border-status-pending/40 text-status-pending hover:bg-status-pending/10 hover:text-status-pending"
            >
              <FileCheck />
              Approve with condition
            </Button>
            <Button
              size="lg"
              onClick={onDeny}
              className="min-w-[8rem] px-7 bg-status-denied text-white hover:bg-status-denied/90"
            >
              <XCircle />
              Deny
            </Button>
            <Button
              size="lg"
              onClick={onApprove}
              className="min-w-[8rem] px-7 bg-status-approved text-white hover:bg-status-approved/90"
            >
              <CheckCircle2 />
              Approve
            </Button>
          </>
        ) : (
          <Button variant="outline" size="lg" disabled className="px-6">
            <Lock />
            Approver role required
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}

function Block({
  label,
  children,
  highlight,
}: {
  label: React.ReactNode
  children: React.ReactNode
  highlight?: boolean
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={cn(highlight && 'rounded-md bg-muted p-4')}>{children}</div>
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
        'flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-border px-6 py-3 text-sm',
        isMyTurnFinal
          ? 'bg-status-approved/8'
          : isMyTurnIntermediate
            ? 'bg-status-pending/8'
            : 'bg-muted/40',
      )}
    >
      <div className="flex items-center gap-2.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Stage
        </span>
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-24 rounded-full bg-muted overflow-hidden">
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

      {myEntry && (
        <Badge
          variant={isMyTurnFinal ? 'success' : isMyTurnIntermediate ? 'warning' : 'secondary'}
          className="gap-1.5"
        >
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
          {isMyTurnFinal
            ? 'Your decision is final'
            : isMyTurnIntermediate
              ? 'Your decision advances the chain'
              : 'You have decided'}
        </Badge>
      )}

      {pendingOthers.length > 0 && (
        <div className="ml-auto flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Waiting on</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {pendingOthers.map((c) => (
              <Badge key={c.name} variant="warning" className="gap-1">
                <Clock className="h-3 w-3" />
                {c.name}
              </Badge>
            ))}
          </div>
        </div>
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
  const isYou = co.name === 'you'
  const Icon =
    co.status === 'approved' ? CheckCircle2 : co.status === 'denied' ? XCircle : Clock

  const tone =
    co.status === 'approved'
      ? { iconColor: 'text-status-approved', badge: 'success', label: 'Approved' }
      : co.status === 'denied'
        ? { iconColor: 'text-status-denied', badge: 'danger', label: 'Denied' }
        : { iconColor: 'text-status-pending', badge: 'warning', label: 'Awaiting' }

  const initials =
    co.name === 'you'
      ? 'YOU'
      : co.name
          .split(/[\s.]/)
          .map((s) => s[0])
          .slice(0, 2)
          .join('')
          .toUpperCase()

  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-muted/40 px-3 py-2.5">
      <Avatar className="h-8 w-8">
        <AvatarFallback
          className={cn(
            'text-[10px] font-semibold',
            isYou ? 'bg-primary/20 text-primary' : 'bg-secondary text-foreground',
          )}
        >
          {initials}
        </AvatarFallback>
      </Avatar>
      <Icon className={cn('h-4 w-4 flex-shrink-0', tone.iconColor)} />
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            'text-sm font-medium truncate',
            isYou ? 'text-primary' : 'text-foreground',
          )}
        >
          {isYou ? 'You' : co.name}
        </div>
        <div className="text-xs text-muted-foreground truncate">{co.role}</div>
      </div>
      <Badge variant={tone.badge as 'success' | 'danger' | 'warning'} className="text-[10px]">
        {tone.label}
      </Badge>
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
      <span className="flex-shrink-0 mt-0.5">{icon}</span>
      <div className="min-w-0">
        <div className={cn('text-[10px] font-semibold uppercase tracking-wider', color)}>
          {label}
        </div>
        <p className="mt-0.5 text-sm text-foreground leading-relaxed">{text}</p>
      </div>
    </div>
  )
}

// ─── Resolved row ───────────────────────────────────────

/**
 * Compact one-line representation of a pending approval. Default state for
 * the inbox so it scans like a list, not a wall of giant cards. Clicking
 * anywhere on the row expands to the full PendingApprovalCard via parent
 * state, with action buttons + all context blocks.
 */
function PendingMiniRow({
  approval,
  onExpand,
}: {
  approval: Approval
  onExpand: () => void
}) {
  const risk = riskTone(approval.riskLevel)
  return (
    <button
      type="button"
      onClick={onExpand}
      className={cn(
        'group flex items-center gap-4 w-full rounded-lg border bg-card text-left transition-colors hover:border-primary/40 hover:bg-card/90 relative overflow-hidden',
        'before:absolute before:top-0 before:bottom-0 before:left-0 before:w-1 before:content-[""]',
        urgencyRail(approval),
      )}
      style={{ padding: '0.875rem 1.25rem 0.875rem 1.5rem' }}
    >
      <span
        className={cn(
          'flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider flex-shrink-0',
          risk.text,
        )}
      >
        <span className={cn('h-1.5 w-1.5 rounded-full', risk.dot)} />
        {risk.label} RISK
      </span>
      <span className="hidden md:inline text-muted-foreground/50">·</span>
      <span className="hidden md:inline text-xs font-medium uppercase tracking-wider text-muted-foreground flex-shrink-0">
        {typeLabels[approval.type]}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground truncate">{approval.title}</div>
        <div className="text-xs text-muted-foreground truncate mt-0.5">
          {approval.requester} · <code className="rounded bg-muted px-1 py-0.5 font-mono">{approval.impactedSystem}</code> · {timeAgo(approval.createdAt)}
        </div>
      </div>
      {approval.coApprovals && approval.coApprovals.length > 0 && (() => {
        const done = approval.coApprovals.filter((c) => c.status === 'approved').length
        const total = approval.coApprovals.length
        return (
          <div className="hidden lg:flex items-center gap-2 flex-shrink-0">
            <Users className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs tabular-nums text-muted-foreground">
              {done}/{total}
            </span>
          </div>
        )
      })()}
      <Badge variant="warning" className="flex-shrink-0">
        <Clock className="h-3 w-3" />
        Pending
      </Badge>
      <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0 transition-transform group-hover:text-foreground" />
    </button>
  )
}

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
    <li className="flex items-center justify-between gap-4 px-6 py-4">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <Icon className={cn('h-4 w-4 flex-shrink-0', color)} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground truncate">{approval.title}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {approval.requester} · {typeLabels[approval.type]} · {timeAgo(approval.createdAt)}
            {approval.status === 'approved_with_condition' && approval.condition && (
              <span className="ml-1 text-status-pending">· Condition: {approval.condition}</span>
            )}
          </div>
        </div>
      </div>
      <Badge variant={variant}>{label}</Badge>
    </li>
  )
}

// ─── Notes thread ─────────────────────────────────────

/**
 * Renders the conversation of notes attached to an approval. Each note shows
 * actor, timestamp, "edited" marker if it was changed, plus inline edit + delete
 * affordances scoped to the current user (author or admin only).
 */
function NotesSection({ approval }: { approval: Approval }) {
  const notes = approval.notes ?? []
  const { user } = useAuth()
  const currentName = user?.name ?? ''
  const isAdmin = user?.role === 'admin'
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const editNote = useEditApprovalNote()
  const deleteNote = useDeleteApprovalNote()

  return (
    <div className="border-t pt-5">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
        Notes · {notes.length}
      </div>
      <ul className="flex flex-col gap-3">
        {notes.map((n) => {
          const canEdit = isAdmin || n.actor === currentName
          const isEditing = editingId === n.id
          return (
            <li
              key={n.id}
              className="rounded-md border border-border bg-card/40 px-3 py-2.5"
            >
              <div className="flex items-center justify-between gap-3 mb-1.5">
                <div className="flex items-center gap-2 min-w-0">
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
                          deleteNote.mutate({ id: approval.id, noteId: n.id })
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
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    rows={3}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-primary/50"
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
                          { id: approval.id, noteId: n.id, content: draft.trim() },
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
