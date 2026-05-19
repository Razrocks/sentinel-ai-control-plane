/**
 * Eval harness types.
 *
 * A golden sample = one (input, expectations) pair. Expectations are
 * semantic assertions, not byte-equality, because Claude's prose varies.
 *
 * Run shape:
 *   1. Load golden file per skill
 *   2. For each sample: call runSkill(name, input, ctx) with skipProvenance
 *   3. Apply each expectation to the output
 *   4. Report pass/fail per assertion + per sample + per skill
 */

import type { SkillName, SkillContext } from '../src/services/skills/index.js'

export type ExpectationKind =
  | 'status_is'         // status === expected
  | 'has_field'         // output[field] is defined
  | 'field_equals'      // output[field] === expected value (exact)
  | 'field_in'          // output[field] is one of expected values
  | 'field_min'         // output[field] >= expected number
  | 'field_max'         // output[field] <= expected number
  | 'field_contains'    // output[field] (string) contains substring (case-insensitive)
  | 'field_length_min'  // (output[field] as array).length >= expected
  | 'field_length_max'  // (output[field] as array).length <= expected
  | 'no_violations'     // reference validator returns no blocking violations (runner already enforces; this is informational)

export interface Expectation {
  kind: ExpectationKind
  /** Dotted path into output (e.g. "riskLevel", "signals.0.kind"). Empty for status checks. */
  path?: string
  /** Value to compare against. Meaning depends on kind. */
  value?: unknown
  /** Optional human-readable label for the assertion (shown in reports). */
  label?: string
}

export interface GoldenSample {
  /** Stable identifier for the sample. Shown in reports. */
  name: string
  /** Short description of what this sample tests (worst-case, happy path, edge, etc.). */
  description?: string
  /** Skill input payload (validated by the skill's Zod inputSchema). */
  input: unknown
  /** Assertions applied to the output. */
  expectations: Expectation[]
  /** Optional partial context overrides; merged into the base ctx. */
  ctxOverride?: Partial<SkillContext>
}

export interface GoldenFile {
  skill: SkillName
  samples: GoldenSample[]
}

export interface AssertionResult {
  expectation: Expectation
  pass: boolean
  actual?: unknown
  reason?: string
}

export interface SampleResult {
  sample: GoldenSample
  status: 'success' | 'validation_failed' | 'error'
  assertions: AssertionResult[]
  /** Tokens + latency from the runner. */
  metrics: { tokensIn: number; tokensOut: number; latencyMs: number; cached: boolean }
  errorMessage?: string
}

export interface SkillResult {
  skill: SkillName
  samples: SampleResult[]
  passCount: number
  failCount: number
  totalAssertions: number
  passedAssertions: number
  costUsd: number
}

export interface EvalReport {
  startedAt: string
  durationMs: number
  skills: SkillResult[]
  totalPass: number
  totalFail: number
  totalCostUsd: number
}
