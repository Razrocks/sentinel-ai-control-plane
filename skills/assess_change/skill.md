# assess_change

## Purpose
Read a Change row and its body (title, description, owner, service, environment, linkedPRs, ciStatus, maintenanceWindow, rollbackPlan flag) and produce a risk classification + a one-paragraph rationale + a confidence score. The skill **does not** decide policy, set status, or write to the database. It returns a structured advisory; the calling service applies it.

This skill exists because the intake-time `riskLevel` set by humans or upstream systems is often coarse (defaulted to `medium`) and the change body usually contains stronger signal — schema migrations, payment touch, multi-region scope, freeze-window proximity. The skill compresses that signal into a single revised risk level + the reasoning so a reviewer can audit it.

## Kind
agentic

## Used by
- `ChangeTriageAgent` (autonomous, at change intake — `services/change-assessment/intake.ts`)
- `ContextualAssistantAgent` on demand from the change detail page (re-run by user request)

## Inputs

```typescript
{
  change: {
    id: string
    ticketId: string
    title: string
    description: string
    owner: string
    ownerTeam: string
    service: string
    environment: string
    riskLevel: RiskLevel              // intake-time value
    linkedPRs: string[]
    ciStatus: 'passing' | 'failing' | 'pending'
    maintenanceWindow: string | null
    maintenanceWindowStart: string | null
    maintenanceWindowEnd: string | null
    rollbackPlan: boolean
  }
  // Auxiliary signals the runner attaches:
  prSummaries?: Array<{ url: string; title: string; filesChanged: number; additions: number; deletions: number }>
  recentDeploysOnService?: Array<{ ticketId: string; deployedAt: string; result: 'success' | 'rolled_back' }>
}
```

All fields except `prSummaries` and `recentDeploysOnService` required. Auxiliary signals improve quality but are not mandatory.

## Outputs

```typescript
{
  riskLevel: 'critical' | 'high' | 'medium' | 'low'
  summary: string                    // 1–2 sentences, plain English, what the change is
  riskRationale: string              // 2–4 sentences explaining WHY the risk class was chosen
  confidence: number                 // 0.0 – 1.0, the model's own confidence in the assessment
  signals: Array<{                   // contributing factors, structured for UI display
    kind: 'service' | 'data' | 'scope' | 'timing' | 'reversibility' | 'history'
    severity: 'positive' | 'neutral' | 'negative'
    note: string
  }>
}
```

Validation is strict. Missing fields, wrong types, or `riskLevel` outside the enum → status `validation_failed`. The runner records the raw response in `agent_invocations.error_message` for debugging.

## Context tiers consumed
- T1.a — Sentinel identity, hard constraints
- T1.b — Active policy bundle (so the skill knows which scopes are tightly scrutinized)
- T1.d — Service catalog (to know that `payment-service` is owned by Payments team and is in the criticality-1 tier)
- T2 — The change itself
- T5 — Active freeze windows + maintenance window timing relative to now (to surface timing risk)

Skipped: T3 (autonomous skill, no conversation), T4 (audit history not needed for risk), T6 (no per-turn user message — this is a system-triggered call).

## Prompt template

