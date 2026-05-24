/**
 * Chat lookup tools — Anthropic tool-use definitions + handlers.
 *
 * Lets chat fetch grounded data on demand instead of inventing it:
 *   - lookup_user      — directory by name/email/role
 *   - lookup_service   — service catalog entry
 *   - lookup_entity    — change/incident/access_request by ID
 *   - lookup_policy_rule — policy rule by name
 *   - lookup_audit_for_entity — audit slice for specific entity
 *   - lookup_recent_activity — recent actions by specific actor
 *
 * Each tool:
 *   - Returns JSON (stringified) for tool_result feedback to Claude.
 *   - Returns "not found" rather than throwing → Claude can say so to user.
 *   - Bounds output size to avoid prompt bloat.
 *
 * Anti-hallucination contract: chat system prompt instructs Claude to call
 * these tools BEFORE naming specific entities/users it wasn't given.
 */

import { prisma } from '../lib/prisma.js'

// ─── Tool definitions (sent to Claude) ──────────────────

export const CHAT_TOOLS = [
  {
    name: 'lookup_user',
    description:
      'Find a user in the directory. Use BEFORE referencing a person by name or email. Returns matching users with id, name, email, role, team, manager, and systems owned. Returns empty array if no match — say so to user, never invent.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description:
            'Partial or full name, email, or role to search for. Case-insensitive substring match across name and email.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'lookup_service',
    description:
      'Get a service catalog entry. Use BEFORE describing service ownership or relationships. Returns team, criticality tier, owner user IDs, and downstream dependencies.',
    input_schema: {
      type: 'object' as const,
      properties: {
        serviceName: {
          type: 'string',
          description: 'Exact service name (e.g. "payment-service").',
        },
      },
      required: ['serviceName'],
    },
  },
  {
    name: 'lookup_entity',
    description:
      'Fetch a specific Change, Incident, or AccessRequest by ticket ID. Use BEFORE quoting fields the user did not provide. Returns full entity with first-degree relations (blast radius, recommendations, co-approvals).',
    input_schema: {
      type: 'object' as const,
      properties: {
        entityType: {
          type: 'string',
          enum: ['change', 'incident', 'access_request'],
          description: 'Type of entity to fetch.',
        },
        idOrTicket: {
          type: 'string',
          description: 'DB id (cuid) OR ticket id (e.g. "CHG-2024-0851", "INC-2024-1198", "AR-2024-0389").',
        },
      },
      required: ['entityType', 'idOrTicket'],
    },
  },
  {
    name: 'lookup_policy_rule',
    description:
      'Get an active policy rule by name. Use BEFORE explaining what a policy says or does.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Policy rule name (e.g. "production-write-guard").' },
      },
      required: ['name'],
    },
  },
  {
    name: 'lookup_audit_for_entity',
    description:
      'Get recent audit events for a specific entity. Use to answer "what has happened to X?" / "who acted on this?". Returns up to 20 most recent events with actor, action, result, timestamp.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entityType: {
          type: 'string',
          enum: ['change', 'incident', 'access', 'execution', 'approval'],
        },
        idOrTicket: { type: 'string', description: 'DB id or ticket id of the entity.' },
        limit: { type: 'number', description: 'Max events to return (default 20, max 50).' },
      },
      required: ['entityType', 'idOrTicket'],
    },
  },
  {
    name: 'lookup_recent_activity',
    description:
      'Get recent actions by a specific actor (user name or "system"). Use to answer "what has Sarah done?" / "what did the AI run for me today?". Returns up to 20 most recent audit events.',
    input_schema: {
      type: 'object' as const,
      properties: {
        actor: { type: 'string', description: 'Actor name (exact match, e.g. "J. Wu") or "system".' },
        limit: { type: 'number', description: 'Max events (default 20, max 50).' },
      },
      required: ['actor'],
    },
  },
] as const

// ─── Handler — execute a tool by name ───────────────────

export interface ToolCallResult {
  content: string // JSON-stringified result for tool_result block
  isError?: boolean
}

export async function executeTool(name: string, input: Record<string, unknown>): Promise<ToolCallResult> {
  try {
    switch (name) {
      case 'lookup_user':
        return await handleLookupUser(input as { query: string })
      case 'lookup_service':
        return await handleLookupService(input as { serviceName: string })
      case 'lookup_entity':
        return await handleLookupEntity(input as { entityType: string; idOrTicket: string })
      case 'lookup_policy_rule':
        return await handleLookupPolicyRule(input as { name: string })
      case 'lookup_audit_for_entity':
        return await handleLookupAuditForEntity(
          input as { entityType: string; idOrTicket: string; limit?: number },
        )
      case 'lookup_recent_activity':
        return await handleLookupRecentActivity(input as { actor: string; limit?: number })
      default:
        return { content: JSON.stringify({ error: `unknown tool: ${name}` }), isError: true }
    }
  } catch (err) {
    return {
      content: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      isError: true,
    }
  }
}

