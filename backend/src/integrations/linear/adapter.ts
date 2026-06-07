/**
 * LinearAdapter — implements IntegrationAdapter for Linear.
 *
 * Auth: personal API key (`lin_api_...`) or OAuth bearer token.
 * Webhook: workspace-scoped, resourceTypes = Issue, Comment, IssueLabel.
 * Each event carries the team in `data.team.id` so the wizard's selected
 * teams act as a server-side filter.
 *
 * Phase 3.3 scope:
 *   - Issue created/updated → ExternalRef + audit row + best-effort link
 *     to a Sentinel Change when the issue title carries a "CHG-NNNN" tag
 *     or links to a known Change ticketId.
 *   - Comment created → audit row (light touch; we don't mirror comments
 *     to keep the audit log readable).
 *   - Outbound notifications (e.g. post a comment on the linked ticket
 *     when its Change deploys) ship in Phase 3.3b.
 */

import { randomBytes } from 'node:crypto'
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
import { viewer, listTeams, createWebhook, deleteWebhook, LinearApiError } from './client.js'
import { prisma } from '../../lib/prisma.js'

function errorToTestResult(err: unknown): ConnectionTestResult {
  if (err instanceof LinearApiError) {
    if (err.httpStatus === 401 || /authentication/i.test(err.message)) {
      return { ok: false, errorMessage: 'Linear rejected the API key. Generate a fresh one in Settings → API.' }
    }
    return { ok: false, errorMessage: `Linear API: ${err.message}` }
  }
  return { ok: false, errorMessage: err instanceof Error ? err.message : String(err) }
}

/**
 * Pull "CHG-NNNN" hints out of an issue title or description so we can
 * cross-link the Linear issue to a Sentinel Change without the operator
 * having to do anything.
 */
function extractChangeTicketIds(title: string, description: string | null): string[] {
  const text = `${title}\n${description ?? ''}`
  const matches = text.match(/CHG-\d{4,}/g) ?? []
  return Array.from(new Set(matches))
}

export const linearAdapter: IntegrationAdapter = {
  type: 'linear',

  async testConnection(credential: string): Promise<ConnectionTestResult> {
    try {
      const v = await viewer(credential)
      return {
        ok: true,
        identity: `${v.organization.name} as ${v.name}`,
      }
    } catch (err) {
      return errorToTestResult(err)
    }
  },

  async listScopes(_integration: Integration, credential: string): Promise<ScopeOption[]> {
    const teams = await listTeams(credential)
    return teams.map((t) => ({
      id: t.id,
      label: `${t.key} — ${t.name}`,
      meta: { key: t.key },
    }))
  },

  async registerWebhook(
    _integration: Integration,
    credential: string,
    deliveryUrl: string,
    scopeId: string,
  ): Promise<WebhookRegistration> {
    // One Linear webhook per selected team. scopeId IS the team id the
    // wizard returned from listScopes.
    const sharedSecret = randomBytes(32).toString('hex')
    const hook = await createWebhook(credential, deliveryUrl, sharedSecret, scopeId)
    return {
      providerWebhookId: `lin-${scopeId}:${hook.id}`,
      deliveryUrl,
      sharedSecret,
    }
  },

  async unregisterWebhook(
    _integration: Integration,
    credential: string,
    providerWebhookId: string,
  ): Promise<void> {
    // We embedded the Linear webhook id after the colon. If we registered
    // once for many scopes, the same hook id appears under multiple
    // entries — delete will return "not found" for the second call, which
    // the client treats as idempotent success.
    const colon = providerWebhookId.lastIndexOf(':')
    if (colon === -1) return
    const hookId = providerWebhookId.slice(colon + 1)
    if (!hookId) return
    await deleteWebhook(credential, hookId)
  },

  async handleEvent(integration: Integration, event: InboundEvent): Promise<EventResult> {
    // Linear event body shape:
    //   { action, type, data, url, createdAt, organizationId, webhookId, ... }
    const body = event.body as {
      action: string
      type: string
      data?: {
        id?: string
        identifier?: string
        title?: string
        description?: string | null
        team?: { id: string; key: string }
        url?: string
        state?: { name: string; type: string }
      }
    }

    if (!body.data || !body.type) return { result: 'skipped' }

    // Server-side team filter: only act on events from teams the operator
    // selected during the wizard. config.scopes is an array of Linear
    // team IDs. Empty → accept all (degraded mode).
    const cfg = integration.config as { scopes?: string[] } | null
    const allowedTeams = cfg?.scopes ?? []
    if (allowedTeams.length > 0 && body.data.team && !allowedTeams.includes(body.data.team.id)) {
      return { result: 'skipped' }
    }

    switch (body.type) {
      case 'Issue':
        return handleIssue(integration, body)
      case 'Comment':
        return handleComment(integration, body)
      default:
        return { result: 'skipped' }
    }
  },
}

