/**
 * Agent routes — admin/operator-gated endpoints to invoke v1 read-path agents
 * on existing entities. Useful for re-triaging without rebuilding seed data,
 * and for ContextualAssistant "re-analyze" buttons on detail pages.
 *
 * All endpoints write provenance via runSkill and audit events via the agent
 * pipeline. The route returns the agent's structured result for inspection.
 */

import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../middleware/auth.js'
import { requireRole } from '../middleware/rbac.js'
import { prisma } from '../lib/prisma.js'
import { NotFoundError, ValidationError } from '../lib/errors.js'
import {
  triageChange,
  triageIncident,
  reviewAccessRequest,
  routeApproval,
} from '../services/agents/index.js'
import { isSkillRunnerConfigured } from '../services/skills/index.js'

export async function agentsRoutes(app: FastifyInstance) {
  // ── Health: skill runner configuration ─────────────────
  app.get(
    '/api/agents/health',
    {
      preHandler: [requireAuth],
    },
    async () => {
      return {
        skillRunnerConfigured: isSkillRunnerConfigured(),
      }
    },
  )

  // ── ChangeTriageAgent ──────────────────────────────────
  app.post<{ Params: { id: string } }>(
    '/api/agents/triage-change/:id',
    {
      preHandler: [requireAuth, requireRole('admin', 'operator', 'engineer')],
    },
    async (request) => {
      if (!isSkillRunnerConfigured()) {
        throw new ValidationError('Skill runner not configured (ANTHROPIC_API_KEY missing)')
      }
      // Resolve change by id OR ticketId
      const change = await prisma.change.findFirst({
        where: { OR: [{ id: request.params.id }, { ticketId: request.params.id }] },
        select: { id: true },
      })
      if (!change) throw new NotFoundError('Change', request.params.id)

      const result = await triageChange({
        changeId: change.id,
        actor: request.user!.name,
      })
      return result
    },
  )

  // ── IncidentTriageAgent ────────────────────────────────
  app.post<{ Params: { id: string } }>(
    '/api/agents/triage-incident/:id',
    {
      preHandler: [requireAuth, requireRole('admin', 'operator', 'it_support', 'engineer')],
    },
    async (request) => {
      if (!isSkillRunnerConfigured()) {
        throw new ValidationError('Skill runner not configured (ANTHROPIC_API_KEY missing)')
      }
      const incident = await prisma.incident.findFirst({
        where: { OR: [{ id: request.params.id }, { incidentId: request.params.id }] },
        select: { id: true },
      })
      if (!incident) throw new NotFoundError('Incident', request.params.id)

      const result = await triageIncident({
        incidentDbId: incident.id,
        actor: request.user!.name,
      })
      return result
    },
  )

  // ── AccessReviewerAgent ────────────────────────────────
  app.post<{ Params: { id: string } }>(
    '/api/agents/review-access-request/:id',
    {
      preHandler: [requireAuth, requireRole('admin', 'access_approver', 'operator')],
    },
    async (request) => {
      if (!isSkillRunnerConfigured()) {
        throw new ValidationError('Skill runner not configured (ANTHROPIC_API_KEY missing)')
      }
      const ar = await prisma.accessRequest.findFirst({
        where: { OR: [{ id: request.params.id }, { requestId: request.params.id }] },
        select: { id: true },
      })
      if (!ar) throw new NotFoundError('AccessRequest', request.params.id)

      const result = await reviewAccessRequest({
        accessRequestDbId: ar.id,
        actor: request.user!.name,
      })
      return result
    },
  )

  // ── ApprovalRouterAgent ────────────────────────────────
  app.post<{
    Params: { id: string }
    Body: { filerName?: string; requiredApproverRoles?: string[] }
  }>(
    '/api/agents/route-approval/:id',
    {
      preHandler: [requireAuth, requireRole('admin', 'operator')],
    },
    async (request) => {
      if (!isSkillRunnerConfigured()) {
        throw new ValidationError('Skill runner not configured (ANTHROPIC_API_KEY missing)')
      }
      const approval = await prisma.approval.findUnique({
        where: { id: request.params.id },
        select: { id: true },
      })
      if (!approval) throw new NotFoundError('Approval', request.params.id)

      const result = await routeApproval({
        approvalId: approval.id,
        filerName: request.body?.filerName,
        requiredApproverRoles: request.body?.requiredApproverRoles,
        actor: request.user!.name,
      })
      return result
    },
  )
}
