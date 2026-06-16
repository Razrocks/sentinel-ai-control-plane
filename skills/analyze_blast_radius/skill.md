# analyze_blast_radius

## Purpose
Given a Change and its surrounding context (linked PRs, file diffs, service dependency graph), enumerate the downstream entities likely to be affected by the change — services, databases, APIs, queues, jobs, monitoring integrations. Each affected entity gets a confidence score, a criticality, and a one-line reason.

The skill **does not** decide if the change is allowed; it produces the *map* a human or another skill consults. Discovery (walking dependency graphs, listing CI dependencies) is done by a deterministic service before the skill runs; this skill *classifies and explains* the discovered candidates.

## Kind
agentic

## Used by
- `ChangeTriageAgent` (autonomous, at change intake — runs after `assess_change`)
- `ContextualAssistantAgent` on demand from the change detail page

## Inputs

```typescript
{
  change: { /* full Change as in assess_change */ }
  candidates: Array<{
    name: string
    type: 'service' | 'database' | 'api' | 'queue' | 'job' | 'monitoring' | 'integration'
    sourceOfDiscovery: 'pr_files' | 'service_catalog' | 'recent_audit' | 'manual'
    rawSignal: string                // why discovery surfaced it
    ownerTeam?: string
  }>
  serviceCatalogSnippet: Record<string, { team: string; criticality: 'critical'|'high'|'medium'|'low'; downstream: string[] }>
}
```

`candidates` is the deterministic discovery output. The skill's job is to filter, classify, and explain — not to invent new entries. **Outputs that include items not in `candidates` → validation_failed.**

## Outputs

```typescript
{
  items: Array<{
    name: string                     // must match a candidate.name
    type: 'service' | 'database' | 'api' | 'queue' | 'job' | 'monitoring' | 'integration'
    reason: string                   // 1 sentence, why the change touches this
    confidence: 'high' | 'medium' | 'low'
    criticality: 'critical' | 'high' | 'medium' | 'low'
    ownerTeam: string
    details: string                  // 2-3 sentences elaborating reason and impact
  }>
  excluded: Array<{
    name: string
    reason: string                   // why this candidate was filtered out (false positive)
  }>
  notes: string                      // optional, free text for caveats / unknowns
}
```

`items.length + excluded.length === candidates.length`. Strict.

## Context tiers consumed
- T1.a, T1.d — identity + service catalog
- T2 — change body, linkedPRs
- T4 — recent audit slice on the same service (last 30 days), to detect if any candidate is a known false-positive
- T5 — none directly; caller may pre-filter timing-sensitive candidates

Skipped: T3.

## Prompt template

```
[T1.a — identity, advisory-only constraint]

[T1.d — service catalog excerpt]
For each affected service candidate, the catalog tells you:
- ownerTeam
- criticality tier
- declared downstream dependencies

[T2 — change]
Change ticket, title, description, linkedPRs.
File diffs (truncated): {file_diffs_or_summary}

[discovered candidates]
The discovery service surfaced these candidates:
{candidates_table}

For each candidate, decide:
1. Is this genuinely affected by the change? (item / excluded)
2. If item: classify confidence (high/medium/low) and criticality.
   Confidence is YOUR confidence the change touches it.
   Criticality is the candidate's own importance (from catalog if known).
3. Write a 1-sentence reason and 2-3 sentence details.

[task]
Output strictly as JSON. Do not invent candidates. Every input candidate must appear in
either items or excluded. items.length + excluded.length must equal candidates.length.
```

## Model
`claude-sonnet-4-6`

## Temperature
`0.1`

## Token budget
- Input: ≤ 7000 tokens (file diffs can be large; truncate above 3000 tokens of diff)
- Output: ≤ 1500 tokens

## Failure modes

| Mode | Runner response |
|---|---|
| Output references a name not in `candidates` | `validation_failed`. Caller proceeds with discovery output classified as `medium/medium`. |
| items + excluded count mismatch | `validation_failed` |
| `type` for an item disagrees with the catalog | Logged as warning; the catalog's value wins (caller overwrites). |
| API error | `status='error'`. ChangeTriageAgent records empty `blastRadius[]` and an audit note that analysis was unavailable. |

## Audit
- `action="blast_radius_computed"`
- `result="success"` or `"blocked"`
- `details` summarizes "{N} affected entities, {M} excluded"

## Examples

**Input (heavily truncated):**
```json
{
  "change": { "ticketId": "CHG-2026-002", "service": "payment-service" },
  "candidates": [
    {"name": "payment-service", "type": "service", "sourceOfDiscovery": "service_catalog", "rawSignal": "primary"},
    {"name": "payment_methods_db", "type": "database", "sourceOfDiscovery": "pr_files", "rawSignal": "ALTER TABLE in migration"},
    {"name": "order-api", "type": "api", "sourceOfDiscovery": "service_catalog", "rawSignal": "downstream of payment-service"},
    {"name": "fraud-detection", "type": "service", "sourceOfDiscovery": "service_catalog", "rawSignal": "downstream"},
    {"name": "billing-monthly-job", "type": "job", "sourceOfDiscovery": "service_catalog", "rawSignal": "queries payment_methods"}
  ]
}
```

**Output:**
```json
{
  "items": [
    {
      "name": "payment-service",
      "type": "service",
      "reason": "Primary target of the schema migration.",
      "confidence": "high",
      "criticality": "critical",
      "ownerTeam": "Payments",
      "details": "Schema change adds a nullable column. The service must be redeployed alongside the migration to avoid mismatched ORM versions. Rollback requires reverting both the migration and the binary."
    },
    {
      "name": "payment_methods_db",
      "type": "database",
      "reason": "Direct schema target.",
      "confidence": "high",
      "criticality": "critical",
      "ownerTeam": "Payments",
      "details": "ALTER TABLE adds a nullable column. Locks are minimal but the schema-version table is updated, briefly visible to read replicas."
    },
    {
      "name": "billing-monthly-job",
      "type": "job",
      "reason": "Reads payment_methods on a schedule.",
      "confidence": "medium",
      "criticality": "high",
      "ownerTeam": "Billing",
      "details": "The monthly billing job queries payment_methods. Adding a nullable column is backward compatible, but the next job run will see the new column. No code changes needed."
    }
  ],
  "excluded": [
    {"name": "order-api", "reason": "Downstream of payment-service but does not query payment_methods directly."},
    {"name": "fraud-detection", "reason": "Reads from a separate fraud_signals table, not payment_methods."}
  ],
  "notes": "billing-monthly-job confidence is medium because the job's source code wasn't read directly; classification is from service catalog declaration."
}
```
