import { describe, it, expect } from 'vitest'
import {
  gateConfidence,
  DEFAULT_THRESHOLDS,
  SKILL_THRESHOLDS,
} from './confidence.js'

// Confidence gates decide whether a skill's advisory output gets
// persisted, persisted-with-warning, or dropped. Per-skill overrides
// matter — drafting skills get looser thresholds than classification
// skills. These tests pin both the default policy and the exceptions.

describe('gateConfidence — default thresholds', () => {
  // Any skill NOT in SKILL_THRESHOLDS should use DEFAULT: skipBelow=0.4, warnBelow=0.6
  const skill = 'nonexistent_skill_uses_defaults'

  it('confidence 0.9 → persist', () => {
    const r = gateConfidence(skill, 0.9)
    expect(r.verdict).toBe('persist')
    expect(r.confidence).toBe(0.9)
    expect(r.threshold).toEqual(DEFAULT_THRESHOLDS)
  })

  it('confidence exactly at warnBelow (0.6) → persist', () => {
    // `< warnBelow` means 0.6 exactly is NOT below — persist.
    expect(gateConfidence(skill, 0.6).verdict).toBe('persist')
  })

  it('confidence 0.5 (between skip and warn) → persist_with_warning', () => {
    const r = gateConfidence(skill, 0.5)
    expect(r.verdict).toBe('persist_with_warning')
    expect(r.note).toContain('warn threshold')
  })

  it('confidence exactly at skipBelow (0.4) → persist_with_warning', () => {
    expect(gateConfidence(skill, 0.4).verdict).toBe('persist_with_warning')
  })

  it('confidence 0.2 (below skip) → skip', () => {
    const r = gateConfidence(skill, 0.2)
    expect(r.verdict).toBe('skip')
    expect(r.note).toContain('skip threshold')
    expect(r.note).toContain('not persisted')
  })
})

describe('gateConfidence — per-skill overrides (drafting skills)', () => {
  // Drafting skills are lenient: skipBelow=0.2, warnBelow=0.4
  it('draft_work_note allows persistence at 0.5 (would be a warning under defaults)', () => {
    const r = gateConfidence('draft_work_note', 0.5)
    expect(r.verdict).toBe('persist')
    expect(r.threshold).toEqual(SKILL_THRESHOLDS.draft_work_note)
  })

  it('draft_customer_response same policy as draft_work_note', () => {
    expect(gateConfidence('draft_customer_response', 0.5).verdict).toBe('persist')
  })

  it('draft_work_note at 0.3 → persist_with_warning (still above its skip threshold of 0.2)', () => {
    expect(gateConfidence('draft_work_note', 0.3).verdict).toBe('persist_with_warning')
  })

  it('draft_work_note at 0.1 → skip (below its own 0.2 threshold)', () => {
    expect(gateConfidence('draft_work_note', 0.1).verdict).toBe('skip')
  })
})

describe('gateConfidence — per-skill overrides (explain / summarize)', () => {
  it('explain_policy_decision has 0.3/0.5 thresholds', () => {
    expect(gateConfidence('explain_policy_decision', 0.55).verdict).toBe('persist')
    expect(gateConfidence('explain_policy_decision', 0.4).verdict).toBe('persist_with_warning')
    expect(gateConfidence('explain_policy_decision', 0.25).verdict).toBe('skip')
  })

  it('summarize_decision_impact uses draft-tier thresholds', () => {
    expect(gateConfidence('summarize_decision_impact', 0.5).verdict).toBe('persist')
  })
})

describe('gateConfidence — null / undefined confidence', () => {
  it('null → persist_with_warning with confidence=0', () => {
    const r = gateConfidence('assess_change', null)
    expect(r.verdict).toBe('persist_with_warning')
    expect(r.confidence).toBe(0)
    expect(r.note).toMatch(/no confidence reported/)
  })

  it('undefined → persist_with_warning', () => {
    expect(gateConfidence('assess_change', undefined).verdict).toBe('persist_with_warning')
  })
})

describe('gateConfidence — output shape stability', () => {
  it('always returns all four fields (verdict, confidence, threshold, note)', () => {
    for (const c of [0.9, 0.5, 0.2, null, undefined] as const) {
      const r = gateConfidence('assess_change', c)
      expect(r).toHaveProperty('verdict')
      expect(r).toHaveProperty('confidence')
      expect(r).toHaveProperty('threshold')
      expect(r).toHaveProperty('note')
      expect(['persist', 'persist_with_warning', 'skip']).toContain(r.verdict)
    }
  })
})
