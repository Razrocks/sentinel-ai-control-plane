import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  Clock,
  ArrowUpRight,
  Send,
  MessageSquare,
  Unlock,
  AlertTriangle,
  Shield,
  UserCheck,
  Ban,
  Zap,
  Info,
  Lock,
  KeyRound,
  Timer,
  Eye,
  Database,
  Globe,
} from 'lucide-react'
import { useAccessRequest } from '@/hooks/useData'
import { useAccessRequestDecide, useReviewAccessRequestAgent } from '@/hooks/useMutations'
import type { AccessRequest } from '@/types'
import { RiskBadge, ApprovalBadge, PolicyBadge, SystemChip, ActionGuardModal, ContextualAssistant, ReanalyzeButton } from '@/components/shared'
import { formatDate } from '@/lib/utils'
import { useRole } from '@/lib/roles'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getRecommendedNextStep(request: AccessRequest) {
  if (request.managerApprovalRequired && request.managerApproval === 'pending') {
    return {
      icon: Send,
      color: 'text-primary',
      bg: 'bg-primary/10 border-accent/20',
      label: 'Route to manager',
      detail: `Manager approval is the next gate — route to ${request.manager}.`,
    }
  }
  if (
    request.ownerApprovalRequired &&
    request.ownerApproval === 'pending' &&
    request.managerApproval === 'approved'
  ) {
    return {
      icon: ArrowUpRight,
      color: 'text-primary',
      bg: 'bg-primary/10 border-accent/20',
      label: 'Route to system owner',
      detail: `Manager approved — ${request.systemOwner} sign-off needed.`,
    }
  }
  if (request.entitlementCheck === 'ineligible') {
    return {
      icon: AlertTriangle,
      color: 'text-risk-critical',
      bg: 'bg-risk-critical/10 border-risk-critical/20',
      label: 'Deny or escalate',
      detail: 'User is not eligible per entitlement policy.',
    }
  }
  const allClear =
    (!request.managerApprovalRequired || request.managerApproval === 'approved' || request.managerApproval === 'not_required') &&
    (!request.ownerApprovalRequired || request.ownerApproval === 'approved' || request.ownerApproval === 'not_required')
  if (allClear && request.entitlementCheck !== 'ineligible') {
    return {
      icon: Unlock,
      color: 'text-status-approved',
      bg: 'bg-status-approved/10 border-status-approved/20',
      label: 'Ready for grant execution',
      detail: 'All approvals obtained.',
    }
  }
  return {
    icon: Info,
    color: 'text-status-pending',
    bg: 'bg-status-pending/10 border-status-pending/20',
    label: 'Review and route',
    detail: 'Assess eligibility and route for approval.',
  }
}

type StepStatus = 'completed' | 'active' | 'locked'

function getApprovalSteps(request: AccessRequest) {
  const managerStatus: StepStatus =
    request.managerApproval === 'approved' || request.managerApproval === 'not_required'
      ? 'completed'
      : request.managerApproval === 'denied'
        ? 'active'       // denied is still "current" — show it
        : 'active'

  const ownerStatus: StepStatus =
    request.ownerApproval === 'approved' || request.ownerApproval === 'not_required'
      ? 'completed'
      : request.ownerApproval === 'denied'
        ? 'active'
        : managerStatus === 'completed'
          ? 'active'
          : 'locked'

  const allApprovalsClear = managerStatus === 'completed' && ownerStatus === 'completed'
  const grantStatus: StepStatus =
    request.status === 'approved' && allApprovalsClear
      ? 'completed'
      : allApprovalsClear
        ? 'active'
        : 'locked'

  return [
    {
      step: 1,
      label: 'Manager Approval',
      actor: request.manager,
      required: request.managerApprovalRequired,
      approvalState: request.managerApproval,
      status: managerStatus,
    },
    {
      step: 2,
      label: 'Owner Approval',
      actor: request.systemOwner,
      required: request.ownerApprovalRequired,
      approvalState: request.ownerApproval,
      status: ownerStatus,
    },
    {
      step: 3,
      label: 'Grant Execution',
      actor: null,
      required: true,
      approvalState: null,
      status: grantStatus,
    },
  ] as const
}

