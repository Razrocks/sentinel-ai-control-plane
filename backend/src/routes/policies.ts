import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'

export async function policiesRoutes(app: FastifyInstance) {
  // GET /api/policies
  app.get('/api/policies', async (request) => {
    const { bundle, isActive } = request.query as Record<string, string | undefined>

    const where: Record<string, unknown> = {}
    if (bundle) where.bundle = bundle
    if (isActive !== undefined) where.isActive = isActive === 'true'

    const rules = await prisma.policyRule.findMany({
      where,
      orderBy: { name: 'asc' },
    })

    return rules.map(mapPolicyRule)
  })
}

function mapPolicyRule(rule: any) {
  return {
    id: rule.id,
    name: rule.name,
    description: rule.description,
    bundle: rule.bundle,
    decision: rule.decision,
    scope: rule.scope,
    appliesTo: rule.appliesTo,
    isActive: rule.isActive,
  }
}
