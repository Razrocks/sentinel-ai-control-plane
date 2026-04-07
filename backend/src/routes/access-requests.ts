import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { NotFoundError } from '../lib/errors.js'

export async function accessRequestsRoutes(app: FastifyInstance) {
  // GET /api/access-requests
  app.get('/api/access-requests', async (request) => {
    const { status, riskLevel, requester } = request.query as Record<string, string | undefined>

    const where: Record<string, unknown> = {}
    if (status) where.status = status
    if (riskLevel) where.riskLevel = riskLevel
    if (requester) where.requester = { contains: requester, mode: 'insensitive' }

    const requests = await prisma.accessRequest.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
    })

    return requests.map(mapAccessRequest)
  })

  // GET /api/access-requests/:id
  app.get('/api/access-requests/:id', async (request) => {
    const { id } = request.params as { id: string }

    const ar = await prisma.accessRequest.findUnique({ where: { id } })
    if (!ar) throw new NotFoundError('AccessRequest', id)

    return mapAccessRequest(ar)
  })
}

function mapAccessRequest(ar: any) {
  return {
    id: ar.id,
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
    createdAt: ar.createdAt.toISOString(),
    updatedAt: ar.updatedAt.toISOString(),
  }
}