function getWhatHappensNext(request: AccessRequest) {
  if (request.status === 'approved') {
    return {
      icon: CheckCircle,
      color: 'text-status-approved',
      text: `Access will be granted to ${request.requestedSystem} with ${request.requestedRole} permissions. Grant is time-bound to 90 days.`,
    }
  }
  if (request.status === 'denied') {
    return {
      icon: XCircle,
      color: 'text-risk-critical',
      text: 'Requester will be notified. They can re-request with updated justification.',
    }
  }
  // pending / other
  const waitingOn: string[] = []
  if (request.managerApprovalRequired && request.managerApproval === 'pending') waitingOn.push(request.manager)
  if (request.ownerApprovalRequired && request.ownerApproval === 'pending') waitingOn.push(request.systemOwner)
  const who = waitingOn.length > 0 ? waitingOn.join(' and ') : 'approvers'
  return {
    icon: Clock,
    color: 'text-status-pending',
    text: `Waiting on ${who}. Operator can route or escalate.`,
  }
}

// ---------------------------------------------------------------------------
// Step timeline component
// ---------------------------------------------------------------------------

function StepIcon({ status, denied }: { status: StepStatus; denied?: boolean }) {
  if (denied) return <XCircle className="w-5 h-5 text-risk-critical" />
  if (status === 'completed') return <CheckCircle className="w-5 h-5 text-status-approved" />
  if (status === 'active') return <Clock className="w-5 h-5 text-status-pending" />
  return <Lock className="w-5 h-5 text-muted-foreground/40" />
}

