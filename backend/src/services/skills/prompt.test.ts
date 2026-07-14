import { describe, it, expect } from 'vitest'
import {
  buildSystemPrompt,
  splitOnCacheBreak,
  renderInputAsJson,
  renderT1aIdentity,
  renderT1bPolicyBundle,
  renderT1cRoleConstraints,
  renderT1dOrgCatalog,
  renderT5Context,
  CACHE_BREAK_MARKER,
} from './prompt.js'
import type {
  T1bPolicyBundle,
  T1cRoleConstraints,
  T1dOrgCatalog,
  T5Context,
  SkillContext,
} from './types.js'

// The prompt layer is the contract every skill signs with the model.
// If we break the cache-marker convention or the tier ordering we
// silently invalidate every prompt cache in production. These tests
// pin the invariants downstream skills quietly depend on.

const emptyBundle: T1bPolicyBundle = {
  bundleVersion: 'test-v1',
  rules: [],
  activeFreezes: [],
}

const emptyRole: T1cRoleConstraints = {
  role: 'operator',
  label: 'Operator',
  description: 'Test operator',
  allowed: ['a'],
  blocked: ['b'],
}

const emptyCatalog: T1dOrgCatalog = {
  users: [],
  services: {},
  approverRegistry: {},
}

const t5Now: T5Context = {
  now: '2026-01-15T12:00:00Z',
}

// ─── Tier renderers ─────────────────────────────────────

