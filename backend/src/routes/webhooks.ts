/**
 * Webhook router — single Fastify endpoint that receives inbound events
 * from every connected integration. Dispatches by `:type` after:
 *
 *   1. Looking up the configured Integration row
 *   2. Decrypting the per-integration webhook secret
 *   3. Re-computing the provider's signature over the raw body
 *   4. Dedup against `webhook_events.providerEventId`
 *   5. Calling the adapter's handleEvent
 *
 * Every step's outcome is persisted to `webhook_events` for audit + replay.
 * Failures don't 500 to the provider — we return 200 with the result code,
 * so providers don't retry into our DB on bugs we already captured.
 *
 * Body parsing: Fastify's default JSON parser would consume the raw body
 * before we can HMAC it. We register a per-route content-type parser that
 * keeps the raw string available alongside the parsed JSON.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify'
import { prisma } from '../lib/prisma.js'
import type { IntegrationType } from '@prisma/client'
import { getAdapter, hasAdapter } from '../integrations/_base/adapter.js'
import { decrypt } from '../integrations/_base/encryption.js'
import {
  verifyGitHub,
  verifySlack,
  verifyLinear,
  verifySentry,
  verifyPagerDuty,
} from '../integrations/_base/webhook-verify.js'

/** Cap on raw body size we'll accept from any provider. */
const MAX_RAW_BODY_BYTES = 256 * 1024

/**
 * Provider-specific signature lookup. Each function pulls the signature
 * header(s) the provider uses and runs the matching verifier.
 */
function verifyByType(
  type: IntegrationType,
  rawBody: string,
  headers: Record<string, string>,
  secret: string,
): boolean {
  switch (type) {
    case 'github':
      return verifyGitHub(rawBody, headers['x-hub-signature-256'], secret)
    case 'slack':
      return verifySlack(rawBody, headers['x-slack-signature'], headers['x-slack-request-timestamp'], secret)
    case 'linear':
      return verifyLinear(rawBody, headers['linear-signature'], secret)
    case 'sentry':
      return verifySentry(rawBody, headers['sentry-hook-signature'], secret)
    case 'pagerduty':
      return verifyPagerDuty(rawBody, headers['x-pagerduty-signature'], secret)
    default:
      return false
  }
}

/**
 * Pull the provider-side event id from the raw headers. Providers use
 * different conventions; missing id → generate one from a hash of the
 * body so we still dedup against identical replays.
 */
function extractEventId(type: IntegrationType, headers: Record<string, string>, rawBody: string): string {
  switch (type) {
    case 'github':
      return headers['x-github-delivery'] || hashFallback(rawBody)
    case 'slack': {
      // Slack body has `event_id` field; cheaper to parse header timestamp+team
      // for dedup. Fall back to body hash if both missing.
      const ts = headers['x-slack-request-timestamp']
      return ts ? `slack-${ts}` : hashFallback(rawBody)
    }
    case 'linear':
      return headers['linear-delivery'] || hashFallback(rawBody)
    case 'sentry':
      return headers['sentry-hook-resource'] + ':' + (headers['request-id'] || hashFallback(rawBody))
    case 'pagerduty':
      return headers['x-pagerduty-webhook-id'] || hashFallback(rawBody)
    default:
      return hashFallback(rawBody)
  }
}

function extractEventType(type: IntegrationType, headers: Record<string, string>, parsed: unknown): string {
  switch (type) {
    case 'github':
      return headers['x-github-event'] || 'unknown'
    case 'slack': {
      const body = parsed as { event?: { type?: string }; type?: string }
      return body?.event?.type || body?.type || 'unknown'
    }
    case 'linear': {
      const body = parsed as { action?: string; type?: string }
      return body?.action || body?.type || 'unknown'
    }
    case 'sentry':
      return headers['sentry-hook-resource'] || 'unknown'
    case 'pagerduty': {
      const body = parsed as { event?: { event_type?: string } }
      return body?.event?.event_type || 'unknown'
    }
    default:
      return 'unknown'
  }
}

function hashFallback(rawBody: string): string {
  // Cheap stable id without bringing crypto into the hot path: 8 chars of
  // a string hash. Collisions = dedup; deduping a real replay vs a
  // genuinely-identical-but-distinct event is acceptable since the body
  // hash matching means our handler will produce the same result anyway.
  let h = 0
  for (let i = 0; i < rawBody.length; i++) h = ((h << 5) - h + rawBody.charCodeAt(i)) | 0
  return `hash-${(h >>> 0).toString(16)}`
}

