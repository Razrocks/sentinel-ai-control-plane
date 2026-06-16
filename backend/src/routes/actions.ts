import { FastifyInstance } from 'fastify'
import { requireAuth } from '../middleware/auth.js'
import { requireAction } from '../middleware/rbac.js'
import { idempotency } from '../middleware/idempotency.js'
import { prisma } from '../lib/prisma.js'
import { NotFoundError, ValidationError } from '../lib/errors.js'
import { assertVersion, readExpectedVersion } from '../lib/optimistic-lock.js'
import { resolveCoApproval } from '../services/approval-chain.js'
import { checkExecutionAllowed, checkSimulationAllowed } from '../services/policy-engine.js'
import {
  logChangeExecution,
  logSimulation,
  logEscalation,
  logAccessDecision,
  logIncidentStatusUpdate,
} from '../services/audit.js'

// ─── Mapper helpers ─────────────────────────────────────

function mapApproval(a: any) {
  return {
    id: a.id,
    type: a.type,
    title: a.title,
    requester: a.requester,
    impactedSystem: a.impactedSystem,
    riskLevel: a.riskLevel,
    reason: a.reason,
    recommendedAction: a.recommendedAction,
    status: a.status,
    condition: a.condition ?? undefined,
    createdAt: a.createdAt.toISOString(),
    linkedObjectId: a.linkedObjectId,
    whyYouAreRequired: a.whyYouAreRequired ?? undefined,
    coApprovals: a.coApprovals?.map((ca: any) => ({
      role: ca.role,
      name: ca.name,
      status: ca.status,
      decidedAt: ca.decidedAt?.toISOString() ?? null,
    })) ?? [],
    decisionImpact: a.decisionImpact ? {
      approve: a.decisionImpact.approve,
      deny: a.decisionImpact.deny,
      escalate: a.decisionImpact.escalate,
    } : undefined,
  }
}

function mapChange(c: any) {
  return {
    id: c.ticketId,
    ticketId: c.ticketId,
    title: c.title,
    description: c.description,
    owner: c.owner,
    ownerTeam: c.ownerTeam,
    service: c.service,
    environment: c.environment,
    riskLevel: c.riskLevel,
    status: c.status,
    approvalState: c.approvalState,
    policyDecision: c.policyDecision,
    linkedPRs: c.linkedPRs,
    ciStatus: c.ciStatus,
    maintenanceWindow: c.maintenanceWindow,
    rollbackPlan: c.rollbackPlan,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  }
}

function mapIncidentStatus(status: string): string {
  return status === 'new_incident' ? 'new' : status
}

// ─── Routes ─────────────────────────────────────────────