```
[T1.a — identity]
You are an assistant for a policy-enforced operational control plane. You help reviewers
classify operational changes by risk. You never approve, never decide policy, never write
to the database. Your output is advisory only.

[T1.b — policy bundle]
Active policy rules relevant to changes:
- production-write-guard: blocks writes during pending approval
- freeze-window-overlap: blocks during active freeze
- (... rule list ...)

[T1.d — service catalog excerpt]
Service: {change.service}
  - Owners: {owner_list}
  - Team: {team}
  - Criticality: {tier}
Adjacent services (downstream): {neighbors}

[T2 — entity]
Change ticket: {change.ticketId}
Title: {change.title}
Owner: {change.owner} ({change.ownerTeam})
Environment: {change.environment}
Description:
{change.description}

Linked PRs: {pr_summaries_or_count}
CI status: {change.ciStatus}
Rollback plan: {change.rollbackPlan ? "documented" : "MISSING"}
Maintenance window: {window_or_none}

[T5 — temporal]
Current time: {now}
Active freeze windows touching this service: {active_freezes_or_none}
Maintenance window starts in: {delta_or_n/a}
Recent deploys on this service (last 30d):
{recent_deploys_table}

[task]
Classify the risk of this change as exactly one of: critical, high, medium, low.
Provide a 1-2 sentence summary, a 2-4 sentence rationale, your confidence (0.0–1.0),
and a list of contributing signals.

Output strictly as JSON matching this schema:
{ riskLevel, summary, riskRationale, confidence, signals: [{kind, severity, note}] }

Risk class definitions:
- critical: production data loss possible; or affects multiple services; or no rollback;
  or schema change with active traffic
- high: production write to a critical-tier service; or large blast radius; or in-flight
  during freeze window; or rollback is risky
- medium: production write to non-critical service with rollback; or staging change
  affecting many users; or known-fragile area
- low: read-only; or staging-only; or contained-blast configuration change with rollback
```

## Model
`claude-sonnet-4-6`

## Temperature
`0.1` — risk classification must be reproducible across runs.

## Token budget
- Input: ≤ 6000 tokens (T1 ~2500, T2 ~1500, T5 ~500, prompt scaffolding ~500, headroom)
- Output: ≤ 600 tokens

## Failure modes

| Mode | Runner response |
|---|---|
| Output not valid JSON | `status='validation_failed'`, change retains intake `riskLevel` |
| `riskLevel` not in enum | `status='validation_failed'`, change retains intake `riskLevel` |
| Skill returns lower risk than intake | Caller (ChangeTriageAgent) keeps the higher value (defensive). The rationale is still recorded for reviewer comparison. |
| Anthropic API error | `status='error'`, intake proceeds without revised risk |
| Token budget exceeded on input | Runner truncates T5 first, then `prSummaries`. T1.a, T1.b, T2 never truncated. |

## Audit
On the calling service path, this skill produces an audit event:
- `action="change_assessed"`
- `objectType="change"`, `objectId={change.id}`, `objectTitle={change.ticketId}: {change.title}`
- `result="success"` or `"blocked"` (validation_failed)
- `details` includes the rationale string
- `agentInvocation.audit_event_id` linked to the row

## Examples

**Input (truncated):**
```json
{
  "change": {
    "ticketId": "CHG-2026-002",
    "title": "Add nullable column to payment_methods table",
    "service": "payment-service",
    "environment": "production",
    "riskLevel": "medium",
    "rollbackPlan": true,
    "maintenanceWindowStart": "2026-04-30T02:00:00Z",
    "maintenanceWindowEnd": "2026-04-30T04:00:00Z"
  }
}
```

**Output:**
```json
{
  "riskLevel": "high",
  "summary": "Adds a nullable column to the payment_methods schema, deploying in a 2-hour maintenance window.",
  "riskRationale": "Schema migration on a critical-tier payment service warrants high risk despite the nullable-column being technically safe — the surface area is the financial transaction path. Rollback plan is documented but the maintenance window overlaps active freeze frz-001 (Q1 close), creating a secondary policy concern. CI is passing; recent deploy history on this service is clean.",
  "confidence": 0.78,
  "signals": [
    {"kind": "data", "severity": "negative", "note": "Schema change on payment_methods table"},
    {"kind": "service", "severity": "negative", "note": "payment-service is criticality-1 tier"},
    {"kind": "reversibility", "severity": "positive", "note": "Rollback plan documented"},
    {"kind": "timing", "severity": "negative", "note": "Maintenance window overlaps active freeze frz-001"},
    {"kind": "history", "severity": "positive", "note": "Last 5 deploys on this service all clean"}
  ]
}
```
