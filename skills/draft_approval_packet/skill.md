# draft_approval_packet

## Purpose
Generate a structured **approval packet** for a Change — the document an approver reads before deciding. Compresses the change body, blast radius, recommendations, policy posture, and approval-chain status into a one-page brief. Returned as structured sections; the UI can render or export as PDF/markdown.

The skill **does not** decide the approval. It does not transition state.

## Kind
agentic

## Used by
- `ContextualAssistantAgent` on change detail pages, on user request (engineer drafting their own packet, or approver requesting a digest)

## Inputs

```typescript
{
  change: { /* full Change with relations: blastRadius, recommendations */ }
  approval: { /* the linked Approval with coApprovals, decisionImpact */ } | null
  policyContext: {
    policyDecision: PolicyDecision
    matchedRule: string | null
    activeFreezesAffecting: string[]
  }
  audience: 'self_review' | 'peer_review' | 'approver_review'
}
```

## Outputs

```typescript
{
  title: string                       // 1 line, e.g. "Approval Packet — CHG-2026-002"
  oneLineSummary: string              // the elevator pitch
  sections: {
    whatChanges: string               // 3-5 sentences, plain language
    whyNow: string                    // 2-3 sentences, business reason + timing
    blastRadiusSummary: string        // 3-5 sentences, what's affected
    riskPosture: string               // 2-3 sentences, risk level + rationale
    rollbackPlan: string              // 2-3 sentences, what happens if it goes wrong
    policyPosture: string             // 2-3 sentences, policy + freeze + maintenance window
    approvalChain: string             // 2-3 sentences, who's signing off and why
    openQuestions: string             // optional, things the approver should ask
  }
  recommendation: 'approve' | 'approve_with_condition' | 'investigate_further' | 'deny'
  recommendationRationale: string
}
```

## Context tiers consumed
- T1.a, T1.b, T1.d — identity, policy, catalog
- T2 — change + relations + approval (with coApprovals and decisionImpact pre-populated)
- T5 — active freezes + maintenance window timing

## Prompt template

```
[T1.a — identity, drafting role, advisory]
[T1.b — policy bundle, rules touching changes]
[T1.d — service catalog]

[T2 — change with relations]
{full_change_json}
{blast_radius_table}
{recommendations_table}

[T2 — approval]
{approval_json_with_coApprovals_and_decisionImpact}
{or "no approval row exists yet" if approval is null}

[T2 — policy]
Decision: {policyDecision}
Matched rule: {matchedRule}
Active freezes affecting this change: {freezes}

[T5 — temporal]
Now: {now}
Maintenance window: {start} – {end} ({hours_until} hours from now)

[audience]
{audience}
- self_review: thorough, includes self-criticism, suggests improvements
- peer_review: assumes some context; focuses on areas of concern
- approver_review: brief, decision-supporting

[task]
Produce a structured approval packet. Each section is 2-5 sentences.
Recommendation must be one of: approve, approve_with_condition, investigate_further, deny.
Recommendation must be advisory only — make clear it's not a decision.

Output strictly as JSON.
```

## Model
`claude-sonnet-4-20250514`

## Temperature
`0.3`

## Token budget
- Input: ≤ 8000 (changes with full blast radius can be large)
- Output: ≤ 1500

## Failure modes

| Mode | Runner response |
|---|---|
| Output not valid JSON | `validation_failed` |
| Missing required sections | `validation_failed` |
| `recommendation` outside enum | `validation_failed` |
| Sections exceed length budget | Truncated; flagged in audit details |

## Audit
- Skill itself: `agent_invocations` only.
- When user saves packet: caller writes audit `approval_packet_drafted`.

## Examples

**Output sample (truncated):**
```json
{
  "title": "Approval Packet — CHG-2026-002",
  "oneLineSummary": "Add a nullable column to the payment_methods table during a 2-hour maintenance window — high risk due to service tier and overlap with active freeze.",
  "sections": {
    "whatChanges": "Adds one nullable VARCHAR column to payment_methods table to support upcoming loyalty integration. Schema migration is forward-compatible: existing reads and writes are unaffected. Rollback re-deploys the prior schema-version artifact and runs DROP COLUMN.",
    "whyNow": "Loyalty integration ships in Q3; the schema change is a prerequisite. Maintenance window 2026-04-30 02:00–04:00 UTC is the next low-traffic window for payment-service.",
    "blastRadiusSummary": "Primary: payment-service, payment_methods_db. Secondary: billing-monthly-job (reads payment_methods on schedule; backward-compatible). Excluded: order-api, fraud-detection — confirmed no direct dependency.",
    "riskPosture": "High risk despite technically safe migration: payment-service is criticality-1, the change is in active freeze window frz-001, and recovery requires both binary and migration revert.",
    "rollbackPlan": "Documented. Revert binary, run DROP COLUMN. Tested on staging 2026-04-22. Estimated rollback time: 8 minutes.",
    "policyPosture": "Policy decision: escalate. Matched rule: 'freeze-window-overlap'. Window frz-001 (Q1 close) is active until 2026-04-30 — change must execute strictly within the maintenance window or be rescheduled.",
    "approvalChain": "Three co-approvers required: SRE-Owner (J. Wu, approved), Database-Owner (C. Davies, pending), Risk-Compliance (M. Patel, approved). Chain advances when C. Davies decides.",
    "openQuestions": "Does the rollback drill cover the loyalty-loyalty-integration path that depends on this column? If not, suggest extending."
  },
  "recommendation": "approve_with_condition",
  "recommendationRationale": "Risk profile is acceptable given documented rollback and tested staging. Recommend conditioning approval on confirmation that the on-call has reviewed the rollback runbook within 4 hours of execution."
}
```