// ─── Issue handler ──────────────────────────────────────

async function handleIssue(
  integration: Integration,
  body: {
    action: string
    data?: {
      id?: string
      identifier?: string
      title?: string
      description?: string | null
      team?: { id: string; key: string }
      url?: string
      state?: { name: string; type: string }
    }
  },
): Promise<EventResult> {
  const data = body.data
  if (!data?.id || !data.identifier) return { result: 'skipped' }

  // Mirror the issue into ExternalRef so the UI can show "this Change is
  // tracked by ENG-123" without round-tripping to Linear on every read.
  await prisma.externalRef.upsert({
    where: {
      integrationId_externalKind_externalId: {
        integrationId: integration.id,
        externalKind: 'linear_issue',
        externalId: data.identifier,
      },
    },
    create: {
      integrationId: integration.id,
      // We don't always have a Sentinel object yet — point at the issue
      // itself for now; the link gets rewritten if we later match a Change.
      sentinelType: 'change',
      sentinelId: '__unlinked__',
      externalKind: 'linear_issue',
      externalId: data.identifier,
      externalUrl: data.url ?? null,
      meta: {
        title: data.title ?? '',
        state: data.state?.name ?? null,
        teamKey: data.team?.key ?? null,
      },
    },
    update: {
      externalUrl: data.url ?? null,
      meta: {
        title: data.title ?? '',
        state: data.state?.name ?? null,
        teamKey: data.team?.key ?? null,
      },
    },
  })

  // If the issue title carries a CHG-NNNN reference, link the ref to that
  // Change. Multiple matches → attach the ref to the first one we find.
  const chgIds = extractChangeTicketIds(data.title ?? '', data.description ?? null)
  if (chgIds.length > 0) {
    const change = await prisma.change.findFirst({ where: { ticketId: { in: chgIds } } })
    if (change) {
      await prisma.externalRef.update({
        where: {
          integrationId_externalKind_externalId: {
            integrationId: integration.id,
            externalKind: 'linear_issue',
            externalId: data.identifier,
          },
        },
        data: { sentinelId: change.id },
      })
      await prisma.auditEvent.create({
        data: {
          timestamp: new Date(),
          actor: `linear:${integration.displayName}`,
          action: `linear_issue_${body.action}`,
          objectType: 'change',
          objectId: change.ticketId,
          objectTitle: change.title,
          result: 'success',
          policyRule: null,
          changeId: change.id,
          details: `Linear ${data.identifier}: ${data.title ?? ''}`.slice(0, 500),
        },
      })
      return { result: 'processed', sentinelObjectId: change.id, sentinelObjectType: 'change' }
    }
  }

  return { result: 'processed' }
}

// ─── Comment handler ────────────────────────────────────

async function handleComment(
  integration: Integration,
  body: {
    action: string
    data?: { id?: string; team?: { id: string; key: string } }
  },
): Promise<EventResult> {
  // Light touch — record the bare fact. Comment bodies often include
  // boilerplate that would balloon the audit table.
  await prisma.auditEvent.create({
    data: {
      timestamp: new Date(),
      actor: `linear:${integration.displayName}`,
      action: `linear_comment_${body.action}`,
      objectType: 'change',
      objectId: body.data?.id ?? 'linear',
      objectTitle: 'Linear comment',
      result: 'success',
      policyRule: null,
      details: `team=${body.data?.team?.key ?? '?'}`,
    },
  })
  return { result: 'processed' }
}

registerAdapter(linearAdapter)
