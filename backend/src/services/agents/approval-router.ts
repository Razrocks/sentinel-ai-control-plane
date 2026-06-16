/**
 * ApprovalRouterAgent — autonomous, runs at Approval row construction time.
 *
 * Pipeline:
 *   1. Load the Approval + linked entity (change | access_request | incident).
 *   2. Build skill context (T1.b policy, T1.d catalog, T5 temporal).
 *   3. Run `route_request` to identify the chain participants.
 *   4. Apply SOD: drop participants where isFiler === true; record audit warning.
 *   5. Persist:
 *        - CoApproval rows (replace existing if any).
 *        - AuditEvent: action="approval_chain_constructed".
 *   6. Run `support_approval_decision` to populate decisionImpact.
 *   7. Persist:
 *        - DecisionImpact row (upsert).
 *        - Approval.whyYouAreRequired (joins per-approver "why" strings).
 *        - AuditEvent: action="decision_impact_generated".
 *
 * Trust boundary: agent prepares the chain + impact prose; the decision itself
 * remains with the human approvers acting through `routes/actions.ts`.
 */

import { prisma } from '../../lib/prisma.js'
import { runSkill } from '../skills/index.js'
import type {
  RouteRequestInput,
  RouteRequestOutput,
  SupportApprovalDecisionInput,
  SupportApprovalDecisionOutput,
} from '../skills/index.js'
import { createAuditEvent } from '../audit.js'
import { buildBaseContext } from './context.js'

export interface RouteApprovalResult {
  approvalId: string
  route: { status: string; output?: RouteRequestOutput; errorMessage?: string }
  impact: { status: string; output?: SupportApprovalDecisionOutput; errorMessage?: string }
  coApprovalsWritten: number
  filerOmitted: number
  decisionImpactWritten: boolean
}

