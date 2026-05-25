/**
 * AccessReviewerAgent — autonomous, intake-time review of an AccessRequest.
 *
 * Pipeline:
 *   1. Load the AccessRequest + the requester user (for systemsOwned, manager, past requests).
 *   2. Build skill context (T1.b policy, T1.d catalog, T5 temporal).
 *   3. Run `evaluate_access_request`.
 *   4. Persist:
 *        - AccessRequest.riskLevel: keep the higher of intake vs evaluated.
 *        - AccessRequest.reason: append narrative if it differs.
 *        - AuditEvent: action="access_evaluated".
 *
 * Trust boundary: agent prepares + persists advisory fields; never decides
 * managerApproval or ownerApproval (those remain pending until human action).
 */

import { prisma } from '../../lib/prisma.js'
import { runSkill } from '../skills/index.js'
import type {
  EvaluateAccessRequestInput,
  EvaluateAccessRequestOutput,
} from '../skills/index.js'
import { createAuditEvent } from '../audit.js'
import { buildBaseContext, loadAuditSlice } from './context.js'
import { gateConfidence } from './confidence.js'
import type { RiskLevel as PrismaRiskLevel, UserRole } from '@prisma/client'

const RISK_RANK: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 }
function maxRisk(a: string, b: string): PrismaRiskLevel {
  return (RISK_RANK[a] >= RISK_RANK[b] ? a : b) as PrismaRiskLevel
}

const PRIVILEGE_BY_ROLE: Record<string, 'read' | 'write' | 'admin'> = {
  read: 'read',
  reader: 'read',
  viewer: 'read',
  read_admin: 'admin',
  write: 'write',
  writer: 'write',
  admin: 'admin',
  owner: 'admin',
}

function inferPrivilege(requestedRole: string): 'read' | 'write' | 'admin' {
  const lower = requestedRole.toLowerCase()
  for (const [key, level] of Object.entries(PRIVILEGE_BY_ROLE)) {
    if (lower.includes(key)) return level
  }
  return 'write' // default: assume write privilege
}

export interface ReviewAccessResult {
  requestId: string
  evaluate: { status: string; output?: EvaluateAccessRequestOutput; errorMessage?: string }
  appliedRiskLevel: string
  fieldsUpdated: string[]
}

