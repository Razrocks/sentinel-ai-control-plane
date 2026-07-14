import { describe, it, expect } from 'vitest'
import {
  collectStrings,
  validateReferences,
  violationsAreBlocking,
} from './validate-references.js'
import type { SkillContext } from './types.js'

// The reference validator is defence-in-depth against hallucinated
// service/entity names slipping past the Zod schema. False negatives
// (missed hallucinations) are the failure we're catching; false
// positives (blocking a legit output because it mentions a service the
// user typed) are almost worse because they block valid work. These
// tests pin both directions.

describe('collectStrings', () => {
  it('walks nested objects + arrays and flattens all string leaves', () => {
    const out = collectStrings({
      a: 'one',
      b: ['two', 'three'],
      c: { d: 'four', e: { f: 'five' } },
      g: 42,
      h: null,
    })
    expect(out).toEqual(['one', 'two', 'three', 'four', 'five'])
  })

  it('returns an empty array for non-string primitives', () => {
    expect(collectStrings(42)).toEqual([])
    expect(collectStrings(null)).toEqual([])
    expect(collectStrings(undefined)).toEqual([])
    expect(collectStrings(true)).toEqual([])
  })

  it('preserves order and reuses the provided accumulator', () => {
    const acc: string[] = ['seed']
    collectStrings({ x: 'a', y: 'b' }, acc)
    expect(acc).toEqual(['seed', 'a', 'b'])
  })
})

// Minimal ctx shape — the validator only touches
// ctx.t1?.orgCatalog?.services keys.
function ctxWithServices(services: Record<string, unknown>): SkillContext {
  return {
    actor: 'test',
    t1: {
      identity: { hardConstraints: [] },
      orgCatalog: {
        users: [],
        services: services as SkillContext['t1']['orgCatalog']['services'],
        approverRegistry: {},
      },
    },
  } as SkillContext
}

describe('validateReferences', () => {
  it('returns [] when the catalog is empty (no known set → skip checks)', () => {
    const ctx = ctxWithServices({})
    const out = validateReferences(
      { text: 'this-service goes down and other-api is affected' },
      ctx,
    )
    expect(out).toEqual([])
  })

  it('flags a service in output that is NOT in the catalog', () => {
    const ctx = ctxWithServices({
      'payment-service': { team: 'x', criticality: 'high', ownerUserIds: [] },
    })
    const out = validateReferences(
      { finding: 'hallucinated-service is broken' },
      ctx,
    )
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('service')
    expect(out[0].value).toBe('hallucinated-service')
    expect(out[0].reason).toContain('not in catalog')
  })

  it('accepts a service that is in the catalog', () => {
    const ctx = ctxWithServices({
      'payment-service': { team: 'x', criticality: 'high', ownerUserIds: [] },
    })
    const out = validateReferences(
      { finding: 'payment-service is degraded' },
      ctx,
    )
    expect(out).toEqual([])
  })

  it('input-passthrough: allows service names that appeared in the input', () => {
    const ctx = ctxWithServices({
      'payment-service': { team: 'x', criticality: 'high', ownerUserIds: [] },
    })
    // "orders-db" is not in catalog but was in the input; must not be flagged.
    const out = validateReferences(
      { finding: 'orders-db failover recommended' },
      ctx,
      { candidates: [{ name: 'orders-db' }] },
    )
    expect(out).toEqual([])
  })

  it('accepts parenthetical decorations (input contains bare name as substring)', () => {
    const ctx = ctxWithServices({
      'payment-service': { team: 'x', criticality: 'high', ownerUserIds: [] },
    })
    const out = validateReferences(
      { finding: 'orders-db is slow' },
      ctx,
      { description: 'orders-db (PostgreSQL 14) crashed' },
    )
    expect(out).toEqual([])
  })

  it('ignores tokens that do not look like service names', () => {
    const ctx = ctxWithServices({
      'payment-service': { team: 'x', criticality: 'high', ownerUserIds: [] },
    })
    const out = validateReferences(
      { finding: 'CPU spike observed on node-2' },
      ctx,
    )
    // 'node-2' doesn't end in a service-suffix (-service, -api, -db etc.)
    expect(out).toEqual([])
  })
})

describe('violationsAreBlocking', () => {
  it('returns false for an empty list', () => {
    expect(violationsAreBlocking([])).toBe(false)
  })

  it('returns true when any violation is a service kind', () => {
    expect(
      violationsAreBlocking([{ kind: 'service', value: 'x', reason: 'r' }]),
    ).toBe(true)
  })

  it('returns false for non-service violations (v1 policy)', () => {
    expect(
      violationsAreBlocking([
        { kind: 'user_name', value: 'alice', reason: 'r' },
        { kind: 'kb_article', value: 'KB-1234', reason: 'r' },
      ]),
    ).toBe(false)
  })

  it('returns true if at least one service violation exists in a mixed list', () => {
    expect(
      violationsAreBlocking([
        { kind: 'user_name', value: 'alice', reason: 'r' },
        { kind: 'service', value: 'x', reason: 'r' },
      ]),
    ).toBe(true)
  })
})
