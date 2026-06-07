/**
 * SentryAdapter — implements IntegrationAdapter for Sentry.
 *
 * Auth model: an "Internal Integration" mints:
 *   - Auth Token (`sntrys_...`)  → credential, used for read API
 *   - Client Secret              → webhookSecret, used to verify inbound
 *     `Sentry-Hook-Signature` HMAC headers.
 *
 * Sentry's webhook delivery URL is configured on the Internal Integration
 * settings page — there is no programmatic way to register it from our
 * side. `registerWebhook` is a no-op success, and the wizard's step 3 tells
 * the operator to paste the URL into Sentry.
 *
 * Phase 3.4 scope:
 *   - issue.created  → upsert Sentinel Incident (severity from level)
 *   - issue.resolved → mark Incident resolved
 *   - issue.ignored  → audit row, no state change
 *   - error events   → ignored (high-volume; Sentry's own grouping is
 *     the right place to aggregate before we get involved)
 */

import type { Integration } from '@prisma/client'
import {
  type IntegrationAdapter,
  type ConnectionTestResult,
  type ScopeOption,
  type WebhookRegistration,
  type InboundEvent,
  type EventResult,
  registerAdapter,
} from '../_base/adapter.js'
import { identifyOrg, listAllProjects, SentryApiError } from './client.js'
import { prisma } from '../../lib/prisma.js'
import type { IncidentSeverity } from '@prisma/client'

function errorToTestResult(err: unknown): ConnectionTestResult {
  if (err instanceof SentryApiError) {
    if (err.httpStatus === 401 || err.httpStatus === 403) {
      return {
        ok: false,
        errorMessage:
          'Sentry rejected the auth token. Confirm the Internal Integration token has org:read + project:read scopes.',
      }
    }
    return { ok: false, errorMessage: `Sentry API: ${err.message}` }
  }
  return { ok: false, errorMessage: err instanceof Error ? err.message : String(err) }
}

/**
 * Sentry's level → Sentinel's IncidentSeverity. Conservative mapping:
 * default to sev3 for anything we don't recognise so the on-call still
 * gets a row, just not a page.
 */
function levelToSeverity(level: string | undefined): IncidentSeverity {
  switch (level) {
    case 'fatal':
      return 'sev1'
    case 'error':
      return 'sev2'
    case 'warning':
      return 'sev3'
    case 'info':
    case 'debug':
      return 'sev4'
    default:
      return 'sev3'
  }
}

export const sentryAdapter: IntegrationAdapter = {
  type: 'sentry',

  async testConnection(credential: string): Promise<ConnectionTestResult> {
    try {
      const org = await identifyOrg(credential)
      if (!org) {
        return {
          ok: false,
          errorMessage:
            'Token authenticated but no projects visible. Check the Internal Integration has Project:Read permission.',
        }
      }
      return { ok: true, identity: org.name }
    } catch (err) {
      return errorToTestResult(err)
    }
  },

  async listScopes(_integration: Integration, credential: string): Promise<ScopeOption[]> {
    const projects = await listAllProjects(credential)
    return projects.map((p) => ({
      id: p.slug,
      label: `${p.organization.slug}/${p.slug}`,
      meta: { name: p.name, orgSlug: p.organization.slug },
    }))
  },

  async registerWebhook(
    integration: Integration,
    _credential: string,
    deliveryUrl: string,
    scopeId: string,
  ): Promise<WebhookRegistration> {
    if (!integration.webhookSecretCiphertext) {
      throw new Error(
        'Sentry Client Secret not provided. The connect step must include it as the webhook secret so we can verify inbound HMAC.',
      )
    }
    // No API to register from our side — the operator pastes the
    // delivery URL into the Internal Integration config in Sentry.
    return {
      providerWebhookId: `sentry-project-${scopeId}`,
      deliveryUrl,
      sharedSecret: '__already-stored__',
    }
  },

  async unregisterWebhook(): Promise<void> {
    // Nothing to call on Sentry side; operator clears the webhook URL
    // manually when they disconnect.
  },

  async handleEvent(integration: Integration, event: InboundEvent): Promise<EventResult> {
    const action = event.eventType // already pulled from Sentry-Hook-Resource by router

    // Sentry envelopes look like:
    //   { action, data: { issue: {...} | event: {...} }, actor, installation }
    const body = event.body as {
      action?: string
      data?: {
        issue?: SentryIssuePayload
        event?: { issue_id?: string; level?: string }
      }
      actor?: { name?: string; type?: string }
    }

    // We only care about issue lifecycle.
    if (!body.data?.issue) {
      return { result: 'skipped' }
    }
    const issue = body.data.issue

    // Project-level filter — if the operator only picked some projects,
    // ignore issues from elsewhere.
    const cfg = integration.config as { scopes?: string[] } | null
    const allowedProjects = cfg?.scopes ?? []
    if (allowedProjects.length > 0 && issue.project?.slug && !allowedProjects.includes(issue.project.slug)) {
      return { result: 'skipped' }
    }

    switch (body.action) {
      case 'created':
      case 'unresolved':
        // Both create a Sentinel Incident if one doesn't exist. Unresolved
        // covers the case where Sentry sent an existing issue's wake-up
        // before we had the webhook live, so the initial `created` event
        // never reached us.
        return upsertIncidentFromIssue(integration, issue, body.action)
      case 'resolved':
        return resolveIncidentForIssue(integration, issue)
      case 'ignored':
      case 'archived':
        // Lifecycle audit row; we don't auto-close incidents on these.
        await prisma.auditEvent.create({
          data: {
            timestamp: new Date(),
            actor: `sentry:${integration.displayName}`,
            action: `sentry_issue_${body.action}`,
            objectType: 'incident',
            objectId: issue.shortId ?? issue.id,
            objectTitle: issue.title,
            result: 'success',
            policyRule: null,
            details: `level=${issue.level ?? '?'} project=${issue.project?.slug ?? '?'}`,
          },
        })
        return { result: 'processed' }
      default:
        return { result: 'skipped' }
    }
  },
}