// ─── Handlers ───────────────────────────────────────────

async function handleLookupUser(input: { query: string }): Promise<ToolCallResult> {
  const q = (input.query || '').trim()
  if (!q) return { content: JSON.stringify({ users: [], note: 'empty query' }) }

  // Role is a Prisma enum — only include it in the OR if query matches an exact enum value.
  const VALID_ROLES = ['operator', 'engineer', 'it_support', 'approver', 'access_approver', 'admin'] as const
  const qLower = q.toLowerCase()
  const roleMatch = (VALID_ROLES as readonly string[]).includes(qLower) ? qLower : null

  const where = {
    OR: [
      { name: { contains: q, mode: 'insensitive' as const } },
      { email: { contains: q, mode: 'insensitive' as const } },
      ...(roleMatch ? [{ role: roleMatch as never }] : []),
    ],
  }

  const users = await prisma.user.findMany({
    where,
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      team: true,
      managerId: true,
      systemsOwned: true,
    },
    take: 10,
  })

  return { content: JSON.stringify({ users, matchCount: users.length }) }
}

async function handleLookupService(input: { serviceName: string }): Promise<ToolCallResult> {
  const name = (input.serviceName || '').trim()
  if (!name) return { content: JSON.stringify({ error: 'serviceName required' }), isError: true }

  // Pull from User.systemsOwned to identify owners, and aggregate
  const owners = await prisma.user.findMany({
    where: { systemsOwned: { has: name } },
    select: { id: true, name: true, email: true, team: true },
  })

  // Service catalog is partly static (defined in agents/context.ts SERVICE_CRITICALITY)
  // For tool, we report what DB knows.
  const recentChanges = await prisma.change.findMany({
    where: { service: name },
    select: { ticketId: true, title: true, riskLevel: true, status: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
    take: 5,
  })

  return {
    content: JSON.stringify({
      serviceName: name,
      ownerTeam: owners[0]?.team ?? 'unknown',
      owners,
      recentChanges,
      note:
        owners.length === 0 && recentChanges.length === 0
          ? 'no users own this service and no changes reference it — service may not exist or name is wrong'
          : undefined,
    }),
  }
}

async function handleLookupEntity(input: {
  entityType: string
  idOrTicket: string
}): Promise<ToolCallResult> {
  const { entityType, idOrTicket } = input

  if (entityType === 'change') {
    const c = await prisma.change.findFirst({
      where: { OR: [{ id: idOrTicket }, { ticketId: idOrTicket }] },
      include: { blastRadius: true, recommendations: true },
    })
    if (!c) return { content: JSON.stringify({ found: false, entityType, idOrTicket }) }
    return {
      content: JSON.stringify({
        found: true,
        change: {
          ticketId: c.ticketId,
          title: c.title,
          description: c.description.slice(0, 800),
          owner: c.owner,
          ownerTeam: c.ownerTeam,
          service: c.service,
          environment: c.environment,
          riskLevel: c.riskLevel,
          status: c.status,
          approvalState: c.approvalState,
          policyDecision: c.policyDecision,
          linkedPRs: c.linkedPRs,
          ciStatus: c.ciStatus,
          maintenanceWindow: c.maintenanceWindow,
          rollbackPlan: c.rollbackPlan,
          blastRadius: c.blastRadius.map((b) => ({
            name: b.name,
            type: b.type,
            criticality: b.criticality,
            ownerTeam: b.ownerTeam,
          })),
          recommendations: c.recommendations.map((r) => ({
            title: r.title,
            requiredApprovals: r.requiredApprovals,
            executableNow: r.executableNow,
          })),
        },
      }),
    }
  }

  if (entityType === 'incident') {
    const i = await prisma.incident.findFirst({
      where: { OR: [{ id: idOrTicket }, { incidentId: idOrTicket }] },
    })
    if (!i) return { content: JSON.stringify({ found: false, entityType, idOrTicket }) }
    return {
      content: JSON.stringify({
        found: true,
        incident: {
          incidentId: i.incidentId,
          title: i.title,
          description: i.description.slice(0, 800),
          requester: i.requester,
          affectedService: i.affectedService,
          severity: i.severity,
          status: i.status,
          assignmentGroup: i.assignmentGroup,
          rootCauseCategory: i.rootCauseCategory,
          recommendedFix: i.recommendedFix,
          isRecurring: i.isRecurring,
          relatedChanges: i.relatedChanges,
        },
      }),
    }
  }

  if (entityType === 'access_request') {
    const a = await prisma.accessRequest.findFirst({
      where: { OR: [{ id: idOrTicket }, { requestId: idOrTicket }] },
    })
    if (!a) return { content: JSON.stringify({ found: false, entityType, idOrTicket }) }
    return {
      content: JSON.stringify({
        found: true,
        accessRequest: {
          requestId: a.requestId,
          requester: a.requester,
          requestedSystem: a.requestedSystem,
          requestedRole: a.requestedRole,
          justification: a.justification.slice(0, 500),
          manager: a.manager,
          systemOwner: a.systemOwner,
          status: a.status,
          riskLevel: a.riskLevel,
          policyDecision: a.policyDecision,
          entitlementCheck: a.entitlementCheck,
          managerApproval: a.managerApproval,
          ownerApproval: a.ownerApproval,
        },
      }),
    }
  }

  return { content: JSON.stringify({ error: `unknown entityType: ${entityType}` }), isError: true }
}

async function handleLookupPolicyRule(input: { name: string }): Promise<ToolCallResult> {
  const r = await prisma.policyRule.findFirst({ where: { name: input.name } })
  if (!r) return { content: JSON.stringify({ found: false, name: input.name }) }
  return {
    content: JSON.stringify({
      found: true,
      rule: {
        name: r.name,
        description: r.description,
        bundle: r.bundle,
        decision: r.decision,
        scope: r.scope,
        appliesTo: r.appliesTo,
        isActive: r.isActive,
      },
    }),
  }
}

async function handleLookupAuditForEntity(input: {
  entityType: string
  idOrTicket: string
  limit?: number
}): Promise<ToolCallResult> {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50)
  const validTypes = ['change', 'incident', 'access', 'execution', 'approval'] as const
  if (!validTypes.includes(input.entityType as never)) {
    return { content: JSON.stringify({ error: `invalid entityType: ${input.entityType}` }), isError: true }
  }

  // For change type, resolve ticketId → cuid first since audit may reference either
  let objectIds: string[] = [input.idOrTicket]
  if (input.entityType === 'change') {
    const c = await prisma.change.findFirst({
      where: { OR: [{ id: input.idOrTicket }, { ticketId: input.idOrTicket }] },
      select: { id: true, ticketId: true },
    })
    if (c) objectIds = [c.id, c.ticketId]
  } else if (input.entityType === 'incident') {
    const i = await prisma.incident.findFirst({
      where: { OR: [{ id: input.idOrTicket }, { incidentId: input.idOrTicket }] },
      select: { id: true, incidentId: true },
    })
    if (i) objectIds = [i.id, i.incidentId]
  } else if (input.entityType === 'access') {
    const a = await prisma.accessRequest.findFirst({
      where: { OR: [{ id: input.idOrTicket }, { requestId: input.idOrTicket }] },
      select: { id: true, requestId: true },
    })
    if (a) objectIds = [a.id, a.requestId]
  }

  const events = await prisma.auditEvent.findMany({
    where: {
      objectType: input.entityType as never,
      objectId: { in: objectIds },
    },
    orderBy: { timestamp: 'desc' },
    take: limit,
    select: {
      timestamp: true,
      actor: true,
      action: true,
      result: true,
      details: true,
      policyRule: true,
    },
  })

  return {
    content: JSON.stringify({
      entityType: input.entityType,
      idOrTicket: input.idOrTicket,
      events: events.map((e) => ({
        timestamp: e.timestamp.toISOString(),
        actor: e.actor,
        action: e.action,
        result: e.result,
        policyRule: e.policyRule ?? undefined,
        details: e.details.slice(0, 200),
      })),
      count: events.length,
    }),
  }
}

async function handleLookupRecentActivity(input: {
  actor: string
  limit?: number
}): Promise<ToolCallResult> {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50)
  const events = await prisma.auditEvent.findMany({
    where: { actor: input.actor },
    orderBy: { timestamp: 'desc' },
    take: limit,
    select: {
      timestamp: true,
      action: true,
      objectType: true,
      objectId: true,
      objectTitle: true,
      result: true,
    },
  })

  return {
    content: JSON.stringify({
      actor: input.actor,
      events: events.map((e) => ({
        timestamp: e.timestamp.toISOString(),
        action: e.action,
        objectType: e.objectType,
        objectId: e.objectId,
        objectTitle: e.objectTitle,
        result: e.result,
      })),
      count: events.length,
    }),
  }
}
