/**
 * Metrics endpoints — admin-only operational visibility.
 *
 * Covers D4 (per-skill cost + counts) and partial D5 (calibration recording).
 * Skips D2/D3/D6 (OTel/Grafana/alerts) which need external infra.
 *
 * Routes:
 *   GET /api/admin/metrics/skills?days=7      — per-skill aggregate
 *   GET /api/admin/metrics/cost?days=7        — total + per-user cost
 *   GET /api/admin/metrics/audit?days=7       — action volume by result
 *   GET /api/admin/metrics/health             — system snapshot
 *
 * All admin-only. Cost = computed from agent_invocations tokens × model pricing.
 */

import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../middleware/auth.js'
import { requireRole } from '../middleware/rbac.js'
import { prisma } from '../lib/prisma.js'

// Sonnet 4 + Haiku 4.5 pricing (USD per 1M tokens).
const PRICING: Record<string, { in: number; out: number }> = {
  'claude-sonnet-4-6': { in: 3, out: 15 },
  'claude-haiku-4-5-20251001': { in: 1, out: 5 },
}

function modelCostUsd(model: string, tokensIn: number, tokensOut: number): number {
  const p = PRICING[model] ?? PRICING['claude-sonnet-4-6']
  return (tokensIn * p.in + tokensOut * p.out) / 1_000_000
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
}

/**
 * Compute p50/p95 from a sorted array of latency values.
 * Returns NaN for both if empty.
 */
function percentiles(sortedLatencies: number[]): { p50: number; p95: number } {
  if (sortedLatencies.length === 0) return { p50: NaN, p95: NaN }
  const p50idx = Math.floor(sortedLatencies.length * 0.5)
  const p95idx = Math.floor(sortedLatencies.length * 0.95)
  return {
    p50: sortedLatencies[p50idx],
    p95: sortedLatencies[Math.min(p95idx, sortedLatencies.length - 1)],
  }
}