describe('renderT1aIdentity', () => {
  it('emits the ## Identity heading and formats constraints as bullets', () => {
    const out = renderT1aIdentity({
      systemRole: 'sentinel',
      hardConstraints: ['do X', 'never do Y'],
    })
    expect(out).toMatch(/^## Identity/)
    expect(out).toContain('- do X')
    expect(out).toContain('- never do Y')
  })
})

describe('renderT1bPolicyBundle', () => {
  it('says "No active rules" when the bundle is empty', () => {
    const out = renderT1bPolicyBundle(emptyBundle)
    expect(out).toContain('No active rules.')
    expect(out).toContain('No active freeze windows.')
  })

  it('renders each rule with bundle/scope/decision + description', () => {
    const out = renderT1bPolicyBundle({
      ...emptyBundle,
      rules: [
        {
          name: 'rule_a',
          description: 'desc',
          bundle: 'default',
          decision: 'deny',
          scope: 'changes',
          appliesTo: ['payment-service'],
        },
      ],
    })
    expect(out).toContain('rule_a')
    // Rule serialization format: `- name (bundle, scope=X, decision=Y): description`
    expect(out).toContain('(default, scope=changes, decision=deny)')
    expect(out).toContain('desc')
  })

  it('quotes rationale + examples + tags when present', () => {
    const out = renderT1bPolicyBundle({
      ...emptyBundle,
      rules: [
        {
          name: 'r',
          description: 'd',
          bundle: 'default',
          decision: 'allow',
          scope: 'changes',
          appliesTo: [],
          rationale: 'because',
          examples: ['ex 1', 'ex 2'],
          tags: ['ops', 'safety'],
        },
      ],
    })
    expect(out).toContain('rationale: because')
    expect(out).toContain('- ex 1')
    expect(out).toContain('- ex 2')
    expect(out).toContain('tags: ops, safety')
  })

  it('renders active freeze windows when present', () => {
    const out = renderT1bPolicyBundle({
      ...emptyBundle,
      activeFreezes: [
        {
          id: 'freeze-1',
          label: 'Prod freeze',
          scope: 'global',
          startsAt: '2026-01-01T00:00:00Z',
          endsAt: '2026-01-03T00:00:00Z',
          affectsServices: ['a', 'b'],
        },
      ],
    })
    expect(out).toContain('freeze-1')
    expect(out).toContain('Prod freeze')
    expect(out).toContain('affects: a, b')
  })
})

describe('renderT1cRoleConstraints', () => {
  it('emits Allowed + Blocked sections', () => {
    const out = renderT1cRoleConstraints(emptyRole)
    expect(out).toContain('## Role Constraints')
    expect(out).toContain('Allowed:')
    expect(out).toContain('- a')
    expect(out).toContain('Blocked:')
    expect(out).toContain('- b')
  })
})

describe('renderT1dOrgCatalog', () => {
  it('outputs a heading even when empty', () => {
    const out = renderT1dOrgCatalog(emptyCatalog)
    expect(out).toMatch(/## Org & Service Catalog/)
  })
})

describe('renderT5Context', () => {
  it('carries the wall-clock now', () => {
    const out = renderT5Context(t5Now)
    expect(out).toMatch(/^## Temporal/)
    expect(out).toContain('2026-01-15')
  })
})

// ─── buildSystemPrompt + splitOnCacheBreak roundtrip ─────

function baseCtx(overrides: Partial<SkillContext['t1']> = {}): SkillContext {
  return {
    actor: 'test-actor',
    t1: {
      identity: { systemRole: 'sentinel', hardConstraints: ['read-only advisor'] },
      policyBundle: emptyBundle,
      roleConstraints: emptyRole,
      orgCatalog: emptyCatalog,
      ...overrides,
    },
    t2: undefined,
    t4: undefined,
    t5: t5Now,
  }
}

describe('buildSystemPrompt', () => {
  it('joins cached + dynamic halves with CACHE_BREAK_MARKER', () => {
    const out = buildSystemPrompt(baseCtx(), {
      taskInstructions: 'do the thing',
    })
    expect(out).toContain(CACHE_BREAK_MARKER)
    // Task instructions live BEFORE the marker (cached half).
    const idx = out.indexOf(CACHE_BREAK_MARKER)
    expect(out.slice(0, idx)).toContain('do the thing')
    // T5 lives AFTER the marker (dynamic half).
    expect(out.slice(idx)).toContain('2026-01-15')
  })

  it('omits the cache marker entirely when no dynamic tiers are present', () => {
    const ctx: SkillContext = {
      actor: 'test',
      t1: { identity: { systemRole: 'sentinel', hardConstraints: ['x'] } },
      // No T2 / T4 / T5 → dynamic half is empty → no marker.
    }
    const out = buildSystemPrompt(ctx, { includeT5: false, includeT2: false, includeT4: false })
    expect(out).not.toContain(CACHE_BREAK_MARKER)
  })

  it('honors include* flags — role can be excluded', () => {
    const out = buildSystemPrompt(baseCtx(), { includeRole: false })
    expect(out).not.toContain('## Role Constraints')
  })

  it('honors include* flags — policy can be excluded', () => {
    const out = buildSystemPrompt(baseCtx(), { includePolicy: false })
    expect(out).not.toContain('## Active Policy Bundle')
  })

  it('renders identity → policy → role → catalog in that order', () => {
    const out = buildSystemPrompt(baseCtx(), { taskInstructions: 'T' })
    const idxIdentity = out.indexOf('## Identity')
    const idxPolicy = out.indexOf('## Active Policy Bundle')
    const idxRole = out.indexOf('## Role Constraints')
    const idxCatalog = out.indexOf('## Org & Service Catalog')
    expect(idxIdentity).toBeGreaterThanOrEqual(0)
    expect(idxPolicy).toBeGreaterThan(idxIdentity)
    expect(idxRole).toBeGreaterThan(idxPolicy)
    expect(idxCatalog).toBeGreaterThan(idxRole)
  })
})

describe('splitOnCacheBreak', () => {
  it('splits on the marker and trims surrounding newlines', () => {
    const joined = `PREFIX\n\n${CACHE_BREAK_MARKER}\n\nSUFFIX`
    const { cached, dynamic } = splitOnCacheBreak(joined)
    expect(cached).toBe('PREFIX')
    expect(dynamic).toBe('SUFFIX')
  })

  it('returns the whole prompt as cached when the marker is missing', () => {
    const { cached, dynamic } = splitOnCacheBreak('just prefix, no marker')
    expect(cached).toBe('just prefix, no marker')
    expect(dynamic).toBe('')
  })

  it('roundtrips with buildSystemPrompt', () => {
    const joined = buildSystemPrompt(baseCtx(), {
      taskInstructions: 'roundtrip test',
    })
    const { cached, dynamic } = splitOnCacheBreak(joined)
    expect(cached).toContain('roundtrip test')
    expect(dynamic).toContain('2026-01-15')
    expect(cached).not.toContain(CACHE_BREAK_MARKER)
    expect(dynamic).not.toContain(CACHE_BREAK_MARKER)
  })
})

describe('renderInputAsJson', () => {
  it('wraps the payload in a ```json fence and adds a read-only reminder', () => {
    const out = renderInputAsJson({ hello: 'world' })
    expect(out).toContain('```json')
    expect(out).toContain('"hello": "world"')
    expect(out).toContain('read-only')
  })
})
