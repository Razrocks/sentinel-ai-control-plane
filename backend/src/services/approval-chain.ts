import { prisma } from '../lib/prisma.js'
import { NotFoundError, ValidationError } from '../lib/errors.js'
import { logApprovalDecision, logAllApprovalsComplete } from './audit.js'
import type { ApprovalStatus, CoApprovalStatus, AuditObjectType } from '@prisma/client'

// ─── Types ──────────────────────────────────────────────

export interface CoApprovalResult {
  approval: {
    id: string
    status: ApprovalStatus
    condition: string | null
    linkedObjectId: string
    type: string
    title: string
  }
  coApproval: {
    id: string
    role: string
    name: string
    status: CoApprovalStatus
    decidedAt: Date | null
  }
  isComplete: boolean      // All co-approvals resolved (no more pending)
  isFinalApproval: boolean // This was the co-approval that completed the chain
  allApproved: boolean     // All co-approvers approved (none denied)
}

// ─── Core State Machine ─────────────────────────────────

/**
 * Resolve a co-approval entry within an approval chain.
 *
 * This is the core state machine:
 * 1. Find the approval + all co-approvals
 * 2. Find the matching co-approval entry (by actor name or by role)
 * 3. Validate it's still pending (idempotency guard)
 * 4. Update the co-approval: status = decision, decidedAt = now
 * 5. Check remaining: if all resolved, update parent approval status
 * 6. If parent just transitioned to approved, propagate to linked object
 */
export async function resolveCoApproval(
  approvalId: string,
  actorName: string,
  decision: 'approved' | 'denied' | 'approved_with_condition',
  condition?: string
): Promise<CoApprovalResult> {
  // 1. Load approval with all co-approvals
  const approval = await prisma.approval.findUnique({
    where: { id: approvalId },
    include: { coApprovals: true },
  })

  if (!approval) {
    throw new NotFoundError('Approval', approvalId)
  }

  if (approval.status !== 'pending') {
    throw new ValidationError(`Approval '${approvalId}' is already ${approval.status}. Cannot modify.`)
  }

  // 2. Find matching co-approval entry
  // Match by name first; if "you" entries exist, match by first pending one
  let coApproval = approval.coApprovals.find(
    ca => ca.name.toLowerCase() === actorName.toLowerCase() && ca.status === 'pending'
  )

  // If no direct name match, try matching "you" entries (demo placeholder)
  if (!coApproval) {
    coApproval = approval.coApprovals.find(
      ca => ca.name.toLowerCase() === 'you' && ca.status === 'pending'
    )
  }

  if (!coApproval) {
    // Check if actor already decided
    const alreadyDecided = approval.coApprovals.find(
      ca => ca.name.toLowerCase() === actorName.toLowerCase() && ca.status !== 'pending'
    )
    if (alreadyDecided) {
      throw new ValidationError(`${actorName} has already decided on this approval (${alreadyDecided.status}).`)
    }

    throw new ValidationError(
      `No pending co-approval entry found for '${actorName}' on approval '${approvalId}'. ` +
      `Available co-approvers: ${approval.coApprovals.map(ca => `${ca.name} (${ca.status})`).join(', ')}`
    )
  }

  // 3. Idempotency guard (already checked above via status === 'pending')

  // 4. Update the co-approval entry
  const coApprovalStatus: CoApprovalStatus = decision === 'denied' ? 'denied' : 'approved'
  const updatedCoApproval = await prisma.coApproval.update({
    where: { id: coApproval.id },
    data: {
      status: coApprovalStatus,
      decidedAt: new Date(),
      // Update the name from "you" to the actual actor name
      ...(coApproval.name.toLowerCase() === 'you' ? { name: actorName } : {}),
    },
  })

  // 5. Check remaining co-approvals
  const allCoApprovals = await prisma.coApproval.findMany({
    where: { approvalId },
  })

  const pendingCount = allCoApprovals.filter(ca => ca.status === 'pending').length
  const deniedCount = allCoApprovals.filter(ca => ca.status === 'denied').length
  const isComplete = pendingCount === 0
  const allApproved = deniedCount === 0 && isComplete

  // 6. Determine parent approval status
  let newApprovalStatus: ApprovalStatus = 'pending'
  let isFinalApproval = false

  if (deniedCount > 0) {
    // Any denial → parent is denied
    newApprovalStatus = 'denied'
  } else if (isComplete && allApproved) {
    // All approved → determine if condition applies
    newApprovalStatus = condition ? 'approved_with_condition' : 'approved'
    isFinalApproval = true
  }
  // else: still pending (some co-approvals remain)

  // B2: optimistic locking on the parent approval. We read the current version
  // up front; the WHERE clause requires the version to still match, so two
  // concurrent decide requests can't both transition the same approval —
  // the second one's update affects 0 rows and we throw cleanly.
  const currentVersion = approval.version
  const updateResult = await prisma.approval.updateMany({
    where: { id: approvalId, version: currentVersion },
    data: {
      status: newApprovalStatus,
      version: { increment: 1 },
      ...(condition ? { condition } : {}),
    },
  })
  if (updateResult.count === 0) {
    throw new Error(
      `Approval ${approvalId} was modified concurrently (expected version ${currentVersion}). Reload and retry.`,
    )
  }
  const updatedApproval = await prisma.approval.findUniqueOrThrow({ where: { id: approvalId } })

  // 7. Log the audit event for this decision
  await logApprovalDecision({
    actor: actorName,
    approvalId,
    approvalTitle: approval.title,
    decision,
    condition,
  })

  // 8. If the approval chain is now complete with all approved, propagate
  if (isFinalApproval) {
    await propagateApprovalToLinkedObject(approval.type, approval.linkedObjectId, approval.title, actorName)
  }

  // If denied, also propagate the denial
  if (deniedCount > 0 && newApprovalStatus === 'denied') {
    await propagateDenialToLinkedObject(approval.type, approval.linkedObjectId)
  }

  return {
    approval: {
      id: updatedApproval.id,
      status: updatedApproval.status,
      condition: updatedApproval.condition,
      linkedObjectId: updatedApproval.linkedObjectId,
      type: updatedApproval.type,
      title: updatedApproval.title,
    },
    coApproval: {
      id: updatedCoApproval.id,
      role: updatedCoApproval.role,
      name: updatedCoApproval.name,
      status: updatedCoApproval.status,
      decidedAt: updatedCoApproval.decidedAt,
    },
    isComplete,
    isFinalApproval,
    allApproved,
  }
}

