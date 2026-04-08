import { prisma } from '../lib/prisma.js'
import type { AuditObjectType, AuditResult } from '@prisma/client'

// ─── Types ──────────────────────────────────────────────

export interface CreateAuditEventInput {
  actor: string
  action: string
  objectType: AuditObjectType
  objectId: string
  objectTitle: string
  policyRule?: string | null
  result: AuditResult
  details: string
  /** Optional: links audit event directly to a change for the relation */
  changeId?: string | null
}

export interface AuditEventRecord {
  id: string
  timestamp: Date
  actor: string
  action: string
  objectType: AuditObjectType
  objectId: string
  objectTitle: string
  policyRule: string | null
  result: AuditResult
  details: string
  changeId: string | null
}

// ─── SSE Subscribers (Phase 6 will hook into this) ──────

type AuditListener = (event: AuditEventRecord) => void
const listeners: Set<AuditListener> = new Set()

export function subscribeAudit(fn: AuditListener): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

function broadcastAudit(event: AuditEventRecord) {
  for (const fn of listeners) {
    try { fn(event) } catch { /* listener errors don't break the pipeline */ }
  }
}

// ─── Core Factory ───────────────────────────────────────

/**
 * Create an audit event in the database and broadcast it to SSE listeners.
 *
 * This is the ONLY way audit events should be created in the system.
 * All action endpoints call this function; never create audit events inline.
 */
export async function createAuditEvent(input: CreateAuditEventInput): Promise<AuditEventRecord> {
  // Resolve changeId — ensure it's always a valid DB id (cuid), not a ticketId
  let changeId: string | null = null
  const rawChangeId = input.changeId ?? null

  if (rawChangeId) {
    // Explicit changeId provided — resolve to DB id if it's a ticketId
    const change = await prisma.change.findFirst({
      where: {
        OR: [
          { id: rawChangeId },
          { ticketId: rawChangeId },
        ],
      },
      select: { id: true },
    })
    changeId = change?.id ?? null
  } else if (input.objectType === 'change') {
    // Auto-link when objectType is 'change' — objectId might be ticketId or cuid
    const change = await prisma.change.findFirst({
      where: {
        OR: [
          { id: input.objectId },
          { ticketId: input.objectId },
        ],
      },
      select: { id: true },
    })
    changeId = change?.id ?? null
  }

  const event = await prisma.auditEvent.create({
    data: {
      actor: input.actor,
      action: input.action,
      objectType: input.objectType,
      objectId: input.objectId,
      objectTitle: input.objectTitle,
      policyRule: input.policyRule ?? null,
      result: input.result,
      details: input.details,
      changeId,
    },
  })

  // Broadcast to any SSE listeners (Phase 6)
  broadcastAudit(event)

  return event
}

// ─── Convenience Factories ──────────────────────────────

/** Log an approval decision (approve / deny / approve_with_condition) */
export function logApprovalDecision(opts: {
  actor: string
  approvalId: string
  approvalTitle: string
  decision: 'approved' | 'denied' | 'approved_with_condition'
  condition?: string
  policyRule?: string
}) {
  const actionLabel =
    opts.decision === 'approved' ? 'Approval granted' :
    opts.decision === 'denied' ? 'Approval denied' :
    'Approval granted with condition'

  const details =
    opts.decision === 'approved_with_condition'
      ? `Decision: ${opts.decision}. Condition: ${opts.condition || 'N/A'}`
      : `Decision: ${opts.decision}`

  return createAuditEvent({
    actor: opts.actor,
    action: actionLabel,
    objectType: 'approval',
    objectId: opts.approvalId,
    objectTitle: opts.approvalTitle,
    policyRule: opts.policyRule ?? null,
    result: opts.decision === 'denied' ? 'denied' : 'success',
    details,
  })
}

/** Log that all co-approvals are complete on a linked object */
export function logAllApprovalsComplete(opts: {
  actor: string
  objectType: AuditObjectType
  objectId: string
  objectTitle: string
}) {
  return createAuditEvent({
    actor: opts.actor,
    action: 'All approvals obtained',
    objectType: opts.objectType,
    objectId: opts.objectId,
    objectTitle: opts.objectTitle,
    result: 'success',
    details: 'All required co-approvals have been completed. Object is now approved.',
  })
}

/** Log a change execution attempt (success or blocked) */
export function logChangeExecution(opts: {
  actor: string
  changeId: string
  changeTitle: string
  allowed: boolean
  policyRule?: string
  reason?: string
}) {
  return createAuditEvent({
    actor: opts.actor,
    action: opts.allowed ? 'Change executed' : 'Execution blocked',
    objectType: 'execution',
    objectId: opts.changeId,
    objectTitle: opts.changeTitle,
    policyRule: opts.policyRule ?? null,
    result: opts.allowed ? 'success' : 'blocked',
    details: opts.allowed
      ? 'Change deployed to target environment successfully.'
      : `Execution blocked: ${opts.reason || 'Policy violation'}`,
    changeId: opts.changeId,
  })
}

/** Log a simulation run */
export function logSimulation(opts: {
  actor: string
  changeId: string
  changeTitle: string
}) {
  return createAuditEvent({
    actor: opts.actor,
    action: 'Simulation executed',
    objectType: 'execution',
    objectId: opts.changeId,
    objectTitle: opts.changeTitle,
    result: 'success',
    details: 'Dry-run simulation completed. No production changes were made.',
    changeId: opts.changeId,
  })
}

/** Log an escalation */
export function logEscalation(opts: {
  actor: string
  objectType: AuditObjectType
  objectId: string
  objectTitle: string
  reason?: string
}) {
  return createAuditEvent({
    actor: opts.actor,
    action: 'Escalated',
    objectType: opts.objectType,
    objectId: opts.objectId,
    objectTitle: opts.objectTitle,
    result: 'escalated',
    details: opts.reason || 'Escalated to next approval tier for review.',
  })
}

/** Log an access request decision */
export function logAccessDecision(opts: {
  actor: string
  requestId: string
  requestTitle: string
  decision: 'approved' | 'denied'
  approverRole: 'manager' | 'owner'
}) {
  return createAuditEvent({
    actor: opts.actor,
    action: opts.decision === 'approved'
      ? `Access ${opts.approverRole} approval granted`
      : `Access ${opts.approverRole} approval denied`,
    objectType: 'access',
    objectId: opts.requestId,
    objectTitle: opts.requestTitle,
    result: opts.decision === 'approved' ? 'success' : 'denied',
    details: `${opts.approverRole === 'manager' ? 'Manager' : 'System owner'} decision: ${opts.decision}`,
  })
}

/** Log an incident status update */
export function logIncidentStatusUpdate(opts: {
  actor: string
  incidentId: string
  incidentTitle: string
  oldStatus: string
  newStatus: string
}) {
  return createAuditEvent({
    actor: opts.actor,
    action: `Incident status updated: ${opts.oldStatus} → ${opts.newStatus}`,
    objectType: 'incident',
    objectId: opts.incidentId,
    objectTitle: opts.incidentTitle,
    result: 'success',
    details: `Status transitioned from ${opts.oldStatus} to ${opts.newStatus}`,
  })
}
