# draft_customer_response

## Purpose
Generate a customer-facing status update for an incident. Tone is honest, calm, no jargon, no internal system names unless they're in the customer's vocabulary. Returned as text; the user copies into the customer-facing channel (status page, email template, support reply).

The skill **does not** post to any channel. It does not mention engineer names, internal tickets, or specific technical root causes that the customer doesn't need.

## Kind
agentic

## Used by
- `ContextualAssistantAgent` on incident detail pages, on user request (engineer or IT)

## Inputs

```typescript
{
  incident: {
    incidentId: string
    title: string
    description: string                // internal — used as context, not echoed
    affectedService: string
    severity: IncidentSeverity
    status: IncidentStatus
    likelyIssueType: string            // internal phrasing
    customerImpactSummary?: string     // optional, author can pre-write this
  }
  channel: 'status_page' | 'support_reply' | 'email_blast' | 'social_media_short'
  intent: 'initial_acknowledgement' | 'investigating' | 'identified' | 'workaround_available' | 'resolved'
  customerContext?: {
    audienceType: 'all_customers' | 'enterprise_only' | 'specific_account'
    knownAffectedFeatures: string[]    // user-facing feature names, e.g. "checkout", "reporting dashboard"
  }
}
```

## Outputs

```typescript
{
  body: string                         // the prose, sized appropriately to channel
  subject?: string                     // for email channels
  toneCheck: 'pass' | 'review_recommended'
  toneNotes: string                    // why pass or what to review
}
```

## Context tiers consumed
- T1.a — identity, customer-facing tone constraint
- T2 — incident with author-provided customerImpactSummary if any
- T5 — current time (for "since" phrasing)

Skipped: T1.d (no internal names should leak), T3, T4.

## Prompt template

```
[T1.a — identity]
You are drafting customer-facing communication. Constraints:
- No internal system names unless the customer would already know them
- No engineer names
- No internal ticket IDs (incidentId is internal)
- No technical root cause unless the customer asked for it
- Calm, factual tone. No apologies that read as marketing. No promises about timing
  beyond what's known.

[T2 — incident excerpt]
Issue affects: {customerContext.knownAffectedFeatures}
Internal description (for your understanding only — do NOT echo verbatim):
{incident.description}
Severity (internal): {severity}
Author-provided customer impact summary (use as guidance):
{customerImpactSummary_or_none}

[channel]
Channel: {channel}
- status_page: 1-3 sentences, factual
- support_reply: 2-5 sentences, acknowledging the customer's specific report
- email_blast: subject + 4-7 sentences with structure
- social_media_short: 280 chars max

[intent]
Phase: {intent}
- initial_acknowledgement: confirm awareness, no estimate
- investigating: confirm scope, no fix yet
- identified: cause known, fix in progress, working on ETA
- workaround_available: describe workaround clearly
- resolved: confirm resolution, brief summary

[task]
Draft the response. After drafting, check tone:
- Does it reveal internal info that shouldn't ship? Mark review_recommended.
- Does it promise a timing the team didn't authorize? review_recommended.
- Does it apologize in a way that creates legal exposure? review_recommended.
Otherwise pass.

Output strictly as JSON.
```

## Model
`claude-sonnet-4-20250514`

## Temperature
`0.5` — slightly higher to allow tonal nuance.

## Token budget
- Input: ≤ 3000
- Output: ≤ 600

## Failure modes

| Mode | Runner response |
|---|---|
| Output not valid JSON | `validation_failed` |
| Body contains internal jargon (heuristic check post-hoc) | `toneCheck='review_recommended'`, body returned anyway with warning |
| Body exceeds channel limit | Truncated to limit; toneCheck='review_recommended' |

## Audit
- Skill itself: `agent_invocations` only.
- When user saves draft to incident: caller writes audit `customer_response_drafted`.

## Examples

**Channel: status_page, intent: investigating, feature: checkout:**
```json
{
  "body": "We're investigating elevated error rates affecting checkout. Some customers may be unable to complete payment at this time. Our engineering team is engaged and we'll post an update within 30 minutes.",
  "toneCheck": "pass",
  "toneNotes": "Factual, no internal terms, no over-promised timing. References checkout (customer-facing) rather than payment-service (internal name)."
}
```
