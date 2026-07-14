import { describe, it, expect, vi, beforeEach } from 'vitest'
import { randomBytes } from 'node:crypto'

// A stable 32-byte key we control from the test — we mock the config
// module so encryption/decryption run against known material rather than
// whatever the developer happens to have in backend/.env. Keeps the tests
// hermetic and CI-safe (no real key required).
const TEST_KEY_BUF = randomBytes(32)
const TEST_KEY_B64 = TEST_KEY_BUF.toString('base64')

vi.mock('../../config.js', () => ({
  config: {
    encryptionKey: TEST_KEY_B64,
  },
}))

describe('encryption — round-trip', () => {
  let encrypt: (s: string) => string
  let decrypt: (s: string) => string
  let maskCredential: (s: string) => string
  let isEncryptionAvailable: () => boolean

  beforeEach(async () => {
    // Fresh import per test so the module's lazy `_key` cache doesn't
    // leak across mocked-config swaps in future tests.
    vi.resetModules()
    const mod = await import('./encryption.js')
    encrypt = mod.encrypt
    decrypt = mod.decrypt
    maskCredential = mod.maskCredential
    isEncryptionAvailable = mod.isEncryptionAvailable
  })

  it('encrypt → decrypt returns the original plaintext', () => {
    const plaintext = 'sk-ant-supersecret-token'
    const blob = encrypt(plaintext)
    expect(decrypt(blob)).toBe(plaintext)
  })

  it('handles UTF-8 content correctly (emoji + non-ASCII)', () => {
    const plaintext = 'passwörd-🔐-résumé'
    expect(decrypt(encrypt(plaintext))).toBe(plaintext)
  })

  it('handles empty string', () => {
    expect(decrypt(encrypt(''))).toBe('')
  })

  it('produces different ciphertext each encryption (fresh IV)', () => {
    const a = encrypt('same')
    const b = encrypt('same')
    expect(a).not.toBe(b)
    // Both still decrypt correctly.
    expect(decrypt(a)).toBe('same')
    expect(decrypt(b)).toBe('same')
  })

  it('output format is base64.base64.base64 (three parts)', () => {
    const blob = encrypt('x')
    const parts = blob.split('.')
    expect(parts).toHaveLength(3)
    // IV = 12 bytes → 16-char base64
    expect(Buffer.from(parts[0], 'base64')).toHaveLength(12)
    // Auth tag = 16 bytes → 24-char base64
    expect(Buffer.from(parts[1], 'base64')).toHaveLength(16)
  })

  it('isEncryptionAvailable returns true with a valid key', () => {
    expect(isEncryptionAvailable()).toBe(true)
  })
})

describe('encryption — tamper detection', () => {
  let encrypt: (s: string) => string
  let decrypt: (s: string) => string

  beforeEach(async () => {
    vi.resetModules()
    const mod = await import('./encryption.js')
    encrypt = mod.encrypt
    decrypt = mod.decrypt
  })

  it('throws on flipped ciphertext byte (GCM auth tag catches it)', () => {
    const blob = encrypt('sensitive')
    const [iv, tag, ct] = blob.split('.')
    // Flip one base64 char in ciphertext to corrupt it.
    const corrupted = ct.slice(0, -2) + (ct.slice(-2) === 'AA' ? 'AB' : 'AA')
    expect(() => decrypt(`${iv}.${tag}.${corrupted}`)).toThrow(/decryption failed/)
  })

  it('throws on wrong auth tag', () => {
    const blob = encrypt('x')
    const [iv, , ct] = blob.split('.')
    const badTag = Buffer.alloc(16).toString('base64')
    expect(() => decrypt(`${iv}.${badTag}.${ct}`)).toThrow(/decryption failed/)
  })

  it('throws on malformed blob (wrong number of parts)', () => {
    expect(() => decrypt('not.enough')).toThrow(/malformed/)
    expect(() => decrypt('one.two.three.four')).toThrow(/malformed/)
  })

  it('throws on short IV', () => {
    const shortIv = Buffer.alloc(8).toString('base64')
    const tag = Buffer.alloc(16).toString('base64')
    const ct = Buffer.alloc(16).toString('base64')
    expect(() => decrypt(`${shortIv}.${tag}.${ct}`)).toThrow(/malformed/)
  })
})

describe('maskCredential', () => {
  let maskCredential: (s: string) => string
  beforeEach(async () => {
    vi.resetModules()
    ;({ maskCredential } = await import('./encryption.js'))
  })

  it('reveals only the last 4 chars', () => {
    expect(maskCredential('sk-ant-1234567890abcd')).toBe('····abcd')
  })

  it('fully masks credentials of length ≤ 4', () => {
    expect(maskCredential('abcd')).toBe('····')
    expect(maskCredential('x')).toBe('····')
    expect(maskCredential('')).toBe('····')
  })

  it('leaks no full-credential substring', () => {
    const cred = 'super-secret-should-never-appear'
    const masked = maskCredential(cred)
    expect(masked).not.toContain('super-secret')
    expect(masked).toBe('····pear')
  })
})

describe('encryption — key validation', () => {
  it('rejects a missing key with a specific error', async () => {
    vi.resetModules()
    vi.doMock('../../config.js', () => ({ config: { encryptionKey: '' } }))
    const { encrypt } = await import('./encryption.js')
    expect(() => encrypt('x')).toThrow(/ENCRYPTION_KEY is not configured/)
    vi.doUnmock('../../config.js')
  })

  it('rejects a short key with byte-length error', async () => {
    vi.resetModules()
    // 16-byte key encoded — half the required length.
    const shortKey = randomBytes(16).toString('base64')
    vi.doMock('../../config.js', () => ({ config: { encryptionKey: shortKey } }))
    const { encrypt } = await import('./encryption.js')
    expect(() => encrypt('x')).toThrow(/must decode to exactly 32 bytes/)
    vi.doUnmock('../../config.js')
  })
})
