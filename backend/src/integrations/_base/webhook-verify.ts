/**
 * HMAC signature verification for inbound webhooks.
 *
 * Each provider has its own scheme — we expose typed helpers per provider
 * so the route layer just calls `verifyGitHub(...)` etc. and gets a
 * boolean. Timing-safe equality everywhere; never short-circuit by length.
 *
 * Why this lives in `_base` and not under each provider's folder: the
 * webhook router is a single Fastify route that dispatches by `:type`. It
 * needs to know all the schemes up front to pick the right verifier
 * before we hit the adapter.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Constant-time string compare. Lengths must match — if they don't,
 * return false WITHOUT touching `timingSafeEqual` (which throws on
 * length mismatch). Pad to equal length before compare to avoid the
 * length itself being a side channel only when the values genuinely
 * differ.
 */
function safeCompare(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8')
  const bBuf = Buffer.from(b, 'utf8')
  if (aBuf.length !== bBuf.length) return false
  return timingSafeEqual(aBuf, bBuf)
}

/**
 * GitHub: header `X-Hub-Signature-256: sha256=<hex>`.
 * Body: raw bytes as delivered.
 */
export function verifyGitHub(rawBody: string, signatureHeader: string | undefined, secret: string): boolean {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false
  const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
  return safeCompare(signatureHeader, expected)
}

/**
 * Slack v0: headers `X-Slack-Signature: v0=<hex>` and
 * `X-Slack-Request-Timestamp: <epoch_seconds>`.
 *
 * Replay protection: reject anything older than 5 minutes.
 *
 * Signed base string: `v0:<timestamp>:<rawBody>`
 */
export function verifySlack(
  rawBody: string,
  signatureHeader: string | undefined,
  timestampHeader: string | undefined,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!signatureHeader || !timestampHeader) return false
  const ts = Number(timestampHeader)
  if (!Number.isFinite(ts)) return false
  // 5-minute replay window.
  if (Math.abs(nowSeconds - ts) > 60 * 5) return false
  const expected =
    'v0=' + createHmac('sha256', secret).update(`v0:${timestampHeader}:${rawBody}`, 'utf8').digest('hex')
  return safeCompare(signatureHeader, expected)
}

/**
 * Linear: header `Linear-Signature: <hex>` (HMAC-SHA256 over the raw body).
 */
export function verifyLinear(rawBody: string, signatureHeader: string | undefined, secret: string): boolean {
  if (!signatureHeader) return false
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
  return safeCompare(signatureHeader, expected)
}

/**
 * Sentry: header `Sentry-Hook-Signature: <hex>` (HMAC-SHA256, hex).
 */
export function verifySentry(rawBody: string, signatureHeader: string | undefined, secret: string): boolean {
  if (!signatureHeader) return false
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
  return safeCompare(signatureHeader, expected)
}

/**
 * PagerDuty: signature header may include multiple `v1=<hex>` values
 * (during secret rotation). Accept if ANY match.
 *
 * Header format: `X-PagerDuty-Signature: v1=<hex>,v1=<hex>`
 */
export function verifyPagerDuty(rawBody: string, signatureHeader: string | undefined, secret: string): boolean {
  if (!signatureHeader) return false
  const expected = 'v1=' + createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
  return signatureHeader.split(',').some((sig) => safeCompare(sig.trim(), expected))
}