export async function reviewAccessRequest(opts: {
  accessRequestDbId: string
  actor?: string
}): Promise<ReviewAccessResult> {
  const req = await prisma.accessRequest.findUnique({ where: { id: opts.accessRequestDbId } })
  if (!req) throw new Error(`AccessRequest not found: ${opts.accessRequestDbId}`)

  const actor = opts.actor ?? 'system'
  const ctx = await buildBaseContext({ actor, role: 'access_approver' })
  // T4 entity slice — prior decisions / re-evaluations on this same access
  // request. Helps the model spot re-submissions and ping-pong with the
  // approver instead of treating each call as a fresh request.
  ctx.t4 = await loadAuditSlice({
    objectType: 'access',
    objectId: req.requestId,
    limit: 15,
  })

  // Try to find the requester user by email or name
  const requesterUser = await prisma.user.findFirst({
    where: {
      OR: [{ email: req.requesterEmail }, { name: req.requester }],
    },
  })

  // Past requests by same requester (last 90d)
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
  const pastRequests = await prisma.accessRequest.findMany({
    where: {
      OR: [{ requesterEmail: req.requesterEmail }, { requester: req.requester }],
      id: { not: req.id },
      createdAt: { gte: ninetyDaysAgo },
    },
    take: 10,
    orderBy: { createdAt: 'desc' },
  })

  const orgCatalog = ctx.t1?.orgCatalog
  const serviceMeta = orgCatalog?.services[req.requestedSystem]
  const catalogTier = serviceMeta?.criticality ?? 'medium'

  const activeFreezeAffectingSystem = ctx.t1?.policyBundle?.activeFreezes.some(
    (f) => f.affectsServices.length === 0 || f.affectsServices.includes(req.requestedSystem),
  ) ?? false

  const requesterRole: UserRole = requesterUser?.role ?? 'engineer'
  const requesterTeam = requesterUser?.team ?? 'Unknown'

  const input: EvaluateAccessRequestInput = {
    request: {
      id: req.id,
      requestId: req.requestId,
      requester: req.requester,
      requesterEmail: req.requesterEmail,
      requestedSystem: req.requestedSystem,
      requestedRole: req.requestedRole,
      justification: req.justification,
      manager: req.manager,
      systemOwner: req.systemOwner,
      riskLevel: req.riskLevel,
      entitlementCheck: req.entitlementCheck,
    },
    requesterContext: {
      role: requesterRole,
      team: requesterTeam,
      managerId: requesterUser?.managerId ?? null,
      systemsOwned: requesterUser?.systemsOwned ?? [],
      pastRequests: pastRequests.map((p) => ({
        requestId: p.requestId,
        system: p.requestedSystem,
        role: p.requestedRole,
        status: p.status,
        resolvedAt: p.updatedAt.toISOString(),
      })),
    },
    systemContext: {
      catalogTier,
      rolePrivilegeLevel: inferPrivilege(req.requestedRole),
      activeFreezeAffectingSystem,
    },
  }

  const result = await runSkill<EvaluateAccessRequestInput, EvaluateAccessRequestOutput>(
    'evaluate_access_request',
    input,
    ctx,
    { actor },
  )

  const fieldsUpdated: string[] = []
  let appliedRisk: PrismaRiskLevel = req.riskLevel

  if (result.status === 'success' && result.output) {
    const e = result.output
    const gate = gateConfidence('evaluate_access_request', e.confidence)

    if (gate.verdict === 'skip') {
      // Low confidence — don't persist; audit only.
      await createAuditEvent({
        actor,
        action: 'access_evaluated',
        objectType: 'access',
        objectId: req.id,
        objectTitle: `${req.requestId}: ${req.requestedRole} on ${req.requestedSystem}`,
        result: 'escalated',
        details: `Evaluation SKIPPED: ${gate.note}. Suggested risk=${e.riskLevel}, quality=${e.justificationQuality}. Manual approver review recommended.`,
      })
    } else {
      appliedRisk = maxRisk(req.riskLevel, e.riskLevel)
      const updateData: Parameters<typeof prisma.accessRequest.update>[0]['data'] = {}

      if (appliedRisk !== req.riskLevel) {
        updateData.riskLevel = appliedRisk
        fieldsUpdated.push('riskLevel')
      }
      // Append narrative to reason if it adds value
      if (e.narrative && !req.reason.includes(e.narrative.slice(0, 40))) {
        updateData.reason = req.reason
          ? `${req.reason}\n\n[agent] ${e.narrative}`
          : `[agent] ${e.narrative}`
        fieldsUpdated.push('reason')
      }

      if (Object.keys(updateData).length > 0) {
        await prisma.accessRequest.update({ where: { id: req.id }, data: updateData })
      }

      const warnPrefix = gate.verdict === 'persist_with_warning' ? `[LOW CONFIDENCE — ${gate.note}] ` : ''
      await createAuditEvent({
        actor,
        action: 'access_evaluated',
        objectType: 'access',
        objectId: req.id,
        objectTitle: `${req.requestId}: ${req.requestedRole} on ${req.requestedSystem}`,
        result: 'success',
        details: `${warnPrefix}risk=${e.riskLevel} (applied=${appliedRisk}, confidence=${gate.confidence.toFixed(2)}), justification=${e.justificationQuality}, flags=${e.flags.length}`,
      })
    }
  } else {
    await createAuditEvent({
      actor,
      action: 'access_evaluated',
      objectType: 'access',
      objectId: req.id,
      objectTitle: `${req.requestId}: ${req.requestedRole} on ${req.requestedSystem}`,
      result: 'blocked',
      details: `evaluate_access_request failed: ${result.errorMessage ?? 'unknown error'}`,
    })
  }

  return {
    requestId: req.requestId,
    evaluate: {
      status: result.status,
      output: result.output,
      errorMessage: result.errorMessage,
    },
    appliedRiskLevel: appliedRisk,
    fieldsUpdated,
  }
}
