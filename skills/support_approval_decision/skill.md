# support_approval_decision

## Purpose
Given an Approval and its linked entity, produce three short impact statements — what happens on **approve**, on **deny**, on **escalate**. These populate `Approval.decisionImpact` so the human approver sees the consequences of each option in the UI without computing them mentally.

The skill **does not** decide the approval. It does not write `decisionImpact` directly; it returns the strings, and the calling service persists them.

## Kind
agentic

## Used by
- `ApprovalRouterAgent` (called by `services/approval-chain.ts` when constructing a new Approval row)

## Inputs

```typescript
{
  approval: {
    id: string
    type: 'change' | 'access' | 'remediation' | 'escalation'
    title: string
    requester: string
    impactedSystem: string
    riskLevel: RiskLevel
    reason: string
    recommendedAction: string
    linkedObjectId: string
    coApprovals: Array<{ role: string; name: string; status: 'approved' | 'pending' | 'denied' }>
  }
  linkedEntity: { type: string; data: any }   // Change | AccessRequest | Incident
  policyContext: {
    activePolicyRules: Array<{ name: string; description: string; decision: PolicyDecision }>
    activeFreezesAffecting: string[]
  }
}
```

## Outputs

```typescript
{
  approve: string                     // 1-2 sentences, what happens if approved
  deny: string                        // 1-2 sentences, what happens if denied
  escalate: string                    // 1-2 sentences, what happens if escalated
  whyEachApproverIsRequired: Array<{
    role: string
    name: string
    why: string                       // 1 sentence per co-approver
  }>
}
```

## Context tiers consumed
- T1.a, T1.b, T1.d — identity, policy, catalog
- T2 — approval + linked entity
- T5 — current freeze posture

## Prompt template

```
[T1.a — identity]
[T1.b — policy bundle, relevant rules]
[T1.d — service catalog — owners of impactedSystem]

[T2 — approval]
Approval: {approval.id}, type {approval.type}
Linked entity: {linkedEntity.type} {linkedEntity.data.id}
Impacted system: {approval.impactedSystem}
Risk: {approval.riskLevel}
Reason: {approval.reason}
Recommended action: {approval.recommendedAction}

Co-approvers in chain:
{co_approvers_table}

[T2 — linked entity excerpt]
{relevant_fields}

[T5 — temporal]
Active freezes touching impactedSystem: {yes/no — list}

[task]
Produce three short impact statements:
- approve: 1-2 sentences. What state transitions, what becomes possible, what timing applies.
- deny: 1-2 sentences. What returns to the requester, any cooldown, any escalation path.
- escalate: 1-2 sentences. Where does it go, what does the requester see.

Also produce a per-co-approver "why required" string explaining their specific role.

Output strictly as JSON.
```

## Model
`claude-sonnet-4-20250514`

## Temperature
`0.2`

## Token budget
- Input: ≤ 4000
- Output: ≤ 500

## Failure modes

| Mode | Runner response |
|---|---|
| Output not valid JSON | `validation_failed`. Approval row persists with empty decisionImpact; UI shows "decision impact unavailable". |
| Output missing one of approve/deny/escalate | `validation_failed`. |
| `whyEachApproverIsRequired` length ≠ coApprovals.length | `validation_failed`. |

## Audit
- `action="decision_impact_generated"`
- `objectType="approval"`
- `result="success"` or `"blocked"`
- `details` is brief: "decisionImpact generated for {approval.id}"

## Examples

**Output sample (for chg-002 approval):**
```json
{
  "approve": "chg-002 enters approved state. Engineer M. Liu gains execute permission once active freeze frz-001 (Q1 close) ends 2026-04-30. Maintenance window 2026-04-30 02:00–04:00 UTC remains in force.",
  "deny": "chg-002 returns to filer with denial rationale. The change cannot be re-submitted with an identical body for 7 days under policy 'change-resubmit-cooldown'. Filer can revise and re-file.",
  "escalate": "chg-002 moves to senior-approver tier. Requires sign-off from at least one Director-level approver in addition to the current chain. No auto-approval path.",
  "whyEachApproverIsRequired": [
    {"role": "SRE-Owner", "name": "J. Wu", "why": "Owns the SRE function for payment-service and signs off on production deploys to that tier."},
    {"role": "Database-Owner", "name": "C. Davies", "why": "Owns the database tier; required because this change includes a schema migration."},
    {"role": "Risk-Compliance", "name": "M. Patel", "why": "Required for high-risk changes overlapping active freeze windows; signs off on the compliance posture."}
  ]
}
```
