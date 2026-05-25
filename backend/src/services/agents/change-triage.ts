/**
 * ChangeTriageAgent — autonomous, intake-time analysis of a Change.
 *
 * Pipeline:
 *   1. Load the Change with relations.
 *   2. Build skill context (T1.b policy, T1.d catalog, T5 temporal, T2 deploy history).
 *   3. Run `assess_change` to revise risk + produce rationale.
 *   4. Discover blast-radius candidates (deterministic seed list from service catalog).
 *   5. Run `analyze_blast_radius` to filter / classify candidates.
 *   6. Persist:
 *        - Change.riskLevel: keep the higher of intake vs assessed (defensive).
 *        - BlastRadiusItem rows: replace existing items with skill output.
 *        - AuditEvent: action="change_assessed".
 *        - AuditEvent: action="blast_radius_computed".
 *
 * Trust boundary: agent prepares + persists advisory data; never approves,
 * executes, or transitions ApprovalState.
 */

import { prisma } from '../../lib/prisma.js'
import { runSkill } from '../skills/index.js'
import type {
  AssessChangeInput,
  AssessChangeOutput,
  AnalyzeBlastRadiusInput,
  AnalyzeBlastRadiusOutput,
} from '../skills/index.js'
import { createAuditEvent } from '../audit.js'
import { buildBaseContext, loadChangeT2Extras } from './context.js'
import { gateConfidence } from './confidence.js'
import type { RiskLevel as PrismaRiskLevel } from '@prisma/client'

// Risk ordering for "keep higher of two"
const RISK_RANK: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 }
function maxRisk(a: string, b: string): PrismaRiskLevel {
  return (RISK_RANK[a] >= RISK_RANK[b] ? a : b) as PrismaRiskLevel
}

export interface TriageChangeResult {
  changeId: string
  ticketId: string
  assess: { status: string; output?: AssessChangeOutput; errorMessage?: string }
  blastRadius: { status: string; output?: AnalyzeBlastRadiusOutput; errorMessage?: string }
  appliedRiskLevel: string
  blastRadiusItemsWritten: number
}

