/**
 * Confidence gating — shared threshold logic for agent persistence decisions.
 *
 * Skills self-report confidence (0.0–1.0). Agents consult thresholds before
 * persisting advisory fields. Low confidence means "Claude wasn't sure" —
 * persisting that as fact would mislead users.
 *
 * Thresholds:
 *   < LOW   → do NOT persist; audit "low_confidence_skipped"; return as advisory-only
 *   < OK    → persist BUT flag in audit details; UI surfaces warning
 *   >= OK   → persist normally
 *
 * Tune thresholds per skill if needed; defaults are conservative.
 */

export interface ConfidenceThresholds {
  /** Below this, skip persistence entirely. */
  skipBelow: number
  /** Below this (but above skipBelow), persist with warning. */
  warnBelow: number
}

export const DEFAULT_THRESHOLDS: ConfidenceThresholds = {
  skipBelow: 0.4,
  warnBelow: 0.6,
}

/**
 * Per-skill threshold overrides. Drafting skills tolerate lower confidence
 * because outputs are drafts users review; classification skills get the
 * stricter defaults because their output feeds downstream decisions.
 */
export const SKILL_THRESHOLDS: Record<string, ConfidenceThresholds> = {
  // Drafting skills: user reviews everything anyway, accept lower confidence
  draft_work_note: { skipBelow: 0.2, warnBelow: 0.4 },
  draft_customer_response: { skipBelow: 0.2, warnBelow: 0.4 },
  draft_approval_packet: { skipBelow: 0.3, warnBelow: 0.5 },
  // Reshaping skill: low risk
  summarize_decision_impact: { skipBelow: 0.2, warnBelow: 0.4 },
  // Explanation skill: low risk
  explain_policy_decision: { skipBelow: 0.3, warnBelow: 0.5 },
  // Classification/decision-feeding skills: keep defaults (0.4 / 0.6)
}

export type ConfidenceVerdict = 'persist' | 'persist_with_warning' | 'skip'

export interface ConfidenceCheck {
  verdict: ConfidenceVerdict
  confidence: number
  threshold: ConfidenceThresholds
  /** Audit-friendly note explaining the gate decision. */
  note: string
}

/**
 * Check a skill's confidence value against its threshold.
 * Returns a verdict + a human-readable note for audit details.
 *
 * If confidence is undefined/null, treats as `persist_with_warning` (we have
 * no signal to gate on, so assume medium quality).
 */
export function gateConfidence(
  skillName: string,
  confidence: number | null | undefined,
): ConfidenceCheck {
  const threshold = SKILL_THRESHOLDS[skillName] ?? DEFAULT_THRESHOLDS
  const c = typeof confidence === 'number' ? confidence : null

  if (c === null) {
    return {
      verdict: 'persist_with_warning',
      confidence: 0,
      threshold,
      note: 'no confidence reported; persisted with caveat',
    }
  }

  if (c < threshold.skipBelow) {
    return {
      verdict: 'skip',
      confidence: c,
      threshold,
      note: `confidence ${c.toFixed(2)} below skip threshold ${threshold.skipBelow}; not persisted`,
    }
  }

  if (c < threshold.warnBelow) {
    return {
      verdict: 'persist_with_warning',
      confidence: c,
      threshold,
      note: `confidence ${c.toFixed(2)} below warn threshold ${threshold.warnBelow}; persisted with low-confidence flag`,
    }
  }

  return {
    verdict: 'persist',
    confidence: c,
    threshold,
    note: `confidence ${c.toFixed(2)} OK`,
  }
}
