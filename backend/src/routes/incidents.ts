import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { NotFoundError } from '../lib/errors.js'

export async function incidentsRoutes(app: FastifyInstance) {
  // GET /api/incidents
  app.get('/api/incidents', async (request) => {
    const { severity, status, affectedService } = request.query as Record<string, string | undefined>

    const where: Record<string, unknown> = {}
    if (severity) where.severity = severity
    if (status) where.status = status === 'new' ? 'new_incident' : status
    if (affectedService) where.affectedService = { contains: affectedService, mode: 'insensitive' }

    const incidents = await prisma.incident.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
    })

    return incidents.map(mapIncident)
  })

  // GET /api/incidents/:id
  app.get('/api/incidents/:id', async (request) => {
    const { id } = request.params as { id: string }

    const incident = await prisma.incident.findUnique({ where: { id } })
    if (!incident) throw new NotFoundError('Incident', id)

    return mapIncident(incident)
  })
}

function mapIncident(incident: any) {
  return {
    id: incident.id,
    incidentId: incident.incidentId,
    title: incident.title,
    description: incident.description,
    requester: incident.requester,
    affectedService: incident.affectedService,
    severity: incident.severity,
    // Map DB enum back to frontend-expected value
    status: incident.status === 'new_incident' ? 'new' : incident.status,
    assignmentGroup: incident.assignmentGroup,
    relatedCI: incident.relatedCI,
    relatedChanges: incident.relatedChanges,
    likelyIssueType: incident.likelyIssueType,
    rootCauseCategory: incident.rootCauseCategory,
    recommendedFix: incident.recommendedFix,
    kbArticles: incident.kbArticles,
    isRecurring: incident.isRecurring,
    createdAt: incident.createdAt.toISOString(),
    updatedAt: incident.updatedAt.toISOString(),
  }
}