// ─── Issue payload (Sentry shape) ────────────────────────

interface SentryIssuePayload {
  id: string
  shortId: string
  title: string
  culprit?: string
  level?: string
  status?: string
  permalink?: string
  project?: { slug: string; name: string }
}

// ─── Incident upsert ────────────────────────────────────

async function upsertIncidentFromIssue(
  integration: Integration,
  issue: SentryIssuePayload,
  action: string,
): Promise<EventResult> {
  const incidentId = `SEN-${issue.shortId ?? issue.id}`
  const severity = levelToSeverity(issue.level)
  const affectedService = issue.project?.slug ?? 'unknown'

  const existing = await prisma.incident.findUnique({ where: { incidentId } })

  let incident
  if (existing) {
    incident = await prisma.incident.update({
      where: { incidentId },
      data: {
        title: issue.title,
        severity,
        affectedService,
      },
    })
  } else {
    incident = await prisma.incident.create({
      data: {
        incidentId,
        title: issue.title,
        description: issue.culprit ?? issue.title,
        requester: `sentry:${integration.displayName}`,
        affectedService,
        severity,
        status: 'investigating',
        assignmentGroup: affectedService,
        relatedCI: [affectedService],
        isRecurring: false,
        // Defaults — the incident-triage agent will refine these on first run.
        likelyIssueType: issue.level ?? 'unclassified',
        rootCauseCategory: 'unknown',
        recommendedFix: 'Pending Sentinel triage.',
      },
    })
  }

  // Cross-link
  await prisma.externalRef.upsert({
    where: {
      integrationId_externalKind_externalId: {
        integrationId: integration.id,
        externalKind: 'sentry_issue',
        externalId: issue.shortId ?? issue.id,
      },
    },
    create: {
      integrationId: integration.id,
      sentinelType: 'incident',
      sentinelId: incident.id,
      externalKind: 'sentry_issue',
      externalId: issue.shortId ?? issue.id,
      externalUrl: issue.permalink ?? null,
      meta: {
        level: issue.level ?? null,
        project: issue.project?.slug ?? null,
      },
    },
    update: {
      externalUrl: issue.permalink ?? null,
      meta: {
        level: issue.level ?? null,
        project: issue.project?.slug ?? null,
      },
    },
  })

  await prisma.auditEvent.create({
    data: {
      timestamp: new Date(),
      actor: `sentry:${integration.displayName}`,
      action: `sentry_issue_${action}`,
      objectType: 'incident',
      objectId: incident.incidentId,
      objectTitle: incident.title,
      result: 'success',
      policyRule: null,
      details: `level=${issue.level ?? '?'} severity=${severity}`,
    },
  })

  return { result: 'processed', sentinelObjectId: incident.id, sentinelObjectType: 'incident' }
}

async function resolveIncidentForIssue(
  integration: Integration,
  issue: SentryIssuePayload,
): Promise<EventResult> {
  const ref = await prisma.externalRef.findFirst({
    where: {
      integrationId: integration.id,
      externalKind: 'sentry_issue',
      externalId: issue.shortId ?? issue.id,
    },
  })
  if (!ref) return { result: 'skipped' }
  const incident = await prisma.incident.findUnique({ where: { id: ref.sentinelId } })
  if (!incident) return { result: 'skipped' }

  await prisma.incident.update({
    where: { id: incident.id },
    data: { status: 'resolved' },
  })

  await prisma.auditEvent.create({
    data: {
      timestamp: new Date(),
      actor: `sentry:${integration.displayName}`,
      action: 'sentry_issue_resolved',
      objectType: 'incident',
      objectId: incident.incidentId,
      objectTitle: incident.title,
      result: 'success',
      policyRule: null,
      details: `resolved via Sentry`,
    },
  })

  return { result: 'processed', sentinelObjectId: incident.id, sentinelObjectType: 'incident' }
}

registerAdapter(sentryAdapter)