function stepLineColor(status: StepStatus) {
  if (status === 'completed') return 'bg-status-approved/40'
  return 'bg-border'
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AccessRequestDetail() {
  const { id } = useParams<{ id: string }>()
  const [guardModal, setGuardModal] = useState<{
    open: boolean
    title: string
    description: string
    variant: 'danger' | 'warning' | 'info'
    action?: () => void
  } | null>(null)
  const { role, canAction, getBlockedActions, config } = useRole()

  const { data: request, isLoading } = useAccessRequest(id!)
  const accessDecide = useAccessRequestDecide()
  const reviewAgent = useReviewAccessRequestAgent()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Loading access request...</p>
      </div>
    )
  }

  if (!request) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Access request not found</p>
      </div>
    )
  }

  // -- Data --
  const nextStep = getRecommendedNextStep(request)
  const steps = getApprovalSteps(request)
  const whatsNext = getWhatHappensNext(request)

  // -- Actions with availability grouping --
  const allActions = [
    {
      key: 'route_manager',
      permission: 'route_manager',
      label: 'Route to Manager',
      icon: Send,
      style: 'bg-primary/10 text-primary hover:bg-primary/20',
      desc: `Send this access request to ${request.manager} for approval.`,
      variant: 'info' as const,
      disabled: false,
    },
    {
      key: 'route_owner',
      permission: 'route_owner',
      label: 'Route to Owner',
      icon: ArrowUpRight,
      style: 'bg-muted text-foreground/80 hover:bg-primary hover:text-foreground',
      desc: `Send this access request to ${request.systemOwner} for system owner approval.`,
      variant: 'info' as const,
      disabled: false,
    },
    {
      key: 'approve',
      permission: 'approve',
      label: 'Approve',
      icon: CheckCircle,
      style: 'bg-status-approved/10 text-status-approved hover:bg-status-approved/20',
      disabled: request.managerApprovalRequired && request.managerApproval !== 'approved',
      disabledReason: 'Manager approval is required first',
      desc: 'Approve this access request. The grant will be prepared for execution.',
      variant: 'warning' as const,
    },
    {
      key: 'deny',
      permission: 'deny',
      label: 'Deny',
      icon: XCircle,
      style: 'bg-risk-critical/10 text-risk-critical hover:bg-risk-critical/20',
      disabled: false,
      desc: 'Deny this access request. The requester will be notified.',
      variant: 'danger' as const,
    },
    {
      key: 'request_info',
      permission: 'request_info',
      label: 'Request More Info',
      icon: MessageSquare,
      style: 'bg-muted text-foreground/80 hover:bg-primary hover:text-foreground',
      disabled: false,
      desc: 'Ask the requester for additional information.',
      variant: 'info' as const,
    },
    {
      key: 'execute_grant',
      permission: 'execute_grant',
      label: 'Execute Grant',
      icon: Unlock,
      style: 'bg-status-approved/10 text-status-approved hover:bg-status-approved/20',
      disabled: !request.autoGrantAllowed || request.status !== 'approved',
      disabledReason: !request.autoGrantAllowed
        ? 'Auto-grant is not allowed for this request'
        : 'Request must be approved before grant execution',
      desc: 'Execute the approved access grant.',
      variant: 'warning' as const,
    },
  ]

  const availableActions = allActions.filter(a => canAction(a.permission) && !a.disabled)
  const blockedByState = allActions.filter(a => canAction(a.permission) && a.disabled)
  const blockedByRole = getBlockedActions().filter(b =>
    allActions.some(a => a.permission === b.action),
  )

  const NextStepIcon = nextStep.icon

  return (
    <div className="flex flex-col gap-10">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Link
          to="/access-requests"
          className="mt-1 flex h-9 w-9 items-center justify-center rounded-md hover:bg-muted transition-colors"
        >
          <ArrowLeft className="h-5 w-5 text-muted-foreground" />
        </Link>
        <div className="flex-1 min-w-0 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-mono text-muted-foreground">{request.requestId}</span>
            <RiskBadge level={request.riskLevel} />
            <ApprovalBadge
              state={
                request.status === 'pending'
                  ? 'pending'
                  : request.status === 'approved'
                    ? 'approved'
                    : 'denied'
              }
            />
            <PolicyBadge decision={request.policyDecision} />
          </div>
          <h1 className="font-heading text-3xl font-medium tracking-tight text-foreground break-words">
            {request.requester} &rarr; {request.requestedSystem}
          </h1>
          <p className="text-sm text-muted-foreground">
            Requesting {request.requestedRole} access
          </p>
        </div>
      </div>

      {/* 3-column grid */}
      <div className="grid grid-cols-[280px_1fr_280px] gap-5">
        {/* ---- LEFT: Request context ---- */}
        <div>
          <div className="bg-card rounded-lg border border-border p-4 space-y-4">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Request Details
            </h3>
            <div className="space-y-3">
              <div>
                <div className="text-xs text-muted-foreground">Requester</div>
                <div className="text-sm text-foreground">{request.requester}</div>
                <div className="text-xs text-muted-foreground">{request.requesterEmail}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Requested System</div>
                <SystemChip name={request.requestedSystem} />
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Requested Role</div>
                <div className="text-sm text-foreground">{request.requestedRole}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Justification</div>
                <div className="text-sm text-foreground/80 leading-relaxed">
                  {request.justification}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Manager</div>
                <div className="text-sm text-foreground">{request.manager}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">System Owner</div>
                <div className="text-sm text-foreground">{request.systemOwner}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Requested</div>
                <div className="text-sm text-foreground/80">{formatDate(request.createdAt)}</div>
              </div>
            </div>
          </div>
        </div>

        {/* ---- CENTER: Analysis ---- */}
        <div className="space-y-4 min-w-0">
          {/* Recommended Next Step callout */}
          <div
            className={`flex items-start gap-3 rounded-lg border p-4 ${nextStep.bg}`}
          >
            <Zap className={`w-5 h-5 flex-shrink-0 mt-0.5 ${nextStep.color}`} />
            <div>
              <div className={`text-sm font-semibold ${nextStep.color}`}>
                Recommended Next Step
              </div>
              <div className="text-sm text-foreground font-medium mt-0.5">
                {nextStep.label}
              </div>
              <div className="text-xs text-foreground/80 mt-0.5">{nextStep.detail}</div>
            </div>
          </div>

          {/* Main detail sections in collapsible accordion so users see only
              what they need. Eligibility + Approval Chain open by default,
              Grant Scope and What Happens Next collapse out of the way. */}
          <Card className="py-0">
          <Accordion type="multiple" defaultValue={['eligibility', 'chain']}>
          <AccordionItem value="eligibility" className="border-b last:border-b-0">
            <AccordionTrigger className="px-6 text-sm font-semibold">
              Eligibility &amp; Policy Evaluation
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-5 flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-muted rounded p-3">
                <div className="text-xs text-muted-foreground mb-1">Entitlement Check</div>
                <div
                  className={`text-sm font-medium ${
                    request.entitlementCheck === 'eligible'
                      ? 'text-status-approved'
                      : request.entitlementCheck === 'ineligible'
                        ? 'text-risk-critical'
                        : 'text-status-pending'
                  }`}
                >
                  {request.entitlementCheck === 'eligible'
                    ? 'Eligible'
                    : request.entitlementCheck === 'ineligible'
                      ? 'Ineligible'
                      : 'Review Required'}
                </div>
              </div>
              <div className="bg-muted rounded p-3">
                <div className="text-xs text-muted-foreground mb-1">Auto-Grant Eligible</div>
                <div
                  className={`text-sm font-medium ${
                    request.autoGrantAllowed ? 'text-status-approved' : 'text-risk-high'
                  }`}
                >
                  {request.autoGrantAllowed ? 'Yes' : 'No'}
                </div>
              </div>
            </div>

            <div className="bg-muted rounded p-4">
              <div className="text-xs text-muted-foreground mb-2">Policy Decision Reason</div>
              <div className="text-sm text-foreground leading-relaxed">{request.reason}</div>
            </div>

            {request.entitlementCheck === 'ineligible' && (
              <div className="flex items-center gap-2 bg-risk-critical/10 border border-risk-critical/20 rounded-lg p-3">
                <AlertTriangle className="w-4 h-4 text-risk-critical flex-shrink-0" />
                <span className="text-sm text-risk-critical">
                  User is not eligible for this access based on entitlement policy
                </span>
              </div>
            )}
          </AccordionContent>
          </AccordionItem>

          {/* Grant Scope — Access Approver / Approver / Admin */}
          {(role === 'access_approver' || role === 'approver' || role === 'admin') && (
            <AccordionItem value="grant_scope" className="border-b last:border-b-0">
              <AccordionTrigger className="px-6 text-sm font-semibold">
                <span className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-primary" />
                  Grant Scope
                </span>
              </AccordionTrigger>
              <AccordionContent className="px-6 pb-5 flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-muted rounded p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Database className="w-3 h-3 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground uppercase tracking-wider">System</span>
                  </div>
                  <div className="text-sm text-foreground font-mono">{request.requestedSystem}</div>
                </div>
                <div className="bg-muted rounded p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Shield className="w-3 h-3 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground uppercase tracking-wider">Role</span>
                  </div>
                  <div className="text-sm text-foreground">{request.requestedRole}</div>
                </div>
                <div className="bg-muted rounded p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Timer className="w-3 h-3 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground uppercase tracking-wider">Duration</span>
                  </div>
                  <div className="text-sm text-foreground">
                    {request.riskLevel === 'high' || request.riskLevel === 'critical' ? '24 hours (time-boxed)' : '90 days'}
                  </div>
                </div>
                <div className="bg-muted rounded p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Globe className="w-3 h-3 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground uppercase tracking-wider">Environment</span>
                  </div>
                  <div className="text-sm text-foreground">
                    {request.requestedSystem.toLowerCase().includes('prod') || request.requestedSystem.toLowerCase().includes('iam') ? 'Production' : 'All environments'}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-muted rounded p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Lock className="w-3 h-3 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground uppercase tracking-wider">Scope Limitation</span>
                  </div>
                  <div className="text-xs text-foreground/80">
                    {request.riskLevel === 'high' || request.riskLevel === 'critical'
                      ? 'Scoped to justification-specified resources only'
                      : 'Full role permissions within system'}
                  </div>
                </div>
                <div className="bg-muted rounded p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Eye className="w-3 h-3 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground uppercase tracking-wider">Audit</span>
                  </div>
                  <div className="text-xs text-foreground/80">
                    {request.riskLevel === 'high' || request.riskLevel === 'critical'
                      ? 'Full audit trail + session recording'
                      : 'Standard audit logging'}
                  </div>
                </div>
              </div>
              <div className="text-xs text-muted-foreground border-t border-border pt-2">
                Auto-revocation: {request.riskLevel === 'high' || request.riskLevel === 'critical' ? 'Access auto-revokes after time window expires' : 'Access expires at end of grant period'}
              </div>
            </AccordionContent>
            </AccordionItem>
          )}

          {/* Approval Chain Timeline */}
          <AccordionItem value="chain" className="border-b last:border-b-0">
            <AccordionTrigger className="px-6 text-sm font-semibold">
              Approval Chain
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-5 flex flex-col gap-4">
            <div className="relative pl-3">
              {steps.map((s, i) => {
                const isLast = i === steps.length - 1
                const isDenied =
                  s.approvalState === 'denied'
                const isNotRequired = s.approvalState === 'not_required'

                // Status label
                let statusLabel = ''
                let statusColor = 'text-muted-foreground'
                if (s.step === 3) {
                  // Grant execution step
                  if (s.status === 'locked') {
                    statusLabel = 'Locked until approvals clear'
                    statusColor = 'text-muted-foreground/60'
                  } else if (s.status === 'completed') {
                    statusLabel = 'Executed'
                    statusColor = 'text-status-approved'
                  } else {
                    statusLabel = 'Ready'
                    statusColor = 'text-status-pending'
                  }
                } else if (isNotRequired) {
                  statusLabel = 'Not Required'
                  statusColor = 'text-muted-foreground'
                } else if (isDenied) {
                  statusLabel = 'Denied'
                  statusColor = 'text-risk-critical'
                } else if (s.status === 'completed') {
                  statusLabel = 'Approved'
                  statusColor = 'text-status-approved'
                } else if (s.status === 'active') {
                  statusLabel = 'Pending'
                  statusColor = 'text-status-pending'
                } else {
                  statusLabel = 'Waiting'
                  statusColor = 'text-muted-foreground/60'
                }

                return (
                  <div key={s.step} className="relative flex items-start gap-3 pb-1">
                    {/* Vertical connector line */}
                    {!isLast && (
                      <div
                        className={`absolute left-[9px] top-[26px] w-0.5 h-[calc(100%-10px)] ${stepLineColor(
                          s.status,
                        )}`}
                      />
                    )}
                    {/* Icon */}
                    <div className="relative z-10 flex-shrink-0 mt-0.5">
                      <StepIcon status={s.status} denied={isDenied} />
                    </div>
                    {/* Content */}
                    <div className="flex-1 pb-4">
                      <div className="flex items-center justify-between">
                        <div className="text-sm text-foreground font-medium">
                          <span className="text-muted-foreground mr-1.5">Step {s.step}</span>
                          {s.label}
                        </div>
                        <span className={`text-xs font-medium ${statusColor}`}>
                          {statusLabel}
                        </span>
                      </div>
                      {s.actor && (
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {s.required ? 'Required' : 'Optional'} &middot; {s.actor}
                        </div>
                      )}
                      {s.step === 3 && (
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {s.status === 'locked'
                            ? 'Blocked until all prior approvals are obtained'
                            : s.status === 'active'
                              ? 'All approvals cleared — grant can be executed'
                              : 'Grant has been executed successfully'}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
            </AccordionContent>
          </AccordionItem>

          {/* What Happens Next */}
          <AccordionItem value="next" className="border-b last:border-b-0">
            <AccordionTrigger className="px-6 text-sm font-semibold">
              What Happens Next
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-5">
              <div className="flex items-start gap-3">
                <whatsNext.icon
                  className={`w-4 h-4 flex-shrink-0 mt-0.5 ${whatsNext.color}`}
                />
                <div className="text-sm text-foreground/80 leading-relaxed">{whatsNext.text}</div>
              </div>
            </AccordionContent>
          </AccordionItem>
          </Accordion>
          </Card>
        </div>

        {/* ---- RIGHT: Action rail ---- */}
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="text-sm font-semibold">AI Analysis</CardTitle>
            </CardHeader>
            <CardContent className="py-4">
              <ReanalyzeButton
                kind="access_request"
                entityIdOrTicket={request.requestId}
                userRole={role}
                mutate={reviewAgent.mutate}
                isPending={reviewAgent.isPending}
                isError={reviewAgent.isError}
                isSuccess={reviewAgent.isSuccess}
                error={reviewAgent.error}
                data={reviewAgent.data}
              />
            </CardContent>
          </Card>

          {/* Sentinel mini assistant — high up so quick prompts visible without scroll */}
          <ContextualAssistant
            entityType="access_request"
            entityId={request.id}
            entityTitle={`${request.requester} → ${request.requestedSystem}`}
            quickActions={
              role === 'access_approver' ? [
                { label: 'What would be granted?', prompt: `What exactly would ${request.requester} get with ${request.requestedRole} on ${request.requestedSystem}?` },
                { label: 'Is this time-boxed?', prompt: `Is this access request time-boxed? What are the revocation triggers?` },
                { label: 'Who still needs to approve?', prompt: `Who else needs to approve ${request.requestId} after me?` },
                { label: 'Why no auto-grant?', prompt: `Why is auto-grant not allowed for this access request?` },
                { label: 'Least-privilege alternative', prompt: `Is there a more restrictive role than ${request.requestedRole} that would still satisfy the justification?` },
                { label: 'Draft clarification', prompt: `Draft a clarification request to ${request.requester} about their justification.` },
              ] : [
                { label: 'Check eligibility', prompt: `Is ${request.requester} eligible for ${request.requestedRole} on ${request.requestedSystem}?` },
                { label: 'Route this request', prompt: `Who should approve ${request.requestId}?` },
                { label: 'Policy check', prompt: `What policies apply to this access request?` },
              ]
            }
          />

          <Card>
            <CardHeader className="border-b">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm font-semibold">Available Now</CardTitle>
                <Badge variant="secondary" className="text-[10px] uppercase tracking-wider">{config.label}</Badge>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 py-4">
              {availableActions.length === 0 && (
                <p className="text-sm text-muted-foreground">No actions available right now.</p>
              )}
              {availableActions.map(a => {
                const Icon = a.icon
                return (
                  <button
                    key={a.key}
                    onClick={() => {
                      const actionFn = (() => {
                        if (a.key === 'approve') return () => {
                          const approverRole = role === 'access_approver' ? 'owner' : (request.managerApproval === 'pending' ? 'manager' : 'owner')
                          accessDecide.mutate({ id: request.requestId, decision: 'approved', role: approverRole })
                          setGuardModal(null)
                        }
                        if (a.key === 'deny') return () => {
                          const approverRole = role === 'access_approver' ? 'owner' : (request.managerApproval === 'pending' ? 'manager' : 'owner')
                          accessDecide.mutate({ id: request.requestId, decision: 'denied', role: approverRole })
                          setGuardModal(null)
                        }
                        return () => setGuardModal(null)
                      })()
                      setGuardModal({
                        open: true,
                        title: a.label,
                        description: a.desc,
                        variant: a.variant,
                        action: actionFn,
                      })
                    }}
                    className={`flex h-11 w-full items-center gap-3 rounded-md px-4 text-sm font-medium transition-colors ${a.style}`}
                  >
                    <Icon className="h-4 w-4 flex-shrink-0" />
                    <span className="flex-1 text-left">{a.label}</span>
                  </button>
                )
              })}
            </CardContent>
          </Card>

          {/* Decision Impact — Approver only */}
          {(role === 'approver' || role === 'access_approver' || role === 'admin') && (() => {
            const allApprovalsClear =
              (!request.managerApprovalRequired || request.managerApproval === 'approved' || request.managerApproval === 'not_required') &&
              (!request.ownerApprovalRequired || request.ownerApproval === 'approved' || request.ownerApproval === 'not_required')
            const remainingApprovers: string[] = []
            if (request.managerApprovalRequired && request.managerApproval === 'pending') remainingApprovers.push(request.manager)
            if (request.ownerApprovalRequired && request.ownerApproval === 'pending') remainingApprovers.push(request.systemOwner)
            const isFinalApproval = remainingApprovers.length <= 1
            const isTimeBoxed = request.riskLevel === 'high' || request.riskLevel === 'critical'

            return (
              <div className="bg-card rounded-lg border border-accent/20 p-4 space-y-3">
                <h3 className="text-xs font-medium text-primary uppercase tracking-wider flex items-center gap-1.5">
                  <AlertTriangle className="w-3 h-3" />
                  Decision Impact
                </h3>

                {/* Chain status strip */}
                <div className={`rounded p-2 text-xs font-medium flex items-center gap-2 ${
                  isFinalApproval && !allApprovalsClear
                    ? 'bg-primary/10 text-primary'
                    : allApprovalsClear
                    ? 'bg-status-approved/10 text-status-approved'
                    : 'bg-status-pending/10 text-status-pending'
                }`}>
                  {isFinalApproval && !allApprovalsClear ? (
                    <><UserCheck className="w-3 h-3" /> Your approval is the final gate — this will grant access</>
                  ) : allApprovalsClear ? (
                    <><CheckCircle className="w-3 h-3" /> All approvals cleared — ready for grant execution</>
                  ) : (
                    <><Clock className="w-3 h-3" /> Your approval advances the chain — {remainingApprovers.length - 1} more approver{remainingApprovers.length - 1 !== 1 ? 's' : ''} after you</>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex gap-2">
                    <CheckCircle className="w-3 h-3 text-status-approved flex-shrink-0 mt-0.5" />
                    <div>
                      <div className="text-xs font-medium text-status-approved uppercase">If approved</div>
                      <p className="text-xs text-foreground/80">
                        {isFinalApproval
                          ? `${request.requester} receives ${request.requestedRole} on ${request.requestedSystem}.`
                          : `Advances to next approver. Does not yet grant access.`}
                        {isFinalApproval && isTimeBoxed && ' Time-boxed access with full audit trail.'}
                        {isFinalApproval && !isTimeBoxed && ' Standard access provisioned.'}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <XCircle className="w-3 h-3 text-status-denied flex-shrink-0 mt-0.5" />
                    <div>
                      <div className="text-xs font-medium text-status-denied uppercase">If denied</div>
                      <p className="text-xs text-foreground/80">
                        Access not granted. {request.requester} notified. Can re-request with updated justification.
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <ArrowUpRight className="w-3 h-3 text-status-escalated flex-shrink-0 mt-0.5" />
                    <div>
                      <div className="text-xs font-medium text-status-escalated uppercase">If escalated</div>
                      <p className="text-xs text-foreground/80">
                        Routes to Security for additional review. Access remains blocked until resolution.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Grant details */}
                {isFinalApproval && (
                  <div className="border-t border-border pt-2 space-y-1">
                    <div className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Grant details</div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="text-muted-foreground">Duration</div>
                      <div className="text-foreground/80">{isTimeBoxed ? '24h time-boxed' : '90 days'}</div>
                      <div className="text-muted-foreground">Scope</div>
                      <div className="text-foreground/80">{isTimeBoxed ? 'Scoped to justification' : 'Full role'}</div>
                      <div className="text-muted-foreground">Audit</div>
                      <div className="text-foreground/80">{isTimeBoxed ? 'Session recording' : 'Standard logging'}</div>
                    </div>
                  </div>
                )}
              </div>
            )
          })()}

          {(blockedByState.length > 0 || blockedByRole.length > 0) && (
            <Card>
              <CardHeader className="border-b">
                <CardTitle className="text-sm font-semibold">Not Available</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 py-4">
                {blockedByState.map(a => {
                  const Icon = a.icon
                  return (
                    <div key={a.key} className="flex items-start gap-3 rounded-md px-3 py-2.5 text-muted-foreground">
                      <Icon className="h-4 w-4 flex-shrink-0 mt-0.5" />
                      <div className="flex flex-col gap-1 min-w-0">
                        <div className="text-sm font-medium text-foreground/85">{a.label}</div>
                        <div className="text-xs leading-relaxed">
                          {'disabledReason' in a && a.disabledReason
                            ? a.disabledReason
                            : 'Blocked by current request state'}
                        </div>
                      </div>
                    </div>
                  )
                })}
                {blockedByRole.map(blocked => (
                  <div key={blocked.action} className="flex items-start gap-3 rounded-md px-3 py-2.5 text-muted-foreground">
                    <Ban className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <div className="flex flex-col gap-1 min-w-0">
                      <div className="text-sm font-medium text-foreground/85">{blocked.label}</div>
                      <div className="text-xs leading-relaxed">{blocked.reason}</div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Guard modal */}
      {guardModal?.open && (
        <ActionGuardModal
          isOpen={true}
          title={guardModal.title}
          description={guardModal.description}
          confirmLabel="Confirm"
          onConfirm={() => { guardModal.action ? guardModal.action() : setGuardModal(null) }}
          onCancel={() => setGuardModal(null)}
          variant={guardModal.variant}
        />
      )}
    </div>
  )
}
