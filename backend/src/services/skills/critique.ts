/**
 * A9 — skill self-critique.
 *
 * After a primary skill call produces a schema-valid, reference-clean output,
 * the runner can optionally hand the input + output to a cheap critic model
 * which looks for problems the schema can't catch:
 *
 *   - factual mismatches between input and output
 *   - skipped constraints stated in the input ("production-only" → output
 *     proposes staging change)
 *   - hallucinated entities the reference validator missed because they
 *     happened to look like input strings
 *   - "schema-valid but semantically wrong" outputs
 *
 * The critic returns a structured verdict. On `severity === 'major'` the
 * runner fails the call as `validation_failed` with the critic's issues in
 * `errorMessage`, so the caller treats it as bad output rather than
 * persisting questionable analysis.
 *
 * Cost note: every critiqued call adds ~one extra model round-trip. Apply
 * selectively (registry.ts) — production-affecting skills only.
 */

import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import {
  withRetry,
  withTimeout,
  breakerOpen,
  recordBreakerSuccess,
  recordBreakerFailure,
  CircuitOpenError,
  TimeoutError,
  isTransientError,
} from './reliability.js'
import type {
  CritiqueConfig,
  CritiqueResult,
  CritiqueSeverity,
  SkillName,
} from './types.js'

/** Cheaper default critic. ~5x cheaper than sonnet — keeps the overhead in check. */
const DEFAULT_CRITIC_MODEL = 'claude-haiku-4-5-20251001'
const CRITIQUE_TIMEOUT_MS = 20_000 // shorter than primary; critic prompts are small
const SEVERITY_ORDER: Record<CritiqueSeverity, number> = { none: 0, minor: 1, major: 2 }

const CritiqueOutputSchema = z.object({
  ok: z.boolean(),
  severity: z.enum(['none', 'minor', 'major']),
  issues: z.array(z.string()).default([]),
  suggestion: z.string().optional(),
})

/**
 * Build the critic system prompt. Generic across all skills; skill-specific
 * pitfalls can be appended via `config.extraGuidance`.
 */
function buildCriticSystem(skill: SkillName, extraGuidance?: string): string {
  return [
    `You are reviewing the output of the "${skill}" skill for problems.`,
    'Your job is to spot mistakes the schema validator could not catch.',
    '',
    'Categories of issues to flag (most → least serious):',
    '- factual contradiction with the input',
    '- skipped or misapplied constraint stated in the input',
    '- hallucinated entity name (user, service, system, ticket) not present in the input',
    '- internally inconsistent fields (e.g. "low risk" + "data loss possible")',
    '- recommendation that does not match the rationale',
    '- wrong category / enum choice given the evidence',
    '',
    'Be strict but specific. Do NOT flag stylistic preferences, tone, or things the schema already enforces.',
    extraGuidance ? `\nSkill-specific guidance:\n${extraGuidance}\n` : '',
    'Return ONLY a JSON object with this exact shape:',
    '{',
    '  "ok": <boolean — true if no blocking issues>,',
    '  "severity": "none" | "minor" | "major",',
    '  "issues": ["<one short sentence per issue>"],',
    '  "suggestion": "<optional 1-sentence fix recommendation>"',
    '}',
    '',
    'Severity guide:',
    '- none: nothing wrong worth mentioning',
    '- minor: imprecise wording, weak rationale, or low-confidence claim — keep but flag',
    '- major: factual error, hallucination, or contradiction — block this output',
  ].join('\n')
}

/**
 * Build the critic user message. Just the input and output, serialized as
 * JSON — the critic sees exactly what the caller and the skill saw.
 */
function buildCriticUser(input: unknown, output: unknown): string {
  return [
    'INPUT (what the skill was given):',
    '```json',
    JSON.stringify(input, null, 2),
    '```',
    '',
    'OUTPUT (what the skill produced):',
    '```json',
    JSON.stringify(output, null, 2),
    '```',
    '',
    'Review the OUTPUT against the INPUT. Return the JSON verdict.',
  ].join('\n')
}