export async function metricsRoutes(app: FastifyInstance) {
  // ── Per-skill aggregate ───────────────────────────────
  app.get<{ Querystring: { days?: string } }>(
    '/api/admin/metrics/skills',
    { preHandler: [requireAuth, requireRole('admin')] },
    async (request) => {
      const days = Math.min(Math.max(parseInt(request.query.days ?? '7', 10), 1), 90)
      const since = daysAgo(days)

      const invocations = await prisma.agentInvocation.findMany({
        where: { createdAt: { gte: since } },
        select: {
          skill: true,
          model: true,
          tokensIn: true,
          tokensOut: true,
          latencyMs: true,
          status: true,
          cached: true,
          confidence: true,
        },
      })

      // Aggregate per skill
      const bySkill = new Map<
        string,
        {
          skill: string
          totalCalls: number
          successCount: number
          validationFailedCount: number
          errorCount: number
          cachedCount: number
          tokensIn: number
          tokensOut: number
          costUsd: number
          latencies: number[]
          confidences: number[]
        }
      >()

      for (const inv of invocations) {
        const agg = bySkill.get(inv.skill) ?? {
          skill: inv.skill,
          totalCalls: 0,
          successCount: 0,
          validationFailedCount: 0,
          errorCount: 0,
          cachedCount: 0,
          tokensIn: 0,
          tokensOut: 0,
          costUsd: 0,
          latencies: [],
          confidences: [],
        }
        agg.totalCalls++
        if (inv.status === 'success') agg.successCount++
        else if (inv.status === 'validation_failed') agg.validationFailedCount++
        else agg.errorCount++
        if (inv.cached) agg.cachedCount++
        agg.tokensIn += inv.tokensIn
        agg.tokensOut += inv.tokensOut
        agg.costUsd += modelCostUsd(inv.model, inv.tokensIn, inv.tokensOut)
        agg.latencies.push(inv.latencyMs)
        if (inv.confidence !== null) agg.confidences.push(inv.confidence)
        bySkill.set(inv.skill, agg)
      }

      const result = Array.from(bySkill.values()).map((s) => {
        const sortedLat = [...s.latencies].sort((a, b) => a - b)
        const { p50, p95 } = percentiles(sortedLat)
        const avgConf =
          s.confidences.length > 0 ? s.confidences.reduce((a, b) => a + b, 0) / s.confidences.length : null
        return {
          skill: s.skill,
          totalCalls: s.totalCalls,
          successCount: s.successCount,
          validationFailedCount: s.validationFailedCount,
          errorCount: s.errorCount,
          cacheHitRate: s.totalCalls > 0 ? s.cachedCount / s.totalCalls : 0,
          tokensIn: s.tokensIn,
          tokensOut: s.tokensOut,
          costUsd: Number(s.costUsd.toFixed(4)),
          latencyMsP50: p50,
          latencyMsP95: p95,
          avgConfidence: avgConf !== null ? Number(avgConf.toFixed(3)) : null,
        }
      })
      result.sort((a, b) => b.totalCalls - a.totalCalls)

      return { sinceDays: days, since: since.toISOString(), skills: result }
    },
  )

  // ── Cost summary (total + per-user) ───────────────────
  app.get<{ Querystring: { days?: string } }>(
    '/api/admin/metrics/cost',
    { preHandler: [requireAuth, requireRole('admin')] },
    async (request) => {
      const days = Math.min(Math.max(parseInt(request.query.days ?? '7', 10), 1), 90)
      const since = daysAgo(days)

      const invocations = await prisma.agentInvocation.findMany({
        where: { createdAt: { gte: since } },
        select: { actor: true, model: true, tokensIn: true, tokensOut: true },
      })

      let totalCost = 0
      let totalTokensIn = 0
      let totalTokensOut = 0
      const byActor = new Map<string, { actor: string; calls: number; costUsd: number; tokensIn: number; tokensOut: number }>()
      const byModel = new Map<string, { model: string; calls: number; costUsd: number }>()

      for (const inv of invocations) {
        const cost = modelCostUsd(inv.model, inv.tokensIn, inv.tokensOut)
        totalCost += cost
        totalTokensIn += inv.tokensIn
        totalTokensOut += inv.tokensOut

        const a = byActor.get(inv.actor) ?? { actor: inv.actor, calls: 0, costUsd: 0, tokensIn: 0, tokensOut: 0 }
        a.calls++
        a.costUsd += cost
        a.tokensIn += inv.tokensIn
        a.tokensOut += inv.tokensOut
        byActor.set(inv.actor, a)

        const m = byModel.get(inv.model) ?? { model: inv.model, calls: 0, costUsd: 0 }
        m.calls++
        m.costUsd += cost
        byModel.set(inv.model, m)
      }

      return {
        sinceDays: days,
        since: since.toISOString(),
        totalCalls: invocations.length,
        totalCostUsd: Number(totalCost.toFixed(4)),
        totalTokensIn,
        totalTokensOut,
        byActor: Array.from(byActor.values())
          .map((a) => ({ ...a, costUsd: Number(a.costUsd.toFixed(4)) }))
          .sort((a, b) => b.costUsd - a.costUsd),
        byModel: Array.from(byModel.values())
          .map((m) => ({ ...m, costUsd: Number(m.costUsd.toFixed(4)) }))
          .sort((a, b) => b.costUsd - a.costUsd),
      }
    },
  )

  // ── Audit volume + outcomes ───────────────────────────
  app.get<{ Querystring: { days?: string } }>(
    '/api/admin/metrics/audit',
    { preHandler: [requireAuth, requireRole('admin')] },
    async (request) => {
      const days = Math.min(Math.max(parseInt(request.query.days ?? '7', 10), 1), 90)
      const since = daysAgo(days)

      const events = await prisma.auditEvent.findMany({
        where: { timestamp: { gte: since } },
        select: { action: true, result: true, objectType: true },
      })

      const byAction = new Map<string, { action: string; success: number; blocked: number; denied: number; escalated: number; total: number }>()
      const byResult: Record<string, number> = { success: 0, blocked: 0, denied: 0, escalated: 0 }
      const byType: Record<string, number> = {}

      for (const e of events) {
        byResult[e.result] = (byResult[e.result] ?? 0) + 1
        byType[e.objectType] = (byType[e.objectType] ?? 0) + 1
        const a = byAction.get(e.action) ?? {
          action: e.action,
          success: 0,
          blocked: 0,
          denied: 0,
          escalated: 0,
          total: 0,
        }
        a.total++
        const rk = e.result as keyof typeof a
        if (rk in a && typeof a[rk] === 'number') (a[rk] as number)++
        byAction.set(e.action, a)
      }

      return {
        sinceDays: days,
        since: since.toISOString(),
        totalEvents: events.length,
        byResult,
        byObjectType: byType,
        topActions: Array.from(byAction.values())
          .sort((a, b) => b.total - a.total)
          .slice(0, 20),
      }
    },
  )

  // ── System health snapshot ────────────────────────────
  app.get(
    '/api/admin/metrics/health',
    { preHandler: [requireAuth, requireRole('admin')] },
    async () => {
      const [userCount, changeCount, incidentCount, accessCount, approvalCount, auditCount, invCount, chatCount] =
        await Promise.all([
          prisma.user.count(),
          prisma.change.count(),
          prisma.incident.count(),
          prisma.accessRequest.count(),
          prisma.approval.count(),
          prisma.auditEvent.count(),
          prisma.agentInvocation.count(),
          prisma.chatMessage.count(),
        ])

      const last24h = daysAgo(1)
      const [recentInvocations, recentAudit, recentChat] = await Promise.all([
        prisma.agentInvocation.count({ where: { createdAt: { gte: last24h } } }),
        prisma.auditEvent.count({ where: { timestamp: { gte: last24h } } }),
        prisma.chatMessage.count({ where: { createdAt: { gte: last24h } } }),
      ])

      return {
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        totals: {
          users: userCount,
          changes: changeCount,
          incidents: incidentCount,
          accessRequests: accessCount,
          approvals: approvalCount,
          auditEvents: auditCount,
          agentInvocations: invCount,
          chatMessages: chatCount,
        },
        last24h: {
          agentInvocations: recentInvocations,
          auditEvents: recentAudit,
          chatMessages: recentChat,
        },
      }
    },
  )
}
