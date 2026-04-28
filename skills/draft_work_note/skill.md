# draft_work_note

## Purpose
Generate a short ServiceNow-style **work note** for an incident — internal-facing, factual, action-oriented. Captures what's known, what's being done, who's involved, when the next update is expected. Returned as text; the user copies or saves as a draft. The skill does **not** post the note anywhere.

## Kind
agentic

## Used by
- `ContextualAssistantAgent` on incident detail pages, on user request

## Inputs

```typescript
{
  incident: {
    id: string
    incidentId: string
    title: string
    description: string
    affectedService: string
    severity: IncidentSeverity
    status: IncidentStatus
    assignmentGroup: string
    likelyIssueType: string
    rootCauseCategory: string
    relatedChanges: string[]
    isRecurring: boolean
  }
  authorContext: {
    name: string
    role: UserRole
    team: string
  }
  intent: 'initial_triage' | 'investigation_update' | 'identified' | 'monitoring' | 'resolution'
  customNotes?: string                // optional free-text from the user to include
}
```

## Outputs

```typescript
{
  workNote: string                    // the prose note, 3-6 sentences
  nextUpdateTimeRecommended: string   // ISO duration, e.g. "PT15M" — when to post next update
  audience: 'on_call' | 'assignment_group' | 'incident_commander'
}
```

## Context tiers consumed
- T1.a, T1.d — identity + service catalog (owners, on-call team if known)
- T2 — incident
- T4 — last 3 work notes on this incident (if any) so the new one continues the narrative
- T5 — current time (for "since X minutes ago" phrasing)

## Prompt template

```
[T1.a — identity, drafting role, never posts]
[T1.d — owners of affectedService, on-call team]

[T2 — incident]
Incident: {incidentId}
Service: {affectedService}, severity {severity}, status {status}
Issue: {likelyIssueType}
Root cause category: {rootCauseCategory}
Related changes: {relatedChanges}
Recurring: {isRecurring}

[T4 — recent work notes on this incident]
{prior_notes_or_none}

[T5 — temporal]
Now: {now}
Incident opened: {opened_at}, {minutes_since} minutes ago

[author]
{authorContext.name} ({authorContext.role}, {authorContext.team})
Intent: {intent}
Custom notes from author: {customNotes_or_none}

[task]
Draft a work note. Tone: factual, concise, no marketing language, no apologies.
Structure:
- 1 sentence: current state
- 1-2 sentences: what's been investigated / changed since last update
- 1 sentence: who's involved
- 1 sentence: next update time

Recommend a next-update time (ISO duration). Sev1 → PT15M. Sev2 → PT30M.
Sev3/4 → PT2H or longer.

Pick audience: on_call (page-worthy), assignment_group (team-wide), incident_commander.

Output strictly as JSON.
```

## Model
`claude-sonnet-4-20250514`

## Temperature
`0.4`

## Token budget
- Input: ≤ 3500
- Output: ≤ 400

## Failure modes

| Mode | Runner response |
|---|---|
| Output not valid JSON | `validation_failed`. UI shows "draft unavailable, try again." |
| `nextUpdateTimeRecommended` not parseable as ISO duration | Default by severity: sev1→PT15M, sev2→PT30M, sev3→PT2H, sev4→PT4H. |
| Note exceeds 600 characters | Truncated with "…" appended; warning logged. Real ServiceNow work-note limit is higher but readability degrades fast above this. |

## Audit
This skill is human-initiated and the output is a draft, not a state change. Audit only when the user *saves* the draft (which is the calling service's job, not the skill's). The skill itself records `agent_invocations` only.

## Examples

**Input intent: investigation_update, sev2, payment-service 5xx, related to chg-001:**
```json
{
  "workNote": "Investigation continues on payment-service 5xx — error rate stable at ~3% since last update. Correlation with deploy CHG-2026-001 (15min before incident open) is being verified by Payments team; rollback decision pending review of metrics in the 14:30-14:45 window. Engineer M. Liu and SRE on-call J. Wu engaged. Next update at 14:45 UTC.",
  "nextUpdateTimeRecommended": "PT15M",
  "audience": "assignment_group"
}
```
