import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { NotFoundError, ValidationError } from '../lib/errors.js'
import { requireAuth } from '../middleware/auth.js'
import { requireRole } from '../middleware/rbac.js'

type PolicyDecision = 'allow' | 'deny' | 'escalate' | 'simulate_only'

const VALID_DECISIONS: PolicyDecision[] = ['allow', 'deny', 'escalate', 'simulate_only']

interface PolicyRuleBody {
  name?: string
  description?: string
  bundle?: string
  decision?: PolicyDecision
  scope?: string
  appliesTo?: string[]
  isActive?: boolean
  rationale?: string | null
  examples?: string[]
  tags?: string[]
  expectedVersion?: number
}

function validateCreateBody(body: PolicyRuleBody): asserts body is Required<
  Pick<PolicyRuleBody, 'name' | 'description' | 'bundle' | 'decision' | 'scope'>
> &
  PolicyRuleBody {
  if (!body.name || !body.name.trim()) throw new ValidationError('name is required')
  if (!body.description || !body.description.trim())
    throw new ValidationError('description is required')
  if (!body.bundle || !body.bundle.trim()) throw new ValidationError('bundle is required')
  if (!body.decision || !VALID_DECISIONS.includes(body.decision)) {
    throw new ValidationError(`decision must be one of: ${VALID_DECISIONS.join(', ')}`)
  }
  if (!body.scope || !body.scope.trim()) throw new ValidationError('scope is required')
}

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

  // POST /api/policies — create new rule. Admin only.
  app.post(
    '/api/policies',
    { preHandler: [requireAuth, requireRole('admin')] },
    async (request, reply) => {
      const body = request.body as PolicyRuleBody
      validateCreateBody(body)

      const created = await prisma.policyRule.create({
        data: {
          name: body.name!.trim(),
          description: body.description!.trim(),
          bundle: body.bundle!.trim(),
          decision: body.decision!,
          scope: body.scope!.trim(),
          appliesTo: body.appliesTo ?? [],
          isActive: body.isActive ?? true,
          rationale: body.rationale?.trim() || null,
          examples: body.examples ?? [],
          tags: body.tags ?? [],
          createdBy: request.user!.name,
          updatedBy: request.user!.name,
        },
      })

      await prisma.auditEvent.create({
        data: {
          actor: request.user!.name,
          action: 'policy_rule_created',
          objectType: 'policy_rule' as any,
          objectId: created.id,
          objectTitle: created.name,
          result: 'success',
          details: `decision=${created.decision} scope=${created.scope}`,
        },
      })

      reply.header('ETag', `"${created.version}"`)
      return reply.code(201).send(mapPolicyRule(created))
    },
  )

  // PATCH /api/policies/:id — update fields. Admin only. Optimistic locking.
  app.patch<{ Params: { id: string } }>(
    '/api/policies/:id',
    { preHandler: [requireAuth, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params
      const body = request.body as PolicyRuleBody

      const existing = await prisma.policyRule.findUnique({ where: { id } })
      if (!existing) throw new NotFoundError('PolicyRule', id)

      const ifMatchHeader = (request.headers['if-match'] as string | undefined)
        ?.replace(/"/g, '')
        .trim()
      const headerVersion = ifMatchHeader && /^\d+$/.test(ifMatchHeader)
        ? Number(ifMatchHeader)
        : undefined
      const expectedVersion = headerVersion ?? body.expectedVersion

      if (expectedVersion !== undefined && existing.version !== expectedVersion) {
        return reply.code(412).send({
          error: 'version_conflict',
          message: `Policy rule modified by another writer. Expected ${expectedVersion}, current ${existing.version}.`,
          currentVersion: existing.version,
        })
      }

      if (body.decision && !VALID_DECISIONS.includes(body.decision)) {
        throw new ValidationError(`decision must be one of: ${VALID_DECISIONS.join(', ')}`)
      }

      const updated = await prisma.policyRule.update({
        where: { id },
        data: {
          ...(body.name !== undefined && { name: body.name.trim() }),
          ...(body.description !== undefined && { description: body.description.trim() }),
          ...(body.bundle !== undefined && { bundle: body.bundle.trim() }),
          ...(body.decision !== undefined && { decision: body.decision }),
          ...(body.scope !== undefined && { scope: body.scope.trim() }),
          ...(body.appliesTo !== undefined && { appliesTo: body.appliesTo }),
          ...(body.isActive !== undefined && { isActive: body.isActive }),
          ...(body.rationale !== undefined && { rationale: body.rationale?.trim() || null }),
          ...(body.examples !== undefined && { examples: body.examples }),
          ...(body.tags !== undefined && { tags: body.tags }),
          updatedBy: request.user!.name,
          version: { increment: 1 },
        },
      })

      await prisma.auditEvent.create({
        data: {
          actor: request.user!.name,
          action: 'policy_rule_updated',
          objectType: 'policy_rule' as any,
          objectId: updated.id,
          objectTitle: updated.name,
          result: 'success',
          details: Object.keys(body)
            .filter((k) => k !== 'expectedVersion')
            .join(','),
        },
      })

      reply.header('ETag', `"${updated.version}"`)
      return reply.send(mapPolicyRule(updated))
    },
  )

  // DELETE /api/policies/:id — admin only. Soft-disables by default unless
  // ?hard=true is passed (destructive — wipes audit linkage).
  app.delete<{ Params: { id: string }; Querystring: { hard?: string } }>(
    '/api/policies/:id',
    { preHandler: [requireAuth, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params
      const hard = request.query.hard === 'true'

      const existing = await prisma.policyRule.findUnique({ where: { id } })
      if (!existing) throw new NotFoundError('PolicyRule', id)

      if (hard) {
        await prisma.policyRule.delete({ where: { id } })
        await prisma.auditEvent.create({
          data: {
            actor: request.user!.name,
            action: 'policy_rule_deleted',
            objectType: 'policy_rule' as any,
            objectId: id,
            objectTitle: existing.name,
            result: 'success',
            details: 'hard delete',
          },
        })
        return reply.code(204).send()
      }

      const updated = await prisma.policyRule.update({
        where: { id },
        data: { isActive: false, updatedBy: request.user!.name, version: { increment: 1 } },
      })

      await prisma.auditEvent.create({
        data: {
          actor: request.user!.name,
          action: 'policy_rule_disabled',
          objectType: 'policy_rule' as any,
          objectId: id,
          objectTitle: updated.name,
          result: 'success',
          details: 'soft delete (isActive=false)',
        },
      })

      reply.header('ETag', `"${updated.version}"`)
      return reply.send(mapPolicyRule(updated))
    },
  )
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
    rationale: rule.rationale ?? null,
    examples: rule.examples ?? [],
    tags: rule.tags ?? [],
    createdAt: rule.createdAt?.toISOString?.() ?? null,
    updatedAt: rule.updatedAt?.toISOString?.() ?? null,
    createdBy: rule.createdBy ?? null,
    updatedBy: rule.updatedBy ?? null,
    version: rule.version ?? 0,
  }
}
