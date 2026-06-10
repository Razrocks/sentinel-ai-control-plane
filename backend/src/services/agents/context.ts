/**
 * Context loaders — build a SkillContext from the database.
 *
 * Skills consume context tiers (T1.b policy bundle, T1.c role constraints,
 * T1.d org & service catalog, T2 entity extras, T4 audit slice, T5 temporal).
 * These loaders pull the data that's deterministic — same answer for the same
 * timestamp — so the runner can hash a stable prompt and the model gets
 * accurate framing.
 *
 * Service catalog is partly derived: User.systemsOwned + the set of
 * Change.service values + a small criticality heuristic. v1 keeps this
 * simple; a future iteration moves it to a dedicated `services` table.
 */

import { prisma } from '../../lib/prisma.js'
import type {
  SkillContext,
  T1bPolicyBundle,
  T1cRoleConstraints,
  T1dOrgCatalog,
  T2Context,
  T4Context,
  T5Context,
} from '../skills/index.js'

// ─── T1.b — active policy bundle + active freezes ───────

export async function loadPolicyBundle(): Promise<T1bPolicyBundle> {
  const [rules, freezes] = await Promise.all([
    prisma.policyRule.findMany({ where: { isActive: true } }),
    prisma.freezeWindow.findMany({
      where: { isActive: true, endsAt: { gt: new Date() } },
    }),
  ])

  return {
    bundleVersion: 'v1.0.0',
    rules: rules.map((r) => ({
      name: r.name,
      description: r.description,
      bundle: r.bundle,
      decision: r.decision,
      scope: r.scope,
      appliesTo: r.appliesTo,
      // Newer admin-authored context. Fed verbatim into the skill prompt so
      // the agent can explain enforcement + pattern-match similar requests.
      rationale: r.rationale,
      examples: r.examples,
      tags: r.tags,
    })),
    activeFreezes: freezes.map((f) => ({
      id: f.id,
      label: f.name,
      scope: f.appliesTo.length === 0 ? 'global' : 'scoped',
      startsAt: f.startsAt.toISOString(),
      endsAt: f.endsAt.toISOString(),
      affectsServices: f.appliesTo,
    })),
  }
}

// ─── T1.c — role constraints (small static table) ───────

const roleConstraintsTable: Record<string, T1cRoleConstraints> = {
  operator: {
    role: 'operator',
    label: 'Operator',
    description: 'Change review, release readiness, escalation, controlled execution',
    allowed: [
      'Assess and triage changes/incidents',
      'Draft recommendations',
      'Escalate to reviewers',
      'Simulate changes',
      'Route for approval',
    ],
    blocked: [
      'Cannot approve or deny requests',
      'Cannot execute changes directly',
      'Cannot grant access',
      'Cannot override policies',
    ],
  },
  engineer: {
    role: 'engineer',
    label: 'Engineer',
    description: 'Impact analysis, code review, patch generation, technical implementation',
    allowed: [
      'Analyze blast radius and code impact',
      'Simulate changes',
      'Generate patches and PRs',
      'Inspect execution results',
    ],
    blocked: [
      'Cannot approve changes',
      'Cannot deploy to production directly',
      'Cannot grant access',
    ],
  },
  it_support: {
    role: 'it_support',
    label: 'IT Support',
    description: 'Incidents, service requests, KB remediation, safe operational fixes',
    allowed: [
      'Triage incidents',
      'Draft responses and work notes',
      'Trigger safe remediations',
      'Link KB articles',
      'Route and escalate',
    ],
    blocked: [
      'Cannot approve requests',
      'Cannot execute high-risk fixes',
      'Cannot grant access',
      'Cannot modify protected systems',
    ],
  },
  approver: {
    role: 'approver',
    label: 'Approver',
    description: 'Reviews changes, access requests, remediation approvals',
    allowed: [
      'Approve or deny requests',
      'Approve with conditions',
      'Request additional information',
      'Review evidence',
    ],
    blocked: [
      'Cannot execute changes (execution is system-handled)',
      'Cannot edit policies',
      'Cannot self-approve own requests',
    ],
  },
  access_approver: {
    role: 'access_approver',
    label: 'Access Approver',
    description: 'System owner — approves access to specific systems, roles, entitlements',
    allowed: [
      'Approve or deny access requests for owned systems',
      'Review entitlement eligibility',
      'Request additional information',
    ],
    blocked: [
      'Cannot bypass manager approval chain',
      'Cannot modify entitlement rules',
      'Cannot execute changes',
    ],
  },
  admin: {
    role: 'admin',
    label: 'Admin',
    description: 'Guardrails, integrations, policy bundles, governance configuration',
    allowed: [
      'All actions available',
      'Manage policies and integrations',
      'Override with audit trail',
      'Review governance metrics',
    ],
    blocked: [
      'Cannot bypass audit trail',
      'All production actions still require controlled execution mode',
    ],
  },
}

