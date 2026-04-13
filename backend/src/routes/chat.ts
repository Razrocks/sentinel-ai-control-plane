import { FastifyInstance } from 'fastify'
import { requireAuth } from '../middleware/auth.js'
import { prisma } from '../lib/prisma.js'
import {
  buildChatSystemPrompt,
  buildContextualSystemPrompt,
  streamChat,
  isConfigured,
} from '../services/claude.js'

export async function chatRoutes(app: FastifyInstance) {
  // POST /api/chat — streaming Claude response via SSE
  app.post('/api/chat', { preHandler: [requireAuth] }, async (request, reply) => {
    // Check if Anthropic API key is configured
    if (!isConfigured()) {
      return reply.status(503).send({
        error: 'AI_NOT_CONFIGURED',
        message: 'Anthropic API key not set. Add ANTHROPIC_API_KEY to your environment.',
      })
    }

    const body = request.body as {
      messages?: Array<{ role: 'user' | 'assistant'; content: string }>
      context?: {
        pagePath?: string
        entityType?: 'change' | 'incident' | 'access_request'
        entityId?: string
      }
    }

    const messages = body?.messages
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return reply.status(400).send({
        error: 'VALIDATION_ERROR',
        message: 'messages array is required and must contain at least one message',
      })
    }

    const context = body.context || {}
    const role = request.user!.role
    const pagePath = context.pagePath || '/'

    // Build system prompt — contextual if entity provided, otherwise general
    let systemPrompt: string

    if (context.entityType && context.entityId) {
      const entityData = await loadEntityData(context.entityType, context.entityId)
      if (entityData) {
        systemPrompt = buildContextualSystemPrompt(role, context.entityType, entityData)
      } else {
        systemPrompt = buildChatSystemPrompt(role, pagePath)
      }
    } else {
      systemPrompt = buildChatSystemPrompt(role, pagePath)
    }

    // Set SSE headers and hijack the response
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no',
    })

    try {
      const stream = streamChat(systemPrompt, messages)

      stream.on('text', (text) => {
        reply.raw.write(`event: chunk\ndata: ${JSON.stringify({ content: text })}\n\n`)
      })

      stream.on('error', (error) => {
        const message = error instanceof Error ? error.message : 'Stream error'
        app.log.error(error, 'Claude stream error')
        reply.raw.write(`event: error\ndata: ${JSON.stringify({ message })}\n\n`)
        reply.raw.end()
      })

      stream.on('end', () => {
        reply.raw.write(`event: done\ndata: {}\n\n`)
        reply.raw.end()
      })

      // Clean up if client disconnects mid-stream
      request.raw.on('close', () => {
        stream.abort()
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start stream'
      app.log.error(error, 'Claude stream init error')
      reply.raw.write(`event: error\ndata: ${JSON.stringify({ message })}\n\n`)
      reply.raw.end()
    }

    // Prevent Fastify from closing the response
    reply.hijack()
  })
}

// ─── Entity data loaders ────────────────────────────────

async function loadEntityData(
  entityType: string,
  entityId: string,
): Promise<Record<string, unknown> | null> {
  try {
    switch (entityType) {
      case 'change':
        return await loadChangeData(entityId)
      case 'incident':
        return await loadIncidentData(entityId)
      case 'access_request':
        return await loadAccessRequestData(entityId)
      default:
        return null
    }
  } catch {
    return null
  }
}

async function loadChangeData(id: string): Promise<Record<string, unknown> | null> {
  const change = await prisma.change.findFirst({
    where: { OR: [{ id }, { ticketId: id }] },
    include: {
      blastRadius: true,
      recommendations: true,
      auditEvents: { orderBy: { timestamp: 'desc' }, take: 10 },
    },
  })
  if (!change) return null

  return {
    ticketId: change.ticketId,
    title: change.title,
    description: change.description,
    owner: change.owner,
    ownerTeam: change.ownerTeam,
    service: change.service,
    environment: change.environment,
    riskLevel: change.riskLevel,
    status: change.status,
    approvalState: change.approvalState,
    policyDecision: change.policyDecision,
    linkedPRs: change.linkedPRs,
    ciStatus: change.ciStatus,
    maintenanceWindow: change.maintenanceWindow,
    rollbackPlan: change.rollbackPlan,
    blastRadius: change.blastRadius.map(br => ({
      name: br.name,
      type: br.type,
      reason: br.reason,
      confidence: br.confidence,
      criticality: br.criticality,
      ownerTeam: br.ownerTeam,
    })),
    recommendations: change.recommendations.map(r => ({
      title: r.title,
      reason: r.reason,
      classification: r.classification,
      expectedBenefit: r.expectedBenefit,
      requiredApprovals: r.requiredApprovals,
      executableNow: r.executableNow,
      draftOnly: r.draftOnly,
    })),
    recentAuditEvents: change.auditEvents.slice(0, 5).map(e => ({
      action: e.action,
      actor: e.actor,
      result: e.result,
      timestamp: e.timestamp.toISOString(),
    })),
  }
}

async function loadIncidentData(id: string): Promise<Record<string, unknown> | null> {
  const incident = await prisma.incident.findFirst({
    where: { OR: [{ id }, { incidentId: id }] },
  })
  if (!incident) return null

  return {
    incidentId: incident.incidentId,
    title: incident.title,
    description: incident.description,
    requester: incident.requester,
    affectedService: incident.affectedService,
    severity: incident.severity,
    status: incident.status === 'new_incident' ? 'new' : incident.status,
    assignmentGroup: incident.assignmentGroup,
    relatedCI: incident.relatedCI,
    relatedChanges: incident.relatedChanges,
    likelyIssueType: incident.likelyIssueType,
    rootCauseCategory: incident.rootCauseCategory,
    recommendedFix: incident.recommendedFix,
    kbArticles: incident.kbArticles,
    isRecurring: incident.isRecurring,
  }
}

async function loadAccessRequestData(id: string): Promise<Record<string, unknown> | null> {
  const ar = await prisma.accessRequest.findFirst({
    where: { OR: [{ id }, { requestId: id }] },
  })
  if (!ar) return null

  return {
    requestId: ar.requestId,
    requester: ar.requester,
    requesterEmail: ar.requesterEmail,
    requestedSystem: ar.requestedSystem,
    requestedRole: ar.requestedRole,
    justification: ar.justification,
    manager: ar.manager,
    systemOwner: ar.systemOwner,
    status: ar.status,
    riskLevel: ar.riskLevel,
    policyDecision: ar.policyDecision,
    entitlementCheck: ar.entitlementCheck,
    autoGrantAllowed: ar.autoGrantAllowed,
    managerApprovalRequired: ar.managerApprovalRequired,
    ownerApprovalRequired: ar.ownerApprovalRequired,
    managerApproval: ar.managerApproval,
    ownerApproval: ar.ownerApproval,
    reason: ar.reason,
  }
}
