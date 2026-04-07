import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'

export async function auditRoutes(app: FastifyInstance) {
  // GET /api/audit-events
  app.get('/api/audit-events', async (request) => {
    const { objectType, result, actor, limit, offset } = request.query as Record<string, string | undefined>

    const where: Record<string, unknown> = {}
    if (objectType) where.objectType = objectType
    if (result) where.result = result
    if (actor) where.actor = { contains: actor, mode: 'insensitive' }

    const take = Math.min(parseInt(limit || '100', 10), 500)
    const skip = parseInt(offset || '0', 10)

    const [events, total] = await Promise.all([
      prisma.auditEvent.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        take,
        skip,
      }),
      prisma.auditEvent.count({ where }),
    ])

    return {
      data: events.map(mapAuditEvent),
      total,
      limit: take,
      offset: skip,
    }
  })
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