export function loadRoleConstraints(role: string): T1cRoleConstraints {
  return roleConstraintsTable[role] ?? roleConstraintsTable.operator
}

// ─── T1.d — org & service catalog ───────────────────────

const SERVICE_CRITICALITY: Record<string, 'critical' | 'high' | 'medium' | 'low'> = {
  'payment-service': 'critical',
  'order-api': 'high',
  'fraud-detection': 'high',
  'billing-monthly-job': 'high',
  'customer-data-warehouse': 'high',
  'identity-service': 'critical',
  'search-service': 'medium',
  'recommendations-service': 'medium',
  'inventory-service': 'high',
}

const SERVICE_DOWNSTREAM: Record<string, string[]> = {
  'payment-service': ['order-api', 'billing-monthly-job'],
  'order-api': ['inventory-service'],
  'identity-service': ['payment-service', 'order-api'],
}

export async function loadOrgCatalog(): Promise<T1dOrgCatalog> {
  const [users, changes] = await Promise.all([
    prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        team: true,
        managerId: true,
        systemsOwned: true,
      },
    }),
    prisma.change.findMany({ select: { service: true }, distinct: ['service'] }),
  ])

  // Build service catalog: union of declared service-criticality keys + observed services
  const observedServices = new Set<string>([
    ...Object.keys(SERVICE_CRITICALITY),
    ...changes.map((c) => c.service),
  ])

  const services: T1dOrgCatalog['services'] = {}
  for (const svc of observedServices) {
    const ownerUserIds = users.filter((u) => u.systemsOwned.includes(svc)).map((u) => u.id)
    const team = ownerUserIds.length > 0
      ? users.find((u) => u.id === ownerUserIds[0])!.team
      : 'Unknown'
    services[svc] = {
      team,
      criticality: SERVICE_CRITICALITY[svc] ?? 'medium',
      ownerUserIds,
      downstream: SERVICE_DOWNSTREAM[svc] ?? [],
    }
  }

  // Approver registry: role-name → user IDs of holders
  const approverRegistry: Record<string, string[]> = {
    approver: users.filter((u) => u.role === 'approver').map((u) => u.id),
    access_approver: users.filter((u) => u.role === 'access_approver').map((u) => u.id),
    admin: users.filter((u) => u.role === 'admin').map((u) => u.id),
  }

  return { users, services, approverRegistry }
}

// ─── T5 — temporal ──────────────────────────────────────

export async function loadTemporal(): Promise<T5Context> {
  const now = new Date()
  const freezes = await prisma.freezeWindow.findMany({
    where: { isActive: true, endsAt: { gt: now } },
  })
  return {
    now: now.toISOString(),
    activeFreezes: freezes.map((f) => ({
      id: f.id,
      label: f.name,
      endsAt: f.endsAt.toISOString(),
    })),
  }
}

// ─── T2 — entity extras for changes ─────────────────────

