/**
 * B1: Idempotency middleware.
 *
 * For mutating endpoints (POST/PATCH/DELETE), clients may send an
 * `Idempotency-Key` header. On first request we record the response; on
 * any repeat with the same (userId, key) within the retention window, we
 * return the cached response WITHOUT re-executing the action.
 *
 * Guards against:
 *   - Double-clicks (user impatience)
 *   - Network retries by the client
 *   - Browser back/refresh after submit
 *
 * Key shape: client-supplied UUID or stable string. Server hashes
 * (method + path + body) into request_hash so the same key reused for a
 * different action returns 422 (client bug detection).
 *
 * Usage: wire as preHandler on mutating routes. Caller picks which routes
 * need it (action endpoints definitely; admin endpoints optional).
 */

import { createHash } from 'node:crypto'
import type { FastifyRequest, FastifyReply } from 'fastify'
import { prisma } from '../lib/prisma.js'

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by idempotency middleware when a cached response is returned. */
    idempotencyHit?: boolean
  }
}

const RETENTION_MS = 24 * 60 * 60 * 1000 // 24h — long enough for any reasonable retry

function hashRequest(method: string, path: string, body: unknown): string {
  const bodyStr = body === undefined ? '' : JSON.stringify(body)
  return createHash('sha256').update(`${method}\n${path}\n${bodyStr}`).digest('hex')
}

/**
 * preHandler that intercepts the request if a matching idempotency record
 * exists. Otherwise, falls through and an onSend hook records the response.
 *
 * Bind via: { preHandler: [requireAuth, idempotency], ... }
 * Requires requireAuth to populate request.user.
 */
export async function idempotency(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  // Skip if no key header — endpoint stays non-idempotent for that call.
  const key = request.headers['idempotency-key']
  if (!key || typeof key !== 'string' || key.length === 0) return
  if (key.length > 200) {
    reply.status(400).send({ error: 'VALIDATION_ERROR', message: 'Idempotency-Key too long (max 200 chars)' })
    return
  }

  // Require auth to scope keys per user.
  if (!request.user) {
    reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Authentication required for idempotency' })
    return
  }

  const userId = request.user.userId
  const requestHash = hashRequest(request.method, request.url, request.body)

  // Check for existing record
  const existing = await prisma.idempotencyRecord.findUnique({
    where: { userId_key: { userId, key } },
  })

  if (existing) {
    // Reject if same key used for a DIFFERENT request payload (client bug)
    if (existing.requestHash !== requestHash) {
      reply.status(422).send({
        error: 'IDEMPOTENCY_KEY_MISMATCH',
        message: 'Idempotency-Key was previously used for a different request payload',
      })
      return
    }

    // Same key + same payload → return cached response
    request.idempotencyHit = true
    reply.header('x-idempotency-replayed', 'true')
    reply.status(existing.statusCode).send(JSON.parse(existing.responseBody))
    return
  }

  // First call — record the response after it sends.
  reply.header('x-idempotency-stored', 'true')

  // Use Fastify's onSend hook to capture the response body before transmission.
  // We add it for this request only.
  request.server.addHook('onSend', async function captureForIdempotency(req, _rep, payload) {
    if (req.id !== request.id) return payload // only this request
    // Don't record errors — let client retry properly
    const status = _rep.statusCode
    if (status >= 500) return payload
    try {
      const bodyText = typeof payload === 'string' ? payload : payload?.toString() ?? ''
      // Truncate giant payloads to bound storage
      const safeBody = bodyText.length > 64_000 ? bodyText.slice(0, 64_000) : bodyText
      await prisma.idempotencyRecord.create({
        data: {
          userId,
          key,
          requestHash,
          statusCode: status,
          responseBody: safeBody,
        },
      })
    } catch {
      // Best-effort: a duplicate-key race is fine, just means another
      // concurrent request already recorded. Don't fail the user's request.
    }
    return payload
  })
}

/**
 * Background cleanup — delete records older than retention. Call from a cron
 * or admin endpoint. Cheap; index on createdAt makes the predicate fast.
 */
export async function cleanupOldIdempotencyRecords(): Promise<number> {
  const cutoff = new Date(Date.now() - RETENTION_MS)
  const r = await prisma.idempotencyRecord.deleteMany({ where: { createdAt: { lt: cutoff } } })
  return r.count
}