function stripCodeFences(text: string): string {
  let trimmed = text.trim()
  if (trimmed.startsWith('```')) {
    const firstNewline = trimmed.indexOf('\n')
    if (firstNewline >= 0) trimmed = trimmed.slice(firstNewline + 1)
    if (trimmed.endsWith('```')) trimmed = trimmed.slice(0, -3)
    trimmed = trimmed.trim()
  }
  return trimmed
}

/** Returns true when actual severity is at or above the configured threshold. */
export function critiqueBlocks(result: CritiqueResult, config: CritiqueConfig): boolean {
  const threshold = config.blockSeverity ?? 'major'
  return SEVERITY_ORDER[result.severity] >= SEVERITY_ORDER[threshold] && !result.ok
}

/**
 * Run the critic. Never throws — on infrastructure failure we return a
 * permissive `severity: 'none'` so the primary output isn't rejected for
 * a critic-side outage (we'd rather pass a borderline output than block
 * everything because Anthropic returned 503). Critic outages still show
 * up in logs.
 */
export async function runCritique(
  client: Anthropic,
  skill: SkillName,
  input: unknown,
  output: unknown,
  config: CritiqueConfig,
): Promise<CritiqueResult> {
  const model = config.model ?? DEFAULT_CRITIC_MODEL
  const breakerKey = `${model}:critique:${skill}`
  const system = buildCriticSystem(skill, config.extraGuidance)
  const user = buildCriticUser(input, output)

  if (breakerOpen(breakerKey)) {
    // Critic breaker open → degrade open (don't block the primary).
    return {
      ok: true,
      severity: 'none',
      issues: [`critic breaker open for ${breakerKey} — skipping critique`],
      model,
      tokensIn: 0,
      tokensOut: 0,
    }
  }

  let response
  try {
    response = await withRetry(
      () =>
        withTimeout(
          () =>
            client.messages.create({
              model,
              max_tokens: 600,
              temperature: 0,
              system,
              messages: [{ role: 'user', content: user }],
            }),
          CRITIQUE_TIMEOUT_MS,
        ),
      {
        maxAttempts: 2, // critic is best-effort, don't burn budget retrying
        baseDelayMs: 400,
        maxDelayMs: 2000,
        shouldRetry: (err, attempt) => {
          if (err instanceof TimeoutError) return false
          if (err instanceof CircuitOpenError) return false
          return isTransientError(err) && attempt < 2
        },
      },
    )
    recordBreakerSuccess(breakerKey)
  } catch (err) {
    recordBreakerFailure(breakerKey)
    // Degrade open on infrastructure error — don't fail the primary call
    // because the critic couldn't run. Surface the failure on the result.
    const errMsg = err instanceof Error ? err.message : String(err)
    return {
      ok: true,
      severity: 'none',
      issues: [`critic call failed (degraded open): ${errMsg}`],
      model,
      tokensIn: 0,
      tokensOut: 0,
    }
  }

  let rawText = ''
  for (const block of response.content) {
    if (block.type === 'text') rawText += block.text
  }
  const tokensIn = response.usage?.input_tokens ?? 0
  const tokensOut = response.usage?.output_tokens ?? 0

  let parsed: unknown
  try {
    parsed = JSON.parse(stripCodeFences(rawText))
  } catch (err) {
    // Critic returned non-JSON. Treat as "couldn't critique" rather than
    // blocking — same degrade-open posture as transport errors.
    return {
      ok: true,
      severity: 'none',
      issues: [`critic output was not JSON: ${err instanceof Error ? err.message : String(err)}`],
      model,
      tokensIn,
      tokensOut,
    }
  }

  const verdict = CritiqueOutputSchema.safeParse(parsed)
  if (!verdict.success) {
    return {
      ok: true,
      severity: 'none',
      issues: [`critic verdict failed schema: ${JSON.stringify(verdict.error.flatten())}`],
      model,
      tokensIn,
      tokensOut,
    }
  }

  return {
    ok: verdict.data.ok,
    severity: verdict.data.severity,
    issues: verdict.data.issues,
    suggestion: verdict.data.suggestion,
    model,
    tokensIn,
    tokensOut,
  }
}
