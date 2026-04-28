# summarize_decision_impact

## Purpose
Compress an Approval's three impact strings (`decisionImpact.approve`, `.deny`, `.escalate`) — already populated by `support_approval_decision` at chain construction — into a *spoken-style* one-paragraph or one-line summary the user can ask for in chat. Different from `support_approval_decision` because it works from already-stored strings; it doesn't re-derive impact, it re-shapes existing impact for the conversational surface.

The skill **does not** decide. It does not modify the stored `decisionImpact`. It produces transient prose for chat.

## Kind
agentic

## Used by
- `ChatPanelAgent` ("summarize the impact of approving appr-001")
- `ContextualAssistantAgent` on approval detail / approvals page

## Inputs

```typescript
{
  approval: {
    id: string
    type: 'change' | 'access' | 'remediation' | 'escalation'
    title: string
    riskLevel: RiskLevel
    decisionImpact: {
      approve: string
      deny: string
      escalate: string
    }
    coApprovals: Array<{ role: string; name: string; status: string }>
    condition: string | null
  }
  format: 'one_line' | 'paragraph' | 'three_options'
  emphasize?: 'approve' | 'deny' | 'escalate' | null
}
```

## Outputs

```typescript
{
  summary: string                      // sized to format
  recommendedReadingOrder?: ['approve' | 'deny' | 'escalate']  // for three_options
}
```

## Context tiers consumed
- T1.a — identity
- T2 — approval (impact strings already present)
- T6 — user's actual question (so emphasis matches their concern)

## Prompt template

```
[T1.a — identity]

[T2 — approval]
{approval_summary}
Stored decision impact:
- approve: {decisionImpact.approve}
- deny: {decisionImpact.deny}
- escalate: {decisionImpact.escalate}

Co-approvers: {coApprovals_summary}
Condition: {condition_or_none}

[task]
Format: {format}
Emphasis (if any): {emphasize}

- one_line: ≤ 30 words. Names the most likely recommended path given the chain state.
- paragraph: 3-5 sentences. Conversational. Explains the trade-off.
- three_options: a one-liner per option, in suggested reading order.

Do NOT invent new consequences. The stored decisionImpact strings are the truth;
re-shape them.

Output strictly as JSON.
```

## Model
`claude-haiku-4-5-20251001` — small reshaping job, haiku is sufficient.

## Temperature
`0.3`

## Token budget
- Input: ≤ 2500
- Output: ≤ 400

## Failure modes

| Mode | Runner response |
|---|---|
| Output not valid JSON | `validation_failed`. Caller falls back to verbatim `decisionImpact.approve / deny / escalate`. |
| Output introduces consequences not in the stored impact | Detected by spot-check of "approve" / "deny" / "escalate" key phrases; if drift detected, return verbatim fallback and log warning. |

## Audit
None. Read-only conversational reshaping.

## Examples

**Input: format=one_line, no emphasis, approval appr-001:**
```json
{
  "summary": "Approve to advance chg-002 to executable state once freeze ends 04-30; deny returns it with a 7-day cooldown; escalate routes to senior tier."
}
```

**Input: format=paragraph, emphasize=approve:**
```json
{
  "summary": "Approving advances chg-002 to approved state. Engineer M. Liu will gain execute permission once active freeze frz-001 ends on 2026-04-30, with the maintenance window 02:00–04:00 UTC. The chain is currently 2 of 3, so this approval may be the final one — confirm with the remaining co-approver C. Davies before assuming completion. Denial returns the change with a 7-day cooldown; escalation routes to senior approvers."
}
```
