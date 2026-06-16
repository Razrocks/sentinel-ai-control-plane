/**
 * Shared optimistic-lock helpers.
 *
 * Lets routes assert that the version a client sent (via `If-Match` header
 * or `expectedVersion` body field) still matches the row's current version,
 * then atomically bumps the version on the underlying write. Mirrors the
 * pattern wired into Approval/PolicyRule (B5) but factored out so we don't
 * repeat the parse-header + 412-throw dance in every route.
 *
 * Trust boundary: callers MUST use `assertVersion` BEFORE any state-changing
 * write. Skipping it = silent overwrites under concurrent edits.
 */
import type { FastifyRequest } from 'fastify'
import { PreconditionFailedError } from './errors.js'

/**
 * Read `If-Match: "<version>"` (HTTP-standard ETag form) OR a fallback
 * `expectedVersion` body field. Returns `null` if neither present so the
 * caller can decide whether to skip the check (legacy clients) or refuse.
 */
export function readExpectedVersion(
  request: FastifyRequest,
  bodyVersion?: number,
): number | null {
  const ifMatch = request.headers['if-match']
  if (typeof ifMatch === 'string') {
    const match = ifMatch.match(/"(\d+)"/)
    if (match) return Number(match[1])
  }
  if (typeof bodyVersion === 'number') return bodyVersion
  return null
}

/**
 * Throw 412 with structured body when expected != current.
 *
 * The structured body lets the frontend pop a "this changed since you
 * loaded it" toast + auto-refetch without parsing a free-text message.
 */
export function assertVersion(
  expected: number | null,
  current: number,
  resource: string,
  id: string,
): void {
  if (expected === null) return
  if (expected !== current) {
    throw new PreconditionFailedError(resource, id, expected, current)
  }
}