export async function routeApproval(opts: {
  approvalId: string
  filerName?: string
  requiredApproverRoles?: string[]
  actor?: string
}): Promise<RouteApprovalResult> {
  const approval = await prisma.approval.findUnique({
    where: { id: opts.approvalId },
    include: { coApprovals: true, decisionImpact: true },
  })
  if (!approval) throw new Error(`Approval not found: ${opts.approvalId}`)

  const actor = opts.actor ?? 'system'
  const ctx = await buildBaseContext({ actor })

  // Determine required roles. If caller did not supply, derive from existing coApprovals
  // (re-route case) or default by approval.type.
  const defaultRolesByType: Record<string, string[]> = {
    change: ['SRE-Owner', 'Database-Owner', 'Risk-Compliance'],
    access: ['manager-of-requester', 'owner-of-system'],
    remediation: ['SRE-Owner', 'Risk-Compliance'],
    escalation: ['Senior-Approver'],
  }
  const requiredApproverRoles =
    opts.requiredApproverRoles ??
    (approval.coApprovals.length > 0
      ? Array.from(new Set(approval.coApprovals.map((c) => c.role)))
      : defaultRolesByType[approval.type] ?? ['Approver'])

  // ── Load linked entity for relevantFields ─────────────
  let relevantFields: Record<string, unknown> = {}
  let linkedEntityType = ''
  let linkedEntityData: unknown = null

  if (approval.type === 'change') {
    const change = await prisma.change.findFirst({
      where: { OR: [{ id: approval.linkedObjectId }, { ticketId: approval.linkedObjectId }] },
    })
    if (change) {
      relevantFields = {
        service: change.service,
        environment: change.environment,
        riskLevel: change.riskLevel,
        ownerTeam: change.ownerTeam,
      }
      linkedEntityType = 'change'
      linkedEntityData = change
    }
  } else if (approval.type === 'access') {
    const ar = await prisma.accessRequest.findFirst({
      where: { OR: [{ id: approval.linkedObjectId }, { requestId: approval.linkedObjectId }] },
    })
    if (ar) {
      relevantFields = {
        requestedSystem: ar.requestedSystem,
        requestedRole: ar.requestedRole,
        riskLevel: ar.riskLevel,
        manager: ar.manager,
        systemOwner: ar.systemOwner,
      }
      linkedEntityType = 'access_request'
      linkedEntityData = ar
    }
  } else {
    relevantFields = { impactedSystem: approval.impactedSystem, riskLevel: approval.riskLevel }
    linkedEntityType = approval.type
    linkedEntityData = { id: approval.linkedObjectId }
  }

  // ── Build orgCatalog snippet for the skill ───────────
  const cat = ctx.t1?.orgCatalog
  const usersByRole: RouteRequestInput['orgCatalog']['usersByRole'] = {}
  const serviceOwners: RouteRequestInput['orgCatalog']['serviceOwners'] = {}
  const managerHierarchy: RouteRequestInput['orgCatalog']['managerHierarchy'] = {}

  if (cat) {
    // Group users by role (Sentinel role, e.g. "approver")
    const byRole: Record<string, typeof cat.users> = {}
    for (const u of cat.users) {
      if (!byRole[u.role]) byRole[u.role] = []
      byRole[u.role].push(u)
    }
    for (const [role, users] of Object.entries(byRole)) {
      usersByRole[role] = users.map((u) => ({ id: u.id, name: u.name, team: u.team }))
    }
    // Also expose required roles even if empty so the skill knows the slate
    for (const role of requiredApproverRoles) {
      if (!usersByRole[role]) {
        // Map likely synonyms
        if (role === 'manager-of-requester') {
          usersByRole[role] = []
        } else if (role === 'owner-of-system') {
          usersByRole[role] = []
        } else {
          // Fallback: include all approvers + admins
          const approvers = cat.users.filter(
            (u) => u.role === 'approver' || u.role === 'access_approver' || u.role === 'admin',
          )
          usersByRole[role] = approvers.map((u) => ({ id: u.id, name: u.name, team: u.team }))
        }
      }
    }
    // Service-owner lookups
    for (const [svc, meta] of Object.entries(cat.services)) {
      serviceOwners[svc] = meta.ownerUserIds
        .map((id) => cat.users.find((u) => u.id === id))
        .filter((u): u is NonNullable<typeof u> => Boolean(u))
        .map((u) => ({ id: u.id, name: u.name, team: u.team }))
    }
    // Manager hierarchy
    for (const u of cat.users) {
      managerHierarchy[u.id] = u.managerId
    }
  }

  // ── 1. route_request ──────────────────────────────────
  const routeInput: RouteRequestInput = {
    entity: {
      type: approval.type as 'change' | 'access' | 'remediation' | 'escalation',
      id: approval.linkedObjectId,
      title: approval.title,
      relevantFields,
    },
    policyContext: {
      requiredApproverRoles,
      activeFreezesAffecting:
        ctx.t1?.policyBundle?.activeFreezes.map((f) => f.id) ?? [],
    },
    orgCatalog: { usersByRole, serviceOwners, managerHierarchy },
    filerName: opts.filerName,
    mode: 'construct_chain',
  }

  const route = await runSkill<RouteRequestInput, RouteRequestOutput>(
    'route_request',
    routeInput,
    ctx,
    { actor },
  )

  let coApprovalsWritten = 0
  let filerOmitted = 0

  if (route.status === 'success' && route.output) {
    // Apply SOD: drop isFiler entries
    const accepted = route.output.participants.filter((p) => !p.isFiler)
    filerOmitted = route.output.participants.length - accepted.length

    // B3: replace existing coApprovals atomically. delete + createMany must
    // either both succeed or both roll back — orphan state (no rows after
    // delete, before createMany crashes) breaks the approval chain.
    coApprovalsWritten = await prisma.$transaction(async (tx) => {
      await tx.coApproval.deleteMany({ where: { approvalId: approval.id } })
      if (accepted.length === 0) return 0
      await tx.coApproval.createMany({
        data: accepted.map((p) => ({
          approvalId: approval.id,
          role: p.role,
          name: p.name,
          status: 'pending' as const,
        })),
      })
      return accepted.length
    })

    await createAuditEvent({
      actor,
      action: 'approval_chain_constructed',
      objectType: 'approval',
      objectId: approval.id,
      objectTitle: approval.title,
      result: filerOmitted > 0 ? 'escalated' : 'success',
      details: accepted.map((p) => `${p.role}: ${p.name}`).join(', ') +
        (filerOmitted > 0 ? ` (${filerOmitted} omitted: SOD conflict)` : '') +
        (route.output.unresolvedRoles.length > 0
          ? ` UNRESOLVED: ${route.output.unresolvedRoles.join(', ')}`
          : ''),
    })
  } else {
    await createAuditEvent({
      actor,
      action: 'approval_chain_constructed',
      objectType: 'approval',
      objectId: approval.id,
      objectTitle: approval.title,
      result: 'blocked',
      details: `route_request failed: ${route.errorMessage ?? 'unknown error'}`,
    })
  }

  // ── 2. support_approval_decision ──────────────────────
  // Reload coApprovals + notes to feed the decision-impact skill. Notes
  // carry human rationale (escalation reason, requested clarifications) the
  // agent needs to acknowledge in its impact prose. Soft-deleted hidden.
  const refreshed = await prisma.approval.findUnique({
    where: { id: approval.id },
    include: {
      coApprovals: true,
      notes: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
    },
  })
  if (!refreshed) {
    throw new Error('Approval disappeared mid-pipeline')
  }

  // Flatten notes into a single prose blob the skill can quote directly. We
  // keep them ordered chronologically so the model sees the conversation
  // flow (eg "needs clarification" → response → escalation reason).
  const humanNotesProse = refreshed.notes
    .map((n) => `[${n.createdAt.toISOString()}] ${n.actor}: ${n.content}`)
    .join('\n')

  const supportInput: SupportApprovalDecisionInput = {
    approval: {
      id: refreshed.id,
      type: refreshed.type as 'change' | 'access' | 'remediation' | 'escalation',
      title: refreshed.title,
      requester: refreshed.requester,
      impactedSystem: refreshed.impactedSystem,
      riskLevel: refreshed.riskLevel,
      reason: refreshed.reason,
      recommendedAction: refreshed.recommendedAction,
      linkedObjectId: refreshed.linkedObjectId,
      coApprovals: refreshed.coApprovals.map((c) => ({
        role: c.role,
        name: c.name,
        status: c.status as 'approved' | 'pending' | 'denied',
      })),
      humanNotes: humanNotesProse || undefined,
    },
    linkedEntity: { type: linkedEntityType, data: linkedEntityData },
    policyContext: {
      activePolicyRules:
        ctx.t1?.policyBundle?.rules.map((r) => ({
          name: r.name,
          description: r.description,
          decision: r.decision as 'allow' | 'deny' | 'escalate' | 'simulate_only',
          // Pass the admin-authored context through so the support_approval
          // skill can reason over WHY a rule exists, not just what it forbids.
          rationale: r.rationale,
          examples: r.examples,
          tags: r.tags,
        })) ?? [],
      activeFreezesAffecting: ctx.t1?.policyBundle?.activeFreezes.map((f) => f.id) ?? [],
    },
  }

  const support = await runSkill<SupportApprovalDecisionInput, SupportApprovalDecisionOutput>(
    'support_approval_decision',
    supportInput,
    ctx,
    { actor },
  )

  let decisionImpactWritten = false

  if (support.status === 'success' && support.output) {
    const s = support.output
    await prisma.decisionImpact.upsert({
      where: { approvalId: approval.id },
      create: {
        approvalId: approval.id,
        approve: s.approve,
        deny: s.deny,
        escalate: s.escalate,
      },
      update: {
        approve: s.approve,
        deny: s.deny,
        escalate: s.escalate,
      },
    })
    decisionImpactWritten = true

    // Compose whyYouAreRequired: list of "{role} {name}: {why}"
    const whyJoined = s.whyEachApproverIsRequired
      .map((w) => `${w.role} (${w.name}): ${w.why}`)
      .join('\n')
    await prisma.approval.update({
      where: { id: approval.id },
      data: { whyYouAreRequired: whyJoined || null },
    })

    await createAuditEvent({
      actor,
      action: 'decision_impact_generated',
      objectType: 'approval',
      objectId: approval.id,
      objectTitle: approval.title,
      result: 'success',
      details: `decisionImpact populated for ${approval.id}`,
    })
  } else {
    await createAuditEvent({
      actor,
      action: 'decision_impact_generated',
      objectType: 'approval',
      objectId: approval.id,
      objectTitle: approval.title,
      result: 'blocked',
      details: `support_approval_decision failed: ${support.errorMessage ?? 'unknown error'}`,
    })
  }

  return {
    approvalId: approval.id,
    route: {
      status: route.status,
      output: route.output,
      errorMessage: route.errorMessage,
    },
    impact: {
      status: support.status,
      output: support.output,
      errorMessage: support.errorMessage,
    },
    coApprovalsWritten,
    filerOmitted,
    decisionImpactWritten,
  }
}
