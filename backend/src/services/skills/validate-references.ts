/**
 * Post-output reference validator. Anti-hallucination defence-in-depth.
 *
 * After Zod accepts shape, scan the output for entity-shaped strings
 * (ticket IDs, KB articles, service names, user names referenced as catalog
 * entries) and verify each one exists in the data the skill was given.
 *
 * Catches the failure mode where Claude returns valid-shape output that
 * references entities the user/system has no way to look up — e.g. a
 * recommended fix that names a service that doesn't exist.
 *
 * Strategy: pass-through unless we have a catalog to validate against. Only
 * flags clear violations — false positives are worse than misses because they
 * block legitimate output.
 */

import type { SkillContext } from './types.js'

export interface ReferenceViolation {
  kind: 'service' | 'change_ticket' | 'incident_ticket' | 'access_ticket' | 'user_name' | 'kb_article'
  value: string
  reason: string
}

/**
 * Walk a parsed output object and collect all string values.
 * Used to find entity references in deeply nested structures.
 */
export function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    out.push(value)
  } else if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, out)
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) collectStrings(v, out)
  }
  return out
}

// Patterns for entity references. Each pattern emits candidate IDs/names.
const TICKET_PATTERNS = {
  change: /\bCHG-\d{4}-\d{3,4}\b/g,
  incident: /\bINC-\d{4}-\d{3,4}\b/g,
  access: /\bACC-\d{4}-\d{3,4}\b/g,
  kb: /\bKB-\d{3,4}\b/g,
}
// Heuristic for service names: lowercase-hyphenated ending in known suffixes.
const SERVICE_PATTERN = /\b[a-z][a-z0-9_-]*-(service|api|db|job|worker|gateway|warehouse)\b/g

/**
 * Validate references in skill output against the provided context.
 *
 * "Known" set = union of:
 *   - ctx.t1.orgCatalog.services keys (catalog)
 *   - all string fragments appearing in input (Claude is allowed to reference
 *     anything we gave it, even if it's not in catalog — that's source material,
 *     not invention)
 *
 * This pass-through-input approach prevents false positives like flagging
 * "orders-db" when it was provided as input.candidates[N].name.
 */
export function validateReferences(
  output: unknown,
  ctx: SkillContext,
  input?: unknown,
): ReferenceViolation[] {
  const violations: ReferenceViolation[] = []
  const knownServices = new Set<string>(Object.keys(ctx.t1?.orgCatalog?.services ?? {}))

  // Only run reference checks if we have catalog data to check against.
  // Without catalog, every reference looks "unknown" — false positives explode.
  if (knownServices.size === 0) {
    return []
  }

  const outputText = collectStrings(output).join(' ')
  const inputText = input !== undefined ? collectStrings(input).join(' ') : ''

  // ── Service names ────────────────────────────────────
  const outputMatches = new Set<string>(outputText.match(SERVICE_PATTERN) ?? [])
  const inputMatches = new Set<string>(inputText.match(SERVICE_PATTERN) ?? [])

  for (const svc of outputMatches) {
    // Allow if in catalog OR if it appeared in input (Claude was given it)
    if (knownServices.has(svc)) continue
    if (inputMatches.has(svc)) continue
    // Also allow if input contains the bare name as substring (handles
    // parenthetical decorations like "orders-db (PostgreSQL)")
    if (inputText.includes(svc)) continue

    violations.push({
      kind: 'service',
      value: svc,
      reason: `service "${svc}" not in catalog (${knownServices.size} known services) and not in input`,
    })
  }

  // Note: ticket ID + KB validation deliberately skipped here. The runner doesn't
  // have DB access; agents that care about ticket IDs (e.g. triage_incident
  // relatedChanges) can run their own targeted check post-runSkill.

  return violations
}

/**
 * Severity-aware verdict: are any of the violations bad enough to fail the call?
 *
 * v1 policy: ANY unknown service reference fails the call. Services are the
 * highest-stakes reference (drives blast-radius, routing, ownership). User-name
 * fuzziness gets a pass for now.
 */
export function violationsAreBlocking(violations: ReferenceViolation[]): boolean {
  return violations.some((v) => v.kind === 'service')
}