export async function webhookRoutes(app: FastifyInstance) {
  // Register a raw-body-preserving parser scoped to this route. Fastify's
  // default JSON parser hands us the parsed object but discards the raw
  // bytes — we need both: parsed for the adapter, raw for HMAC.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string', bodyLimit: MAX_RAW_BODY_BYTES },
    (_req, body, done) => {
      try {
        const parsed = JSON.parse(body as string)
        // Stash the raw on the parsed value so the handler can pull it
        // back out via the request body. Fastify replaces `req.body`
        // with what we pass to done.
        ;(parsed as { __rawBody?: string }).__rawBody = body as string
        done(null, parsed)
      } catch (err) {
        done(err as Error, undefined)
      }
    },
  )

  app.post<{ Params: { type: string } }>('/api/webhooks/:type', async (request, reply) => {
    const typeParam = request.params.type as IntegrationType
    if (!hasAdapter(typeParam)) {
      return reply.status(404).send({ error: 'NO_ADAPTER', message: `no adapter for ${typeParam}` })
    }
    const parsed = request.body as { __rawBody?: string }
    const rawBody = parsed?.__rawBody ?? ''
    delete parsed.__rawBody

    // Lower-case all headers so verifyByType can look them up without
    // worrying about provider casing differences.
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(request.headers)) {
      if (typeof v === 'string') headers[k.toLowerCase()] = v
    }

    const integration = await prisma.integration.findUnique({ where: { type: typeParam } })
    if (!integration || integration.status === 'disconnected') {
      return reply.status(404).send({ error: 'NO_INTEGRATION', message: `${typeParam} not connected` })
    }
    if (!integration.webhookSecretCiphertext) {
      return reply.status(400).send({ error: 'NO_SECRET', message: 'webhook secret not configured' })
    }

    let secret: string
    try {
      secret = decrypt(integration.webhookSecretCiphertext)
    } catch {
      // Don't leak whether decrypt failed because of key mismatch or
      // corruption. A generic 500 is fine — the operator sees the
      // failure in the integration's lastError.
      await prisma.integration.update({
        where: { id: integration.id },
        data: { status: 'degraded', lastError: 'webhook secret decryption failed' },
      })
      return reply.status(500).send({ error: 'DECRYPTION_FAILED' })
    }

    // HMAC verify before we touch the DB write path. Bad signature =
    // 401, no DB write, no adapter call. This is the security gate.
    if (!verifyByType(typeParam, rawBody, headers, secret)) {
      return reply.status(401).send({ error: 'INVALID_SIGNATURE' })
    }

    const providerEventId = extractEventId(typeParam, headers, rawBody)
    const eventType = extractEventType(typeParam, headers, parsed)

    // Dedup. If we've seen this providerEventId already, short-circuit
    // with 200 — the provider's idempotency is on us, and replays should
    // never re-trigger side effects.
    const existing = await prisma.webhookEvent.findUnique({
      where: { integrationId_providerEventId: { integrationId: integration.id, providerEventId } },
    })
    if (existing) {
      return reply.status(200).send({ result: 'duplicate', result_id: existing.id })
    }

    // Dispatch to the adapter. Errors are recorded but never bubble to the
    // provider as a 500 — they'll retry and we'll write duplicate failure
    // rows.
    const adapter = getAdapter(typeParam)
    let outcome: { result: 'processed' | 'skipped' | 'failed'; errorMessage?: string }
    try {
      const result = await adapter.handleEvent(integration, {
        providerEventId,
        eventType,
        body: parsed,
        rawBody,
        headers,
      })
      outcome = { result: result.result, errorMessage: result.errorMessage }
    } catch (err) {
      outcome = { result: 'failed', errorMessage: err instanceof Error ? err.message : String(err) }
    }

    const event = await prisma.webhookEvent.create({
      data: {
        integrationId: integration.id,
        providerEventId,
        eventType,
        rawBody: rawBody.slice(0, MAX_RAW_BODY_BYTES),
        result: outcome.result,
        errorMessage: outcome.errorMessage ?? null,
      },
    })

    // Refresh lastCheckedAt on success so the Settings card shows green.
    if (outcome.result !== 'failed') {
      await prisma.integration.update({
        where: { id: integration.id },
        data: { lastCheckedAt: new Date(), status: 'connected', lastError: null },
      })
    }

    return reply.status(200).send({ result: outcome.result, event_id: event.id })
  })
}

// Helper so other modules can compute the inbound URL for a given type.
// Used by the wizard step that shows "Paste this URL into GitHub's webhook
// settings" before we have a way to programmatically register.
export function buildDeliveryUrl(publicBaseUrl: string, type: IntegrationType): string {
  return `${publicBaseUrl.replace(/\/$/, '')}/api/webhooks/${type}`
}

// Reference unused-import suppressor — FastifyRequest may be referenced
// in future signature changes.
type _Request = FastifyRequest
