import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { NotFoundError } from '../lib/errors.js'

export async function approvalsRoutes(app: FastifyInstance) {
  // GET /api/approvals
  app.get('/api/approvals', async (request) => {
    const { type, status, riskLevel } = request.query as Record<string, string | undefined>

    const where: Record<string, unknown> = {}
    if (type) where.type = type
    if (status) where.status = status
    if (riskLevel) where.riskLevel = riskLevel

    const approvals = await prisma.approval.findMany({
      where,
      include: {
        coApprovals: true,
        decisionImpact: true,
        // Surface notes inline. Approver UI renders them under the body;
        // agent context loader also reads them to inject human rationale
        // into routing/decision-impact prompts. Soft-deleted notes hidden.
        notes: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
    })

    return approvals.map(mapApproval)
  })

  // GET /api/approvals/:id
  app.get('/api/approvals/:id', async (request) => {
    const { id } = request.params as { id: string }

    const approval = await prisma.approval.findUnique({
      where: { id },
      include: {
        coApprovals: true,
        decisionImpact: true,
        notes: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
      },
    })

    if (!approval) throw new NotFoundError('Approval', id)
    return mapApproval(approval)
  })
}

function mapApproval(approval: any) {
  return {
    id: approval.id,
    type: approval.type,
    title: approval.title,
    requester: approval.requester,
    impactedSystem: approval.impactedSystem,
    riskLevel: approval.riskLevel,
    reason: approval.reason,
    recommendedAction: approval.recommendedAction,
    status: approval.status,
    condition: approval.condition ?? undefined,
    createdAt: approval.createdAt.toISOString(),
    linkedObjectId: approval.linkedObjectId,
    whyYouAreRequired: approval.whyYouAreRequired ?? undefined,
    // B5: surface the optimistic-lock version so clients can echo it back via
    // `If-Match` or `expectedVersion` on the next decide call.
    version: approval.version,
    coApprovals: approval.coApprovals?.map((ca: any) => ({
      role: ca.role,
      name: ca.name,
      status: ca.status,
      decidedAt: ca.decidedAt?.toISOString(),
    })),
    decisionImpact: approval.decisionImpact
      ? {
          approve: approval.decisionImpact.approve,
          deny: approval.decisionImpact.deny,
          escalate: approval.decisionImpact.escalate,
        }
      : undefined,
    notes:
      approval.notes?.map((n: any) => ({
        id: n.id,
        actor: n.actor,
        content: n.content,
        createdAt: n.createdAt.toISOString(),
        updatedAt: n.updatedAt.toISOString(),
        editedBy: n.editedBy ?? undefined,
      })) ?? [],
  }
}
