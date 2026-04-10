import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { subscribeAudit } from '../services/audit.js'

export async function auditRoutes(app: FastifyInstance) {

  // ─── SSE stream ─────────────────────────────────────────
  // GET /api/audit-events/stream
  // Clients receive a real-time feed of every new audit event.
  // Must be registered BEFORE the parameterised /:id route (if any).
  app.get('/api/audit-events/stream', async (request, reply) => {
    // Set SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no', // nginx pass-through
    })

    // Send initial connected event
    reply.raw.write(`event: connected\ndata: ${JSON.stringify({ status: 'connected', timestamp: new Date().toISOString() })}\n\n`)

    // Keep-alive heartbeat every 30 seconds
    const heartbeat = setInterval(() => {
      reply.raw.write(`: heartbeat ${new Date().toISOString()}\n\n`)
    }, 30_000)

    // Subscribe to audit events
    const unsubscribe = subscribeAudit((event) => {
      const mapped = {
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
      reply.raw.write(`event: audit\ndata: ${JSON.stringify(mapped)}\n\n`)
    })

    // Clean up on disconnect
    request.raw.on('close', () => {
      clearInterval(heartbeat)
      unsubscribe()
    })

    // Prevent Fastify from closing the response
    reply.hijack()
  })

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
