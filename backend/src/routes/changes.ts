import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { NotFoundError } from '../lib/errors.js'

export async function changesRoutes(app: FastifyInstance) {
  // GET /api/changes — list all changes with optional filters
  app.get('/api/changes', async (request) => {
    const { riskLevel, status, service, environment } = request.query as Record<string, string | undefined>

    const where: Record<string, unknown> = {}
    if (riskLevel) where.riskLevel = riskLevel
    if (status) where.status = status
    if (service) where.service = { contains: service, mode: 'insensitive' }
    if (environment) where.environment = environment

    const changes = await prisma.change.findMany({
      where,
      include: {
        blastRadius: true,
        recommendations: true,
        auditEvents: { orderBy: { timestamp: 'desc' } },
      },
      orderBy: { updatedAt: 'desc' },
    })

    // Map DB fields to frontend-expected shape
    return changes.map(mapChange)
  })

  // GET /api/changes/:id — single change with full relations
  app.get('/api/changes/:id', async (request) => {
    const { id } = request.params as { id: string }

    const change = await prisma.change.findUnique({
      where: { id },
      include: {
        blastRadius: true,
        recommendations: true,
        auditEvents: { orderBy: { timestamp: 'desc' } },
      },
    })

    if (!change) throw new NotFoundError('Change', id)
    return mapChange(change)
  })
}

// Map Prisma model to frontend-expected JSON shape
function mapChange(change: any) {
  return {
    id: change.id,
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
    createdAt: change.createdAt.toISOString(),
    updatedAt: change.updatedAt.toISOString(),
    blastRadius: change.blastRadius.map(mapBlastRadiusItem),
    recommendations: change.recommendations.map(mapRecommendation),
    auditEvents: change.auditEvents.map(mapAuditEvent),
    version: change.version ?? 0,
  }
}

function mapBlastRadiusItem(item: any) {
  return {
    id: item.id,
    name: item.name,
    type: item.type,
    reason: item.reason,
    confidence: item.confidence,
    criticality: item.criticality,
    ownerTeam: item.ownerTeam,
    details: item.details,
  }
}

function mapRecommendation(rec: any) {
  return {
    id: rec.id,
    title: rec.title,
    reason: rec.reason,
    evidence: rec.evidence,
    classification: rec.classification,
    expectedBenefit: rec.expectedBenefit,
    requiredApprovals: rec.requiredApprovals,
    executableNow: rec.executableNow,
    draftOnly: rec.draftOnly,
  }
}

function mapAuditEvent(event: any) {
  return {
    id: event.id,
    timestamp: event.timestamp.toISOString(),
    actor: event.actor,
    action: event.action,
    objectType: event.objectType,
    objectId: event.objectId,
    objectTitle: event.objectTitle,
    policyRule: event.policyRule,
    result: event.result,
    details: event.details,
  }
}