// ─── Propagation ────────────────────────────────────────

/**
 * When all co-approvals are granted, update the linked entity.
 */
async function propagateApprovalToLinkedObject(
  approvalType: string,
  linkedObjectId: string,
  approvalTitle: string,
  finalActor: string
) {
  let objectType: AuditObjectType = 'change'

  switch (approvalType) {
    case 'change': {
      objectType = 'change'
      // Update the change's approval state
      const change = await prisma.change.findFirst({
        where: {
          OR: [
            { id: linkedObjectId },
            { ticketId: linkedObjectId },
          ],
        },
      })
      if (change) {
        await prisma.change.update({
          where: { id: change.id },
          data: { approvalState: 'approved' },
        })
        await logAllApprovalsComplete({
          actor: finalActor,
          objectType: 'change',
          objectId: change.ticketId,
          objectTitle: change.title,
        })
      }
      break
    }

    case 'access': {
      objectType = 'access'
      // Update the access request status
      const accessReq = await prisma.accessRequest.findFirst({
        where: {
          OR: [
            { id: linkedObjectId },
            { requestId: linkedObjectId },
          ],
        },
      })
      if (accessReq) {
        await prisma.accessRequest.update({
          where: { id: accessReq.id },
          data: {
            status: 'approved',
            // Mark both approvals as approved since all co-approvals passed
            managerApproval: 'approved',
            ownerApproval: 'approved',
          },
        })
        await logAllApprovalsComplete({
          actor: finalActor,
          objectType: 'access',
          objectId: accessReq.requestId,
          objectTitle: `Access: ${accessReq.requestedSystem} for ${accessReq.requester}`,
        })
      }
      break
    }

    case 'remediation': {
      objectType = 'incident'
      // For remediation approvals, we log the completion but don't auto-transition incident status
      // (the operator/engineer applies the fix separately)
      const incident = await prisma.incident.findFirst({
        where: {
          OR: [
            { id: linkedObjectId },
            { incidentId: linkedObjectId },
          ],
        },
      })
      if (incident) {
        await logAllApprovalsComplete({
          actor: finalActor,
          objectType: 'incident',
          objectId: incident.incidentId,
          objectTitle: incident.title,
        })
      }
      break
    }

    case 'escalation': {
      // Escalation approvals — similar to change but mark as escalated-approved
      const change = await prisma.change.findFirst({
        where: {
          OR: [
            { id: linkedObjectId },
            { ticketId: linkedObjectId },
          ],
        },
      })
      if (change) {
        await prisma.change.update({
          where: { id: change.id },
          data: { approvalState: 'approved' },
        })
        await logAllApprovalsComplete({
          actor: finalActor,
          objectType: 'change',
          objectId: change.ticketId,
          objectTitle: change.title,
        })
      }
      break
    }
  }
}

/**
 * When any co-approval is denied, propagate denial to the linked entity.
 */
async function propagateDenialToLinkedObject(
  approvalType: string,
  linkedObjectId: string
) {
  switch (approvalType) {
    case 'change':
    case 'escalation': {
      const change = await prisma.change.findFirst({
        where: {
          OR: [
            { id: linkedObjectId },
            { ticketId: linkedObjectId },
          ],
        },
      })
      if (change) {
        await prisma.change.update({
          where: { id: change.id },
          data: { approvalState: 'denied' },
        })
      }
      break
    }

    case 'access': {
      const accessReq = await prisma.accessRequest.findFirst({
        where: {
          OR: [
            { id: linkedObjectId },
            { requestId: linkedObjectId },
          ],
        },
      })
      if (accessReq) {
        await prisma.accessRequest.update({
          where: { id: accessReq.id },
          data: { status: 'denied' },
        })
      }
      break
    }

    // Remediation denial doesn't change incident status
  }
}
