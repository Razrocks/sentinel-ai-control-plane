/**
 * AES-256-GCM at-rest encryption for integration credentials.
 *
 * Why GCM, not CBC: authenticated encryption — we get tamper detection for
 * free. Any byte flip in the ciphertext fails decryption rather than
 * silently producing garbage that we might pass to a provider.
 *
 * Format (base64-encoded, concatenated with `.` separators):
 *
 *     <iv>.<authTag>.<ciphertext>
 *
 * - iv: 12 bytes, random per encryption (NEVER reused with the same key)
 * - authTag: 16 bytes, GCM auth tag
 * - ciphertext: variable length
 *
 * Key source: `config.encryptionKey` (process env `ENCRYPTION_KEY`), 32
 * bytes after base64-decode. Throws on missing/short key — never silently
 * falls back to a weak default; that's how secrets leak.
 *
 * Operational rules (HARD):
 *   - Plaintext is never logged. Throw a generic "encryption failed" rather
 *     than including the secret in any error string.
 *   - Decrypt is on-use, in-process; the result never crosses the network.
 *   - Rotate by re-encrypting all rows under a new key (separate script).
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { config } from '../../config.js'

const ALGO = 'aes-256-gcm'
const IV_LENGTH = 12 // GCM standard
const AUTH_TAG_LENGTH = 16
const KEY_LENGTH = 32 // 256 bits

let _key: Buffer | null = null

/**
 * Decode the configured key once, with validation. Lazy so the rest of the
 * app can boot even before an operator runs the encryption-key bootstrap
 * step — only the integration save path requires it.
 *
 * Throws a generic message: we never echo the key value or how short it
 * was, to avoid leaking partial entropy into logs.
 */
function getKey(): Buffer {
  if (_key) return _key
  if (!config.encryptionKey) {
    throw new Error(
      'ENCRYPTION_KEY is not configured. Generate one with: ' +
        'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))" ' +
        'and add it to backend/.env.',
    )
  }
  const decoded = Buffer.from(config.encryptionKey, 'base64')
  if (decoded.length !== KEY_LENGTH) {
    throw new Error(
      `ENCRYPTION_KEY must decode to exactly ${KEY_LENGTH} bytes (got ${decoded.length}). ` +
        'Regenerate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    )
  }
  _key = decoded
  return _key
}

/**
 * Returns true when ENCRYPTION_KEY is set and decodes to the right length.
 * Used by setup health checks and integration save handlers to refuse with
 * 503 before any token reaches us.
 */
export function isEncryptionAvailable(): boolean {
  try {
    getKey()
    return true
  } catch {
    return false
  }
}

/**
 * Encrypt a UTF-8 string. Result is base64-encoded triple `iv.tag.ct`.
 *
 * @throws if encryption key missing/invalid (NOT if input is wrong type — TS
 * enforces that).
 */
export function encrypt(plaintext: string): string {
  const key = getKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGO, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join('.')
}

/**
 * Decrypt the output of `encrypt`. Throws on any tamper / wrong key /
 * malformed input. Never returns a partial/garbage plaintext.
 *
 * Error messages are intentionally vague to avoid leaking timing or format
 * details that could help an attacker.
 */
export function decrypt(blob: string): string {
  const key = getKey()
  const parts = blob.split('.')
  if (parts.length !== 3) {
    throw new Error('encrypted blob malformed')
  }
  const [ivB64, tagB64, ctB64] = parts
  const iv = Buffer.from(ivB64, 'base64')
  const tag = Buffer.from(tagB64, 'base64')
  const ct = Buffer.from(ctB64, 'base64')
  if (iv.length !== IV_LENGTH || tag.length !== AUTH_TAG_LENGTH) {
    throw new Error('encrypted blob malformed')
  }
  const decipher = createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  try {
    const plaintext = Buffer.concat([decipher.update(ct), decipher.final()])
    return plaintext.toString('utf8')
  } catch {
    // GCM auth failure → generic error. Do NOT include the original.
    throw new Error('decryption failed')
  }
}

/**
 * Helper for redacting a credential for display. Returns the last 4
 * characters with the rest masked. Used by Settings UI to show "···abcd"
 * so an admin can verify which token is loaded without us exposing it.
 *
 * NEVER concatenate the full plaintext into a string that may end up in a
 * log, response body, or audit event.
 */
export function maskCredential(plaintext: string): string {
  if (plaintext.length <= 4) return '····'
  return '····' + plaintext.slice(-4)
}
