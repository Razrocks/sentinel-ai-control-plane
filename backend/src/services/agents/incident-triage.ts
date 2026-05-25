/**
 * IncidentTriageAgent — autonomous, intake-time triage of an Incident.
 *
 * Pipeline:
 *   1. Load the Incident.
 *   2. Build skill context (T1.d catalog, T5 temporal, T2 deploy/incident history).
 *   3. Run `triage_incident`.
 *   4. Persist:
 *        - Incident.severity if severityChanged + revised severity is higher.
 *        - Incident.likelyIssueType, .rootCauseCategory, .recommendedFix, .kbArticles, .relatedChanges.
 *        - AuditEvent: action="incident_triaged".
 *
 * Trust boundary: agent prepares + persists triage fields; never transitions
 * Incident.status (that is IT-support / engineer's manual call).
 */

import { prisma } from '../../lib/prisma.js'
import { runSkill } from '../skills/index.js'
import type { TriageIncidentInput, TriageIncidentOutput } from '../skills/index.js'
import { createAuditEvent } from '../audit.js'
import { buildBaseContext, loadIncidentT2Extras, loadAuditSlice } from './context.js'
import { gateConfidence } from './confidence.js'
import type { IncidentSeverity } from '@prisma/client'

const SEV_RANK: Record<string, number> = { sev4: 0, sev3: 1, sev2: 2, sev1: 3 }
function maxSev(a: string, b: string): IncidentSeverity {
  return (SEV_RANK[a] >= SEV_RANK[b] ? a : b) as IncidentSeverity
}

export interface TriageIncidentResult {
  incidentId: string
  triage: { status: string; output?: TriageIncidentOutput; errorMessage?: string }
  appliedSeverity: string
  fieldsUpdated: string[]
}

export async function triageIncident(opts: {
  incidentDbId: string
  actor?: string
}): Promise<TriageIncidentResult> {
  const incident = await prisma.incident.findUnique({ where: { id: opts.incidentDbId } })
  if (!incident) throw new Error(`Incident not found: ${opts.incidentDbId}`)

  const actor = opts.actor ?? 'system'
  const ctx = await buildBaseContext({ actor, role: 'it_support', includeRole: false })
  // T2 + T4 in parallel — T4 surfaces prior work-notes, severity changes,
  // and triage actions on this same incident so the model doesn't suggest
  // a fix that was already tried.
  ;[ctx.t2, ctx.t4] = await Promise.all([
    loadIncidentT2Extras(incident.affectedService),
    loadAuditSlice({ objectType: 'incident', objectId: incident.incidentId, limit: 15 }),
  ])

  const input: TriageIncidentInput = {
    incident: {
      id: incident.id,
      incidentId: incident.incidentId,
      title: incident.title,
      description: incident.description,
      requester: incident.requester,
      affectedService: incident.affectedService,
      severity: incident.severity,
      assignmentGroup: incident.assignmentGroup,
      relatedCI: incident.relatedCI,
      isRecurring: incident.isRecurring,
    },
    recentDeploysOnService: ctx.t2.recentDeploysOnService,
    recentIncidentsOnService: ctx.t2.recentIncidentsOnService,
  }

  const triage = await runSkill<TriageIncidentInput, TriageIncidentOutput>(
    'triage_incident',
    input,
    ctx,
    { actor },
  )

  const fieldsUpdated: string[] = []
  let appliedSeverity: IncidentSeverity = incident.severity

  if (triage.status === 'success' && triage.output) {
    const t = triage.output
    const gate = gateConfidence('triage_incident', t.confidence)

    if (gate.verdict === 'skip') {
      // Low confidence — don't persist fields, but audit the suggestion.
      await createAuditEvent({
        actor,
        action: 'incident_triaged',
        objectType: 'incident',
        objectId: incident.id,
        objectTitle: `${incident.incidentId}: ${incident.title}`,
        result: 'escalated',
        details: `Triage SKIPPED: ${gate.note}. Suggested severity=${t.severity}, root=${t.rootCauseCategory}. Manual review recommended.`,
      })
    } else {
      appliedSeverity = maxSev(incident.severity, t.severity)
      const updateData: Parameters<typeof prisma.incident.update>[0]['data'] = {}

      if (appliedSeverity !== incident.severity) {
        updateData.severity = appliedSeverity
        fieldsUpdated.push('severity')
      }
      if (t.likelyIssueType !== incident.likelyIssueType) {
        updateData.likelyIssueType = t.likelyIssueType
        fieldsUpdated.push('likelyIssueType')
      }
      if (t.rootCauseCategory !== incident.rootCauseCategory) {
        updateData.rootCauseCategory = t.rootCauseCategory
        fieldsUpdated.push('rootCauseCategory')
      }
      if (t.recommendedFix !== incident.recommendedFix) {
        updateData.recommendedFix = t.recommendedFix
        fieldsUpdated.push('recommendedFix')
      }
      const newKb = t.kbArticles.map((k) => k.id)
      if (newKb.join(',') !== incident.kbArticles.join(',')) {
        updateData.kbArticles = newKb
        fieldsUpdated.push('kbArticles')
      }
      if (t.relatedChanges.join(',') !== incident.relatedChanges.join(',')) {
        updateData.relatedChanges = t.relatedChanges
        fieldsUpdated.push('relatedChanges')
      }
      if (t.isRecurring !== incident.isRecurring) {
        updateData.isRecurring = t.isRecurring
        fieldsUpdated.push('isRecurring')
      }

      if (Object.keys(updateData).length > 0) {
        await prisma.incident.update({ where: { id: incident.id }, data: updateData })
      }

      const warnPrefix = gate.verdict === 'persist_with_warning' ? `[LOW CONFIDENCE — ${gate.note}] ` : ''
      await createAuditEvent({
        actor,
        action: 'incident_triaged',
        objectType: 'incident',
        objectId: incident.id,
        objectTitle: `${incident.incidentId}: ${incident.title}`,
        result: 'success',
        details: `${warnPrefix}severity=${t.severity} (applied=${appliedSeverity}, confidence=${gate.confidence.toFixed(2)}), root=${t.rootCauseCategory}, related=${t.relatedChanges.length}`,
      })
    }
  } else {
    await createAuditEvent({
      actor,
      action: 'incident_triaged',
      objectType: 'incident',
      objectId: incident.id,
      objectTitle: `${incident.incidentId}: ${incident.title}`,
      result: 'blocked',
      details: `triage_incident failed: ${triage.errorMessage ?? 'unknown error'}`,
    })
  }

  return {
    incidentId: incident.incidentId,
    triage: {
      status: triage.status,
      output: triage.output,
      errorMessage: triage.errorMessage,
    },
    appliedSeverity,
    fieldsUpdated,
  }
}