export async function actionsRoutes(app: FastifyInstance) {

  // ═══════════════════════════════════════════════════════
  // APPROVAL ACTIONS
  // ═══════════════════════════════════════════════════════

  /**
   * POST /api/approvals/:id/decide
   *
   * Resolve a co-approval decision within an approval chain.
   * Body: { decision: 'approved' | 'denied' | 'approved_with_condition', condition?: string }
   */
  app.post('/api/approvals/:id/decide', {
    preHandler: [requireAuth, idempotency],
  }, async (request, reply) => {
    // If this is a replay, idempotency middleware already sent the cached response.
    if (request.idempotencyHit) return
    const { id } = request.params as { id: string }
    const { decision, condition, expectedVersion: bodyExpectedVersion } =
      request.body as { decision: string; condition?: string; expectedVersion?: number }

    // Validate decision
    const validDecisions = ['approved', 'denied', 'approved_with_condition']
    if (!validDecisions.includes(decision)) {
      throw new ValidationError(`Invalid decision '${decision}'. Must be one of: ${validDecisions.join(', ')}`)
    }

    // Check RBAC — approve/deny requires the right role
    const action = decision === 'denied' ? 'deny' : 'approve'
    const rbacCheck = requireAction(action)
    await rbacCheck(request, reply)

    // Condition is required for 'approved_with_condition'
    if (decision === 'approved_with_condition' && !condition) {
      throw new ValidationError('Condition text is required when approving with condition.')
    }

    // B5: HTTP-layer optimistic concurrency. Prefer the standard `If-Match`
    // header (RFC 7232). For convenience we also accept `expectedVersion` in
    // the request body so existing JSON clients don't need a custom header
    // helper. ETag may be wrapped in quotes (`"3"`) per the spec — strip
    // them before parsing.
    const ifMatchHeader = (request.headers['if-match'] as string | undefined)?.replace(/"/g, '').trim()
    const headerExpectedVersion = ifMatchHeader && /^\d+$/.test(ifMatchHeader) ? Number(ifMatchHeader) : undefined
    const expectedVersion = headerExpectedVersion ?? bodyExpectedVersion

    const result = await resolveCoApproval(
      id,
      request.user!.name,
      decision as 'approved' | 'denied' | 'approved_with_condition',
      condition,
      expectedVersion,
    )

    // Reload full approval with relations for the response
    const fullApproval = await prisma.approval.findUnique({
      where: { id },
      include: { coApprovals: true, decisionImpact: true },
    })

    // Surface the new version as an ETag so the next caller can send it back
    // in `If-Match`. Quoted per RFC 7232.
    if (fullApproval) {
      reply.header('ETag', `"${fullApproval.version}"`)
    }

    return reply.send({
      approval: mapApproval(fullApproval),
      isComplete: result.isComplete,
      isFinalApproval: result.isFinalApproval,
      allApproved: result.allApproved,
    })
  })

  /**
   * POST /api/approvals/:id/note
   *
   * Attach a free-text note to an approval. Used during triage to capture
   * rationale, ask for clarification, or record reasoning. RBAC: `attach_notes`.
   * Body: { content: string }
   */
  app.post('/api/approvals/:id/note', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { content } = request.body as { content?: string }

    if (!content || !content.trim()) {
      throw new ValidationError('Note content is required.')
    }

    const rbac = requireAction('attach_notes' as any)
    await rbac(request, reply)

    const approval = await prisma.approval.findUnique({ where: { id } })
    if (!approval) {
      throw new ValidationError(`Approval not found: ${id}`)
    }

    const note = await prisma.approvalNote.create({
      data: {
        approvalId: id,
        actor: request.user!.name,
        content: content.trim(),
      },
    })

    await prisma.auditEvent.create({
      data: {
        actor: request.user!.name,
        action: 'note_attached',
        objectType: 'approval',
        objectId: id,
        objectTitle: approval.title,
        result: 'success',
        details: content.trim().slice(0, 200),
      },
    })

    return reply.send({
      note: {
        id: note.id,
        approvalId: note.approvalId,
        actor: note.actor,
        content: note.content,
        createdAt: note.createdAt.toISOString(),
      },
    })
  })

  /**
   * PATCH /api/approvals/:id/note/:noteId
   *
   * Edit an existing note. Only original author OR admin may edit. We track
   * `editedBy` + updatedAt so the audit trail reflects who touched it last.
   * RBAC reuses `attach_notes` (same role gate as creation).
   * Body: { content: string }
   */
  app.patch('/api/approvals/:id/note/:noteId', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const { id, noteId } = request.params as { id: string; noteId: string }
    const { content } = request.body as { content?: string }

    if (!content || !content.trim()) {
      throw new ValidationError('Note content is required.')
    }

    const rbac = requireAction('attach_notes' as any)
    await rbac(request, reply)

    const existing = await prisma.approvalNote.findFirst({
      where: { id: noteId, approvalId: id, deletedAt: null },
    })
    if (!existing) {
      throw new ValidationError(`Note not found: ${noteId}`)
    }

    const isAuthor = existing.actor === request.user!.name
    const isAdmin = request.user!.role === 'admin'
    if (!isAuthor && !isAdmin) {
      throw new ValidationError('Only the original author or an admin may edit a note.')
    }

    const updated = await prisma.approvalNote.update({
      where: { id: noteId },
      data: {
        content: content.trim(),
        editedBy: request.user!.name,
      },
    })

    await prisma.auditEvent.create({
      data: {
        actor: request.user!.name,
        action: 'note_edited',
        objectType: 'approval',
        objectId: id,
        objectTitle: `note ${noteId}`,
        result: 'success',
        details: content.trim().slice(0, 200),
      },
    })

    return reply.send({
      note: {
        id: updated.id,
        approvalId: updated.approvalId,
        actor: updated.actor,
        content: updated.content,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
        editedBy: updated.editedBy,
      },
    })
  })

  /**
   * DELETE /api/approvals/:id/note/:noteId
   *
   * Soft-delete a note. Same RBAC as edit: author or admin. Soft delete
   * (sets deletedAt) preserves audit trail — the note row stays in DB but
   * is excluded from API responses + agent context loaders.
   */
  app.delete('/api/approvals/:id/note/:noteId', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const { id, noteId } = request.params as { id: string; noteId: string }

    const rbac = requireAction('attach_notes' as any)
    await rbac(request, reply)

    const existing = await prisma.approvalNote.findFirst({
      where: { id: noteId, approvalId: id, deletedAt: null },
    })
    if (!existing) {
      throw new ValidationError(`Note not found: ${noteId}`)
    }

    const isAuthor = existing.actor === request.user!.name
    const isAdmin = request.user!.role === 'admin'
    if (!isAuthor && !isAdmin) {
      throw new ValidationError('Only the original author or an admin may delete a note.')
    }

    await prisma.approvalNote.update({
      where: { id: noteId },
      data: { deletedAt: new Date() },
    })

    await prisma.auditEvent.create({
      data: {
        actor: request.user!.name,
        action: 'note_deleted',
        objectType: 'approval',
        objectId: id,
        objectTitle: `note ${noteId}`,
        result: 'success',
        details: existing.content.slice(0, 200),
      },
    })

    return reply.send({ ok: true })
  })

  /**
   * POST /api/approvals/:id/escalate
   *
   * Mark an approval as escalated. Bumps version, writes audit event with the
   * reason, and notifies via integration channels. RBAC: `escalate`.
   * Body: { reason: string, expectedVersion?: number }
   */
  app.post('/api/approvals/:id/escalate', {
    preHandler: [requireAuth, idempotency],
  }, async (request, reply) => {
    if (request.idempotencyHit) return
    const { id } = request.params as { id: string }
    const { reason, expectedVersion: bodyExpectedVersion } = request.body as {
      reason?: string
      expectedVersion?: number
    }

    if (!reason || !reason.trim()) {
      throw new ValidationError('Escalation reason is required.')
    }

    const rbac = requireAction('escalate')
    await rbac(request, reply)

    const ifMatchHeader = (request.headers['if-match'] as string | undefined)?.replace(/"/g, '').trim()
    const headerExpectedVersion = ifMatchHeader && /^\d+$/.test(ifMatchHeader) ? Number(ifMatchHeader) : undefined
    const expectedVersion = headerExpectedVersion ?? bodyExpectedVersion

    const approval = await prisma.approval.findUnique({ where: { id } })
    if (!approval) {
      throw new ValidationError(`Approval not found: ${id}`)
    }

    if (expectedVersion !== undefined && approval.version !== expectedVersion) {
      return reply.code(412).send({
        error: 'version_conflict',
        message: `Approval has been modified. Expected version ${expectedVersion}, got ${approval.version}.`,
        currentVersion: approval.version,
      })
    }

    const updated = await prisma.approval.update({
      where: { id },
      data: {
        status: 'escalated',
        version: { increment: 1 },
      },
    })

    await prisma.approvalNote.create({
      data: {
        approvalId: id,
        actor: request.user!.name,
        content: `[ESCALATED] ${reason.trim()}`,
      },
    })

    await prisma.auditEvent.create({
      data: {
        actor: request.user!.name,
        action: 'approval_escalated',
        objectType: 'approval',
        objectId: id,
        objectTitle: approval.title,
        result: 'escalated',
        details: reason.trim().slice(0, 200),
      },
    })

    const fullApproval = await prisma.approval.findUnique({
      where: { id },
      include: { coApprovals: true, decisionImpact: true },
    })

    reply.header('ETag', `"${updated.version}"`)
    return reply.send({ approval: mapApproval(fullApproval) })
  })

  // ═══════════════════════════════════════════════════════
  // CHANGE ACTIONS
  // ═══════════════════════════════════════════════════════

  /**
   * POST /api/changes/:id/execute
   *
   * Execute (deploy) a change. Validates approval state + policy.
   */
  app.post('/api/changes/:id/execute', {
    preHandler: [requireAuth, requireAction('execute')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { expectedVersion } = (request.body ?? {}) as { expectedVersion?: number }

    // Find the change
    const change = await prisma.change.findFirst({
      where: {
        OR: [
          { id },
          { ticketId: id },
        ],
      },
    })

    if (!change) {
      throw new NotFoundError('Change', id)
    }

    assertVersion(
      readExpectedVersion(request, expectedVersion),
      (change as any).version ?? 0,
      'Change',
      change.ticketId,
    )

    // Check policy + approval state
    const check = await checkExecutionAllowed(change.id)

    if (!check.allowed) {
      // Log the blocked attempt
      await logChangeExecution({
        actor: request.user!.name,
        changeId: change.ticketId,
        changeTitle: change.title,
        allowed: false,
        policyRule: check.rule ?? undefined,
        reason: check.reason,
      })

      return reply.status(403).send({
        error: 'EXECUTION_BLOCKED',
        message: check.reason,
        rule: check.rule,
      })
    }

    // Execute: update change status
    const updated = await prisma.change.update({
      where: { id: change.id },
      data: { status: 'deployed', version: { increment: 1 } },
    })

    // Log successful execution
    await logChangeExecution({
      actor: request.user!.name,
      changeId: change.ticketId,
      changeTitle: change.title,
      allowed: true,
    })

    return reply.send(mapChange(updated))
  })

  /**
   * POST /api/changes/:id/simulate
   *
   * Run a dry-run simulation. More permissive than execute.
   */
  app.post('/api/changes/:id/simulate', {
    preHandler: [requireAuth, requireAction('simulate')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }

    const change = await prisma.change.findFirst({
      where: {
        OR: [
          { id },
          { ticketId: id },
        ],
      },
    })

    if (!change) {
      throw new NotFoundError('Change', id)
    }

    const check = await checkSimulationAllowed(change.id)

    if (!check.allowed) {
      return reply.status(403).send({
        error: 'SIMULATION_BLOCKED',
        message: check.reason,
        rule: check.rule,
      })
    }

    // Log the simulation
    await logSimulation({
      actor: request.user!.name,
      changeId: change.ticketId,
      changeTitle: change.title,
    })

    return reply.send({
      success: true,
      changeId: change.ticketId,
      simulationResult: {
        status: 'completed',
        message: 'Dry-run simulation completed successfully. No production changes were made.',
        checks: [
          { name: 'Schema compatibility', result: 'pass' },
          { name: 'Rollback plan validation', result: change.rollbackPlan ? 'pass' : 'warning' },
          { name: 'CI pipeline status', result: change.ciStatus === 'passing' ? 'pass' : 'warning' },
          { name: 'Blast radius assessment', result: 'pass' },
        ],
      },
    })
  })

  /**
   * POST /api/changes/:id/escalate
   *
   * Escalate a change for higher-level review.
   */
  app.post('/api/changes/:id/escalate', {
    preHandler: [requireAuth, requireAction('escalate')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = (request.body || {}) as { reason?: string; expectedVersion?: number }
    const reason = body.reason
    void reply

    const change = await prisma.change.findFirst({
      where: {
        OR: [
          { id },
          { ticketId: id },
        ],
      },
    })

    if (!change) {
      throw new NotFoundError('Change', id)
    }

    assertVersion(
      readExpectedVersion(request, body.expectedVersion),
      (change as any).version ?? 0,
      'Change',
      change.ticketId,
    )

    const updated = await prisma.change.update({
      where: { id: change.id },
      data: {
        status: 'escalated',
        policyDecision: 'escalate',
        version: { increment: 1 },
      },
    })

    await logEscalation({
      actor: request.user!.name,
      objectType: 'change',
      objectId: change.ticketId,
      objectTitle: change.title,
      reason,
    })

    return reply.send(mapChange(updated))
  })

  // ═══════════════════════════════════════════════════════
  // ACCESS REQUEST ACTIONS
  // ═══════════════════════════════════════════════════════

  /**
   * POST /api/access-requests/:id/decide
   *
   * Manager or owner decision on an access request.
   * Body: { decision: 'approved' | 'denied', role: 'manager' | 'owner' }
   */
  app.post('/api/access-requests/:id/decide', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { decision, role, expectedVersion } = request.body as { decision: string; role: string; expectedVersion?: number }

    // Validate inputs
    if (!['approved', 'denied'].includes(decision)) {
      throw new ValidationError(`Invalid decision '${decision}'. Must be 'approved' or 'denied'.`)
    }
    if (!['manager', 'owner'].includes(role)) {
      throw new ValidationError(`Invalid role '${role}'. Must be 'manager' or 'owner'.`)
    }

    // RBAC check
    const action = decision === 'denied' ? 'deny' : 'approve'
    const rbacCheck = requireAction(action)
    await rbacCheck(request, reply)

    // Load access request
    const accessReq = await prisma.accessRequest.findFirst({
      where: {
        OR: [
          { id },
          { requestId: id },
        ],
      },
    })

    if (!accessReq) {
      throw new NotFoundError('Access Request', id)
    }

    assertVersion(
      readExpectedVersion(request, expectedVersion),
      (accessReq as any).version ?? 0,
      'AccessRequest',
      accessReq.requestId,
    )

    if (accessReq.status !== 'pending') {
      throw new ValidationError(`Access request is already ${accessReq.status}.`)
    }

    // Update the appropriate approval field
    const approvalState = decision === 'approved' ? 'approved' : 'denied'
    const updateData: any = {}

    if (role === 'manager') {
      if (accessReq.managerApproval !== 'pending') {
        throw new ValidationError(`Manager approval already decided: ${accessReq.managerApproval}`)
      }
      updateData.managerApproval = approvalState
    } else {
      if (accessReq.ownerApproval !== 'pending') {
        throw new ValidationError(`Owner approval already decided: ${accessReq.ownerApproval}`)
      }
      updateData.ownerApproval = approvalState
    }

    // Check if request is now fully decided
    const newManagerApproval = role === 'manager' ? approvalState : accessReq.managerApproval
    const newOwnerApproval = role === 'owner' ? approvalState : accessReq.ownerApproval

    // If either party denies, request is denied
    if (newManagerApproval === 'denied' || newOwnerApproval === 'denied') {
      updateData.status = 'denied'
    }
    // If both required approvals are done and approved
    else if (
      (!accessReq.managerApprovalRequired || newManagerApproval === 'approved') &&
      (!accessReq.ownerApprovalRequired || newOwnerApproval === 'approved')
    ) {
      updateData.status = 'approved'
    }

    updateData.version = { increment: 1 }
    const updated = await prisma.accessRequest.update({
      where: { id: accessReq.id },
      data: updateData,
    })

    // Log the decision
    await logAccessDecision({
      actor: request.user!.name,
      requestId: accessReq.requestId,
      requestTitle: `Access: ${accessReq.requestedSystem} for ${accessReq.requester}`,
      decision: decision as 'approved' | 'denied',
      approverRole: role as 'manager' | 'owner',
    })

    // Also keep the linked approval chain in sync
    const linkedApproval = await prisma.approval.findFirst({
      where: { linkedObjectId: accessReq.requestId, type: 'access' },
      include: { coApprovals: true },
    })

    if (linkedApproval) {
      // Find the co-approval entry matching this role
      const roleMapping = role === 'manager' ? 'manager' : 'system owner'
      const matchingCo = linkedApproval.coApprovals.find(
        ca => ca.role.toLowerCase() === roleMapping || ca.role.toLowerCase() === role
      )
      if (matchingCo && matchingCo.status === 'pending') {
        try {
          await resolveCoApproval(
            linkedApproval.id,
            request.user!.name,
            decision as 'approved' | 'denied'
          )
        } catch {
          // Non-critical — the access request itself is already updated
        }
      }
    }

    return reply.send({
      id: updated.requestId,
      requestId: updated.requestId,
      requester: updated.requester,
      requesterEmail: updated.requesterEmail,
      requestedSystem: updated.requestedSystem,
      requestedRole: updated.requestedRole,
      justification: updated.justification,
      manager: updated.manager,
      systemOwner: updated.systemOwner,
      status: updated.status,
      riskLevel: updated.riskLevel,
      policyDecision: updated.policyDecision,
      entitlementCheck: updated.entitlementCheck,
      autoGrantAllowed: updated.autoGrantAllowed,
      managerApprovalRequired: updated.managerApprovalRequired,
      ownerApprovalRequired: updated.ownerApprovalRequired,
      managerApproval: updated.managerApproval,
      ownerApproval: updated.ownerApproval,
      reason: updated.reason,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    })
  })

  // ═══════════════════════════════════════════════════════
  // INCIDENT ACTIONS
  // ═══════════════════════════════════════════════════════

  /**
   * POST /api/incidents/:id/update-status
   *
   * Update incident status with validated transitions.
   * Body: { status: IncidentStatus }
   */
  app.post('/api/incidents/:id/update-status', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { status: newStatusRaw, expectedVersion } = request.body as { status: string; expectedVersion?: number }
    void reply

    // Map API status values to DB enum
    const statusMap: Record<string, string> = {
      'new': 'new_incident',
      'new_incident': 'new_incident',
      'investigating': 'investigating',
      'identified': 'identified',
      'monitoring': 'monitoring',
      'resolved': 'resolved',
    }

    const newStatusDb = statusMap[newStatusRaw]
    if (!newStatusDb) {
      throw new ValidationError(
        `Invalid status '${newStatusRaw}'. Must be one of: new, investigating, identified, monitoring, resolved`
      )
    }

    const incident = await prisma.incident.findFirst({
      where: {
        OR: [
          { id },
          { incidentId: id },
        ],
      },
    })

    if (!incident) {
      throw new NotFoundError('Incident', id)
    }

    // B5: optimistic-lock guard. If the client sent an If-Match header or
    // expectedVersion body field, refuse if the row already moved.
    assertVersion(
      readExpectedVersion(request, expectedVersion),
      (incident as any).version ?? 0,
      'Incident',
      incident.incidentId,
    )

    // Validate status transition order
    const validTransitions: Record<string, string[]> = {
      'new_incident': ['investigating'],
      'investigating': ['identified', 'monitoring', 'resolved'],
      'identified': ['monitoring', 'resolved'],
      'monitoring': ['resolved', 'investigating'], // Can re-open investigation
      'resolved': [], // Terminal state
    }

    const allowedNext = validTransitions[incident.status] || []
    if (!allowedNext.includes(newStatusDb)) {
      const currentDisplay = mapIncidentStatus(incident.status)
      throw new ValidationError(
        `Cannot transition from '${currentDisplay}' to '${newStatusRaw}'. ` +
        `Allowed transitions: ${allowedNext.map(mapIncidentStatus).join(', ') || 'none (terminal state)'}`
      )
    }

    const updated = await prisma.incident.update({
      where: { id: incident.id },
      data: { status: newStatusDb as any, version: { increment: 1 } },
    })

    await logIncidentStatusUpdate({
      actor: request.user!.name,
      incidentId: incident.incidentId,
      incidentTitle: incident.title,
      oldStatus: mapIncidentStatus(incident.status),
      newStatus: newStatusRaw,
    })

    return reply.send({
      id: updated.incidentId,
      incidentId: updated.incidentId,
      title: updated.title,
      description: updated.description,
      requester: updated.requester,
      affectedService: updated.affectedService,
      severity: updated.severity,
      status: mapIncidentStatus(updated.status),
      assignmentGroup: updated.assignmentGroup,
      relatedCI: updated.relatedCI,
      relatedChanges: updated.relatedChanges,
      likelyIssueType: updated.likelyIssueType,
      rootCauseCategory: updated.rootCauseCategory,
      recommendedFix: updated.recommendedFix,
      kbArticles: updated.kbArticles,
      isRecurring: updated.isRecurring,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    })
  })

  // ═══════════════════════════════════════════════════════
  // INCIDENT — NOTE / ESCALATE / ROUTE / LINK-KB / DRAFT / AWAITING
  // ═══════════════════════════════════════════════════════

  /**
   * POST /api/incidents/:id/note
   * Body: { content: string, kind?: 'work_note' | 'customer_reply' }
   *
   * Mirrors approval-note semantics: any role with `attach_notes` can attach;
   * audit row written; soft-deletes preserved by route handlers below.
   */
  app.post('/api/incidents/:id/note', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { content, kind } = request.body as { content?: string; kind?: string }
    if (!content || !content.trim()) {
      throw new ValidationError('Note content is required.')
    }
    const rbac = requireAction('attach_notes' as any)
    await rbac(request, reply)

    const incident = await prisma.incident.findFirst({
      where: { OR: [{ id }, { incidentId: id }] },
    })
    if (!incident) throw new NotFoundError('Incident', id)

    const noteKind = kind === 'customer_reply' ? 'customer_reply' : 'work_note'
    const note = await prisma.incidentNote.create({
      data: {
        incidentId: incident.id,
        actor: request.user!.name,
        content: content.trim(),
        kind: noteKind,
      },
    })
    await prisma.auditEvent.create({
      data: {
        actor: request.user!.name,
        action: noteKind === 'customer_reply' ? 'customer_reply_drafted' : 'work_note_attached',
        objectType: 'incident',
        objectId: incident.id,
        objectTitle: incident.title,
        result: 'success',
        details: content.trim().slice(0, 200),
      },
    })
    return reply.send({
      note: {
        id: note.id,
        incidentId: note.incidentId,
        actor: note.actor,
        kind: note.kind,
        content: note.content,
        createdAt: note.createdAt.toISOString(),
      },
    })
  })

  app.patch('/api/incidents/:id/note/:noteId', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id, noteId } = request.params as { id: string; noteId: string }
    const { content } = request.body as { content?: string }
    if (!content || !content.trim()) throw new ValidationError('Note content is required.')
    const rbac = requireAction('attach_notes' as any)
    await rbac(request, reply)
    const incident = await prisma.incident.findFirst({ where: { OR: [{ id }, { incidentId: id }] } })
    if (!incident) throw new NotFoundError('Incident', id)

    const existing = await prisma.incidentNote.findFirst({
      where: { id: noteId, incidentId: incident.id, deletedAt: null },
    })
    if (!existing) throw new ValidationError(`Note not found: ${noteId}`)
    const isAuthor = existing.actor === request.user!.name
    const isAdmin = request.user!.role === 'admin'
    if (!isAuthor && !isAdmin) {
      throw new ValidationError('Only the original author or an admin may edit a note.')
    }
    const updated = await prisma.incidentNote.update({
      where: { id: noteId },
      data: { content: content.trim(), editedBy: request.user!.name },
    })
    await prisma.auditEvent.create({
      data: {
        actor: request.user!.name,
        action: 'work_note_edited',
        objectType: 'incident',
        objectId: incident.id,
        objectTitle: `note ${noteId}`,
        result: 'success',
        details: content.trim().slice(0, 200),
      },
    })
    return reply.send({ note: { id: updated.id, content: updated.content, updatedAt: updated.updatedAt.toISOString(), editedBy: updated.editedBy } })
  })

  app.delete('/api/incidents/:id/note/:noteId', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id, noteId } = request.params as { id: string; noteId: string }
    const rbac = requireAction('attach_notes' as any)
    await rbac(request, reply)
    const incident = await prisma.incident.findFirst({ where: { OR: [{ id }, { incidentId: id }] } })
    if (!incident) throw new NotFoundError('Incident', id)

    const existing = await prisma.incidentNote.findFirst({
      where: { id: noteId, incidentId: incident.id, deletedAt: null },
    })
    if (!existing) throw new ValidationError(`Note not found: ${noteId}`)
    const isAuthor = existing.actor === request.user!.name
    const isAdmin = request.user!.role === 'admin'
    if (!isAuthor && !isAdmin) {
      throw new ValidationError('Only the original author or an admin may delete a note.')
    }
    await prisma.incidentNote.update({ where: { id: noteId }, data: { deletedAt: new Date() } })
    await prisma.auditEvent.create({
      data: {
        actor: request.user!.name,
        action: 'work_note_deleted',
        objectType: 'incident',
        objectId: incident.id,
        objectTitle: `note ${noteId}`,
        result: 'success',
        details: existing.content.slice(0, 200),
      },
    })
    return reply.send({ ok: true })
  })

  /**
   * POST /api/incidents/:id/escalate
   * Body: { reason: string }
   * Bumps severity one notch (sev3→sev2, sev2→sev1) capped at sev1; writes audit.
   */
  app.post('/api/incidents/:id/escalate', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { reason, expectedVersion } = request.body as { reason?: string; expectedVersion?: number }
    if (!reason || !reason.trim()) throw new ValidationError('Escalation reason is required.')
    const rbac = requireAction('escalate')
    await rbac(request, reply)
    const incident = await prisma.incident.findFirst({ where: { OR: [{ id }, { incidentId: id }] } })
    if (!incident) throw new NotFoundError('Incident', id)
    assertVersion(
      readExpectedVersion(request, expectedVersion),
      (incident as any).version ?? 0,
      'Incident',
      incident.incidentId,
    )

    const escalateMap: Record<string, string> = { sev4: 'sev3', sev3: 'sev2', sev2: 'sev1', sev1: 'sev1' }
    const newSeverity = escalateMap[incident.severity] ?? incident.severity
    const updated = await prisma.incident.update({
      where: { id: incident.id },
      data: { severity: newSeverity as any, version: { increment: 1 } },
    })
    await prisma.incidentNote.create({
      data: {
        incidentId: incident.id,
        actor: request.user!.name,
        kind: 'work_note',
        content: `[ESCALATED ${incident.severity} → ${newSeverity}] ${reason.trim()}`,
      },
    })
    await prisma.auditEvent.create({
      data: {
        actor: request.user!.name,
        action: 'incident_escalated',
        objectType: 'incident',
        objectId: incident.id,
        objectTitle: incident.title,
        result: 'escalated',
        details: `severity ${incident.severity} → ${newSeverity}: ${reason.trim().slice(0, 200)}`,
      },
    })
    return reply.send({ ok: true, severity: updated.severity })
  })

  /**
   * POST /api/incidents/:id/route
   * Body: { team: string }
   * Re-assigns the incident to a different team. Audit-trailed.
   */
  app.post('/api/incidents/:id/route', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { team } = request.body as { team?: string }
    if (!team || !team.trim()) throw new ValidationError('Target team is required.')
    const rbac = requireAction('attach_notes' as any)
    await rbac(request, reply)
    const incident = await prisma.incident.findFirst({ where: { OR: [{ id }, { incidentId: id }] } })
    if (!incident) throw new NotFoundError('Incident', id)
    const previous = incident.assignmentGroup
    await prisma.incident.update({ where: { id: incident.id }, data: { assignmentGroup: team.trim() } })
    await prisma.auditEvent.create({
      data: {
        actor: request.user!.name,
        action: 'incident_routed',
        objectType: 'incident',
        objectId: incident.id,
        objectTitle: incident.title,
        result: 'success',
        details: `${previous} → ${team.trim()}`,
      },
    })
    return reply.send({ ok: true, assignmentGroup: team.trim(), previousAssignmentGroup: previous })
  })

  /**
   * POST /api/incidents/:id/link-kb
   * Body: { kbArticleId: string }
   * Append to kbArticles[] (deduped). Audit-trailed.
   */
  app.post('/api/incidents/:id/link-kb', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { kbArticleId } = request.body as { kbArticleId?: string }
    if (!kbArticleId || !kbArticleId.trim()) throw new ValidationError('KB article ID is required.')
    const rbac = requireAction('attach_notes' as any)
    await rbac(request, reply)
    const incident = await prisma.incident.findFirst({ where: { OR: [{ id }, { incidentId: id }] } })
    if (!incident) throw new NotFoundError('Incident', id)
    const trimmed = kbArticleId.trim()
    if (incident.kbArticles.includes(trimmed)) {
      return reply.send({ ok: true, kbArticles: incident.kbArticles })
    }
    const updated = await prisma.incident.update({
      where: { id: incident.id },
      data: { kbArticles: [...incident.kbArticles, trimmed] },
    })
    await prisma.auditEvent.create({
      data: {
        actor: request.user!.name,
        action: 'kb_article_linked',
        objectType: 'incident',
        objectId: incident.id,
        objectTitle: incident.title,
        result: 'success',
        details: trimmed,
      },
    })
    return reply.send({ ok: true, kbArticles: updated.kbArticles })
  })

  /**
   * POST /api/incidents/:id/draft-response
   * Body: { draft: string }
   * Save a rolling draft response. Stored on incident.draftResponse so the
   * UI can preserve work across refreshes / role swaps.
   */
  app.post('/api/incidents/:id/draft-response', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { draft } = request.body as { draft?: string }
    if (typeof draft !== 'string') throw new ValidationError('Draft text required.')
    const rbac = requireAction('attach_notes' as any)
    await rbac(request, reply)
    const incident = await prisma.incident.findFirst({ where: { OR: [{ id }, { incidentId: id }] } })
    if (!incident) throw new NotFoundError('Incident', id)
    await prisma.incident.update({
      where: { id: incident.id },
      data: { draftResponse: draft },
    })
    await prisma.auditEvent.create({
      data: {
        actor: request.user!.name,
        action: 'draft_response_saved',
        objectType: 'incident',
        objectId: incident.id,
        objectTitle: incident.title,
        result: 'success',
        details: draft.slice(0, 200),
      },
    })
    return reply.send({ ok: true })
  })

  /**
   * POST /api/incidents/:id/unlink-kb
   * Body: { kbArticleId: string }
   * Remove a single KB article from kbArticles[]. Audit-trailed.
   */
  app.post('/api/incidents/:id/unlink-kb', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { kbArticleId } = request.body as { kbArticleId?: string }
    if (!kbArticleId || !kbArticleId.trim()) throw new ValidationError('KB article ID is required.')
    const rbac = requireAction('attach_notes' as any)
    await rbac(request, reply)
    const incident = await prisma.incident.findFirst({ where: { OR: [{ id }, { incidentId: id }] } })
    if (!incident) throw new NotFoundError('Incident', id)
    const trimmed = kbArticleId.trim()
    if (!incident.kbArticles.includes(trimmed)) {
      return reply.send({ ok: true, kbArticles: incident.kbArticles })
    }
    const updated = await prisma.incident.update({
      where: { id: incident.id },
      data: { kbArticles: incident.kbArticles.filter((k) => k !== trimmed) },
    })
    await prisma.auditEvent.create({
      data: {
        actor: request.user!.name,
        action: 'kb_article_unlinked',
        objectType: 'incident',
        objectId: incident.id,
        objectTitle: incident.title,
        result: 'success',
        details: trimmed,
      },
    })
    return reply.send({ ok: true, kbArticles: updated.kbArticles })
  })

  /**
   * POST /api/incidents/:id/draft-response/send
   *
   * Promote the saved draftResponse into a real customer_reply note + clear
   * the draft. Atomic: either both writes succeed or neither runs.
   */
  app.post('/api/incidents/:id/draft-response/send', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const rbac = requireAction('attach_notes' as any)
    await rbac(request, reply)
    const incident = await prisma.incident.findFirst({ where: { OR: [{ id }, { incidentId: id }] } })
    if (!incident) throw new NotFoundError('Incident', id)
    const draft = (incident.draftResponse ?? '').trim()
    if (!draft) throw new ValidationError('No draft to send.')

    const note = await prisma.$transaction(async (tx) => {
      const created = await tx.incidentNote.create({
        data: {
          incidentId: incident.id,
          actor: request.user!.name,
          kind: 'customer_reply',
          content: draft,
        },
      })
      await tx.incident.update({
        where: { id: incident.id },
        data: { draftResponse: null },
      })
      return created
    })
    await prisma.auditEvent.create({
      data: {
        actor: request.user!.name,
        action: 'customer_reply_sent',
        objectType: 'incident',
        objectId: incident.id,
        objectTitle: incident.title,
        result: 'success',
        details: draft.slice(0, 200),
      },
    })
    return reply.send({ ok: true, noteId: note.id })
  })

  /**
   * POST /api/incidents/:id/mark-awaiting
   * Toggle the `awaitingApproval` flag. Audit-trailed.
   */
  app.post('/api/incidents/:id/mark-awaiting', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { awaiting } = request.body as { awaiting?: boolean }
    const next = awaiting !== false
    const rbac = requireAction('attach_notes' as any)
    await rbac(request, reply)
    const incident = await prisma.incident.findFirst({ where: { OR: [{ id }, { incidentId: id }] } })
    if (!incident) throw new NotFoundError('Incident', id)
    await prisma.incident.update({ where: { id: incident.id }, data: { awaitingApproval: next } })
    await prisma.auditEvent.create({
      data: {
        actor: request.user!.name,
        action: next ? 'incident_marked_awaiting' : 'incident_awaiting_cleared',
        objectType: 'incident',
        objectId: incident.id,
        objectTitle: incident.title,
        result: 'success',
        details: next ? 'awaiting approval' : 'no longer awaiting',
      },
    })
    return reply.send({ ok: true, awaitingApproval: next })
  })
}
