# explain_policy_decision

## Purpose
Render a human-readable explanation of a deterministic policy outcome. The policy engine has already decided (allow / deny / escalate / simulate_only) and named the matched rule; this skill produces the *prose* that helps the user understand *why*. It is the connective tissue between the deterministic verdict and the human reading the screen.

The skill **does not** decide policy. If asked to second-guess the policy verdict, it stays in its lane: it explains, it does not adjudicate.

## Kind
agentic

## Used by
- `ChatPanelAgent` ("why was this denied?")
- `ContextualAssistantAgent` (on detail pages, when user clicks "explain this denial")
- Surface in execution-blocked responses (when `routes/actions.ts` returns 403, frontend can call this skill to render a friendly explanation)

## Inputs

```typescript
{
  decision: 'allow' | 'deny' | 'escalate' | 'simulate_only'
  matchedRule: {
    name: string
    description: string
    bundle: string
    scope: string
    appliesTo: string[]
  } | null
  context: {
    objectType: 'change' | 'incident' | 'access' | 'execution' | 'approval'
    objectId: string
    objectTitle: string
    relevantFields: Record<string, any>     // small, hand-picked subset of the object
  }
  audience: {
    role: UserRole
    name: string
  }
  whatWouldUnblock?: string                  // optional pre-computed hint, e.g. "approval needed from C. Davies"
}
```

## Outputs

```typescript
{
  oneLineSummary: string              // plain-English single sentence
  ruleNameDisplay: string             // human-friendly rendering of matchedRule.name
  whyExplanation: string              // 2-4 sentences: why this rule applies to this object
  whatWouldUnblock: string            // 1-2 sentences: what would change the decision
  nextStep: string                    // 1 sentence: what the user can do (e.g. "wait for C. Davies", "request approval", "file an exception")
  tone: 'neutral' | 'firm'            // firm if the rule is hard policy, neutral if escalate
}
```

## Context tiers consumed
- T1.a, T1.b, T1.c — identity, full policy bundle, role-aware constraints
- T2 — the rule + the object's relevant fields
- T6 — the user's actual question if invoked from chat

Skipped: T3 (single-shot explanation), T4 (audit not needed), T5 (decision is already made).

## Prompt template

```
[T1.a — identity]
You explain policy decisions. You do not decide policy. The policy engine has already
decided. Your job is to make the decision understandable.

[T1.b — policy bundle, full]
[T1.c — role constraints for {audience.role}]

[the decision]
Decision: {decision}
Matched rule: {matchedRule.name or "no specific rule (default decision)"}
Rule description: {matchedRule.description}
Rule scope: {matchedRule.scope}
Bundle: {matchedRule.bundle}

[the object]
Type: {context.objectType} {context.objectId} — {context.objectTitle}
Relevant fields:
{relevantFields_table}

[audience]
{audience.name} ({audience.role})

[task]
Produce:
1. oneLineSummary — what happened, plain English
2. ruleNameDisplay — friendly rendering (e.g. "Production Write Guard" not "production-write-guard")
3. whyExplanation — why does this rule apply to this specific object?
4. whatWouldUnblock — 1-2 sentences. If pre-computed hint provided, refine it; otherwise reason about it.
5. nextStep — concrete user action
6. tone — "firm" for deny / hard policy, "neutral" for escalate / soft

Output strictly as JSON.
```

## Model
`claude-sonnet-4-20250514` (or `claude-haiku-4-5-20251001` for chat surfaces — explanation is bounded enough that haiku suffices in most cases)

## Temperature
`0.2`

## Token budget
- Input: ≤ 4000
- Output: ≤ 400

## Failure modes

| Mode | Runner response |
|---|---|
| Output not valid JSON | `validation_failed`. UI renders a fallback: "{decision} due to {matchedRule.name}." |
| `tone` outside enum | Default to "neutral", warning logged |
| `ruleNameDisplay` blank | Falls back to matchedRule.name as-is |

## Audit
This skill is read-only and informational. No audit event from the skill itself. The original policy evaluation already wrote its audit row.

## Examples

**Input: deny, rule="freeze-window-overlap", change CHG-2026-002, audience operator:**
```json
{
  "oneLineSummary": "Execution is blocked because an active freeze window overlaps the change's maintenance window.",
  "ruleNameDisplay": "Freeze Window Overlap",
  "whyExplanation": "Freeze window frz-001 (Q1 close) is active until 2026-04-30 and applies to all production changes. CHG-2026-002 has a maintenance window starting 2026-04-30 02:00 UTC, which begins inside the freeze. The rule blocks execution for any change whose window starts before the freeze ends.",
  "whatWouldUnblock": "Either wait until frz-001 ends (2026-04-30) and re-evaluate, or file an exception that an admin can review.",
  "nextStep": "Wait for the freeze window to end and re-attempt execution, or contact an admin to request an exception.",
  "tone": "firm"
}
```