export async function triageChange(opts: {
  changeId: string
  actor?: string
}): Promise<TriageChangeResult> {
  const change = await prisma.change.findUnique({
    where: { id: opts.changeId },
    include: { blastRadius: true },
  })
  if (!change) throw new Error(`Change not found: ${opts.changeId}`)

  const actor = opts.actor ?? 'system'
  const ctx = await buildBaseContext({ actor, role: 'operator' })
  ctx.t2 = await loadChangeT2Extras(change.service)

  // ── 1. assess_change ──────────────────────────────────
  const assessInput: AssessChangeInput = {
    change: {
      id: change.id,
      ticketId: change.ticketId,
      title: change.title,
      description: change.description,
      owner: change.owner,
      ownerTeam: change.ownerTeam,
      service: change.service,
      environment: change.environment,
      riskLevel: change.riskLevel,
      linkedPRs: change.linkedPRs,
      ciStatus: change.ciStatus,
      maintenanceWindow: change.maintenanceWindow,
      maintenanceWindowStart: change.maintenanceWindowStart?.toISOString() ?? null,
      maintenanceWindowEnd: change.maintenanceWindowEnd?.toISOString() ?? null,
      rollbackPlan: change.rollbackPlan,
    },
    recentDeploysOnService: ctx.t2.recentDeploysOnService?.map((d) => ({
      ticketId: d.ticketId,
      deployedAt: d.deployedAt,
      result: d.result === 'success' ? 'success' : 'rolled_back',
    })),
  }

  const assess = await runSkill<AssessChangeInput, AssessChangeOutput>(
    'assess_change',
    assessInput,
    ctx,
    { actor },
  )

  let appliedRisk: PrismaRiskLevel = change.riskLevel
  if (assess.status === 'success' && assess.output) {
    const gate = gateConfidence('assess_change', assess.output.confidence)

    if (gate.verdict === 'skip') {
      // Low confidence — do NOT persist, but audit the attempt for visibility.
      await createAuditEvent({
        actor,
        action: 'change_assessed',
        objectType: 'change',
        objectId: change.id,
        objectTitle: `${change.ticketId}: ${change.title}`,
        result: 'escalated',
        details: `Assessment SKIPPED: ${gate.note}. Suggested risk=${assess.output.riskLevel}. Manual review recommended. Rationale: ${assess.output.riskRationale}`,
        changeId: change.id,
      })
    } else {
      // Persist (with or without warning). Apply defensive "keep higher" rule.
      appliedRisk = maxRisk(change.riskLevel, assess.output.riskLevel)
      if (appliedRisk !== change.riskLevel) {
        await prisma.change.update({
          where: { id: change.id },
          data: { riskLevel: appliedRisk },
        })
      }
      const warnPrefix = gate.verdict === 'persist_with_warning' ? `[LOW CONFIDENCE — ${gate.note}] ` : ''
      await createAuditEvent({
        actor,
        action: 'change_assessed',
        objectType: 'change',
        objectId: change.id,
        objectTitle: `${change.ticketId}: ${change.title}`,
        result: 'success',
        details: `${warnPrefix}Assessed risk=${assess.output.riskLevel} (applied=${appliedRisk}, confidence=${gate.confidence.toFixed(2)}). ${assess.output.riskRationale}`,
        changeId: change.id,
      })
    }
  } else {
    await createAuditEvent({
      actor,
      action: 'change_assessed',
      objectType: 'change',
      objectId: change.id,
      objectTitle: `${change.ticketId}: ${change.title}`,
      result: 'blocked',
      details: `assess_change failed: ${assess.errorMessage ?? 'unknown error'}`,
      changeId: change.id,
    })
  }

  // ── 2. analyze_blast_radius ───────────────────────────
  // Discovery: seed candidates from the service catalog + existing rows.
  const orgCatalog = ctx.t1?.orgCatalog
  const downstream = orgCatalog?.services[change.service]?.downstream ?? []

  const seedCandidates: AnalyzeBlastRadiusInput['candidates'] = [
    {
      name: change.service,
      type: 'service',
      sourceOfDiscovery: 'service_catalog',
      rawSignal: 'primary target',
    },
    ...downstream.map((name) => ({
      name,
      type: 'service' as const,
      sourceOfDiscovery: 'service_catalog' as const,
      rawSignal: 'declared downstream',
    })),
    ...change.blastRadius.map((b) => ({
      name: b.name,
      type: b.type,
      sourceOfDiscovery: 'recent_audit' as const,
      rawSignal: b.reason,
    })),
  ]

  // Dedup by name
  const dedupMap = new Map<string, (typeof seedCandidates)[number]>()
  for (const c of seedCandidates) if (!dedupMap.has(c.name)) dedupMap.set(c.name, c)
  const candidates = Array.from(dedupMap.values())

  const serviceCatalogSnippet: AnalyzeBlastRadiusInput['serviceCatalogSnippet'] = {}
  if (orgCatalog) {
    for (const c of candidates) {
      const s = orgCatalog.services[c.name]
      if (s) {
        serviceCatalogSnippet[c.name] = {
          team: s.team,
          criticality: s.criticality,
          downstream: s.downstream,
        }
      }
    }
  }

  const blastInput: AnalyzeBlastRadiusInput = {
    change: {
      id: change.id,
      ticketId: change.ticketId,
      title: change.title,
      description: change.description,
      service: change.service,
      environment: change.environment,
      linkedPRs: change.linkedPRs,
    },
    candidates,
    serviceCatalogSnippet,
  }

  const blast = await runSkill<AnalyzeBlastRadiusInput, AnalyzeBlastRadiusOutput>(
    'analyze_blast_radius',
    blastInput,
    ctx,
    { actor },
  )

  let blastRadiusItemsWritten = 0
  if (blast.status === 'success' && blast.output) {
    // B3: atomically replace blast radius rows. If createMany crashes after
    // delete, change loses all blast radius data with no recovery — wrap both
    // in a transaction so either both succeed or both roll back.
    const items = blast.output.items
    blastRadiusItemsWritten = await prisma.$transaction(async (tx) => {
      await tx.blastRadiusItem.deleteMany({ where: { changeId: change.id } })
      if (items.length === 0) return 0
      await tx.blastRadiusItem.createMany({
        data: items.map((it) => ({
          changeId: change.id,
          name: it.name,
          type: it.type,
          reason: it.reason,
          confidence: it.confidence,
          criticality: it.criticality,
          ownerTeam: it.ownerTeam,
          details: it.details,
        })),
      })
      return items.length
    })
    await createAuditEvent({
      actor,
      action: 'blast_radius_computed',
      objectType: 'change',
      objectId: change.id,
      objectTitle: `${change.ticketId}: ${change.title}`,
      result: 'success',
      details: `${blast.output.items.length} affected, ${blast.output.excluded.length} excluded.`,
      changeId: change.id,
    })
  } else {
    await createAuditEvent({
      actor,
      action: 'blast_radius_computed',
      objectType: 'change',
      objectId: change.id,
      objectTitle: `${change.ticketId}: ${change.title}`,
      result: 'blocked',
      details: `analyze_blast_radius failed: ${blast.errorMessage ?? 'unknown error'}`,
      changeId: change.id,
    })
  }

  return {
    changeId: change.id,
    ticketId: change.ticketId,
    assess: {
      status: assess.status,
      output: assess.output,
      errorMessage: assess.errorMessage,
    },
    blastRadius: {
      status: blast.status,
      output: blast.output,
      errorMessage: blast.errorMessage,
    },
    appliedRiskLevel: appliedRisk,
    blastRadiusItemsWritten,
  }
}