export async function loadChangeT2Extras(service: string): Promise<T2Context> {
  // Recent deploys = audit events with action contains "executed" or "deployed", on this service's changes
  const recent = await prisma.auditEvent.findMany({
    where: {
      objectType: 'execution',
      change: { service },
      timestamp: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    },
    orderBy: { timestamp: 'desc' },
    take: 10,
    include: { change: { select: { ticketId: true } } },
  })

  return {
    recentDeploysOnService: recent.map((e) => ({
      ticketId: e.change?.ticketId ?? e.objectId,
      deployedAt: e.timestamp.toISOString(),
      result: e.result,
    })),
  }
}

// ─── T2 — entity extras for incidents ───────────────────

export async function loadIncidentT2Extras(affectedService: string): Promise<T2Context> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  const [recentDeployEvents, recentIncidents] = await Promise.all([
    prisma.auditEvent.findMany({
      where: {
        objectType: 'execution',
        result: 'success',
        change: { service: affectedService },
        timestamp: { gte: sevenDaysAgo },
      },
      orderBy: { timestamp: 'desc' },
      take: 10,
      include: { change: { select: { ticketId: true } } },
    }),
    prisma.incident.findMany({
      where: {
        affectedService,
        status: 'resolved',
        updatedAt: { gte: thirtyDaysAgo },
      },
      orderBy: { updatedAt: 'desc' },
      take: 10,
      select: { incidentId: true, rootCauseCategory: true, updatedAt: true },
    }),
  ])

  return {
    recentDeploysOnService: recentDeployEvents.map((e) => ({
      ticketId: e.change?.ticketId ?? e.objectId,
      deployedAt: e.timestamp.toISOString(),
      result: e.result,
    })),
    recentIncidentsOnService: recentIncidents.map((i) => ({
      incidentId: i.incidentId,
      rootCauseCategory: i.rootCauseCategory,
      resolvedAt: i.updatedAt.toISOString(),
    })),
  }
}

// ─── T4 — audit slice for an object ─────────────────────

export async function loadAuditSlice(opts: {
  objectType: 'change' | 'incident' | 'access' | 'execution' | 'approval'
  objectId: string
  limit?: number
}): Promise<T4Context> {
  const events = await prisma.auditEvent.findMany({
    where: { objectType: opts.objectType, objectId: opts.objectId },
    orderBy: { timestamp: 'desc' },
    take: opts.limit ?? 20,
  })
  return {
    recentAuditEvents: events.map((e) => ({
      timestamp: e.timestamp.toISOString(),
      actor: e.actor,
      action: e.action,
      objectId: e.objectId,
      result: e.result,
    })),
  }
}

// ─── Composite ──────────────────────────────────────────

export interface BuildContextOptions {
  actor: string
  role?: string
  includePolicy?: boolean
  includeRole?: boolean
  includeOrgCatalog?: boolean
  includeTemporal?: boolean
}

/**
 * Build a base SkillContext with T1 tiers loaded from DB.
 * Caller adds T2/T4 entity-specific extras.
 */
export async function buildBaseContext(opts: BuildContextOptions): Promise<SkillContext> {
  const tasks: Promise<unknown>[] = []
  const result: SkillContext = { actor: opts.actor, t1: {} }

  if (opts.includePolicy !== false) {
    tasks.push(
      loadPolicyBundle().then((b) => {
        result.t1!.policyBundle = b
      }),
    )
  }
  if (opts.includeRole !== false && opts.role) {
    result.t1!.roleConstraints = loadRoleConstraints(opts.role)
  }
  if (opts.includeOrgCatalog !== false) {
    tasks.push(
      loadOrgCatalog().then((c) => {
        result.t1!.orgCatalog = c
      }),
    )
  }
  if (opts.includeTemporal !== false) {
    tasks.push(
      loadTemporal().then((t) => {
        result.t5 = t
      }),
    )
  }

  await Promise.all(tasks)
  return result
}
