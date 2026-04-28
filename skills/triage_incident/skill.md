# triage_incident

## Purpose
Read an incident at intake (or on re-run) and produce a structured triage: revised severity if intake was wrong, likely issue type, root cause category, recommended fix (advisory only), KB article matches, and related-change correlation. The skill **does not** transition incident state; that is the IT-support / engineer's job.

## Kind
agentic

## Used by
- `IncidentTriageAgent` (autonomous, at incident intake — `services/incident-triage/intake.ts`)
- `ContextualAssistantAgent` on demand for re-triage with new info

## Inputs

```typescript
{
  incident: {
    id: string
    incidentId: string
    title: string
    description: string
    requester: string
    affectedService: string
    severity: IncidentSeverity        // intake-time
    assignmentGroup: string
    relatedCI: string[]
    isRecurring: boolean
  }
  // Auxiliary signals attached by runner:
  recentDeploysOnService?: Array<{ ticketId: string; deployedAt: string; result: string }>
  recentIncidentsOnService?: Array<{ incidentId: string; rootCauseCategory: string; resolvedAt: string }>
  candidateKbArticles?: Array<{ id: string; title: string; snippet: string }>
}
```

## Outputs

```typescript
{
  severity: 'sev1' | 'sev2' | 'sev3' | 'sev4'
  severityChanged: boolean             // true if revised from intake
  severityRationale: string
  likelyIssueType: string              // free text, e.g. "elevated 5xx after deploy"
  rootCauseCategory: string            // controlled-ish vocabulary: "deploy-correlated" | "infra" | "data" | "config" | "external-dependency" | "unknown"
  recommendedFix: string               // advisory; 1-2 sentences
  kbArticles: Array<{ id: string; relevance: 'high'|'medium'|'low'; reason: string }>
  relatedChanges: string[]             // ticketIds, ranked by likelihood of correlation
  isRecurring: boolean                 // confirmed or refuted
  confidence: number                   // 0.0–1.0
}
```

## Context tiers consumed
- T1.a, T1.d — identity + service catalog (so triage knows the service tier and owners)
- T2 — incident body
- T4 — recent audit slice (deploys, recent incidents) for correlation
- T5 — current time vs deploy timestamps (for "deploy-correlated" inference)

Skipped: T3.

## Prompt template

```
[T1.a — identity, advisory only]
[T1.d — service catalog]

[T2 — incident]
Incident: {incidentId}
Title: {title}
Affected service: {affectedService}
Description: {description}
Reported by: {requester}
Intake severity: {severity}
Recurring flag at intake: {isRecurring}

[T4 — context]
Recent deploys on {affectedService} (last 7 days):
{deploys_table}
Recent incidents on {affectedService} (last 30 days):
{incidents_table}
Candidate KB articles surfaced by similarity search:
{kb_table}

[T5 — temporal]
Current time: {now}
Most recent deploy: {hours_ago}h ago — {ticketId}

[task]
Triage this incident. Decide:
- severity (revise if intake is wrong)
- likely issue type (free text)
- root cause category (deploy-correlated | infra | data | config | external-dependency | unknown)
- recommended fix (advisory)
- KB article relevance for each candidate
- which recent changes might be correlated (ranked)
- whether isRecurring is correct

Output strictly as JSON.
```

## Model
`claude-sonnet-4-20250514`

## Temperature
`0.1`

## Token budget
- Input: ≤ 6000
- Output: ≤ 700

## Failure modes

| Mode | Runner response |
|---|---|
| Output not valid JSON | `validation_failed`, incident retains intake severity, no recommended fix |
| `severity` outside enum | `validation_failed` |
| KB article ID not in input candidates | filtered out; runner records warning |
| `relatedChanges` references unknown ticket | filtered out |

## Audit
- `action="incident_triaged"`
- `result="success"` or `"blocked"`
- `details` summarizes severity, root cause category, related-change count

## Examples

**Output sample:**
```json
{
  "severity": "sev2",
  "severityChanged": true,
  "severityRationale": "Intake sev3 understates impact; payment-service 5xx affects checkout funnel for all customers.",
  "likelyIssueType": "Elevated 5xx errors on payment-service POST /charge endpoint",
  "rootCauseCategory": "deploy-correlated",
  "recommendedFix": "Roll back deploy CHG-2026-001 (deployed 12 minutes before incident open) and verify error rate normalizes.",
  "kbArticles": [
    {"id": "KB-0042", "relevance": "high", "reason": "Documents identical 5xx pattern after payment-service deploys"},
    {"id": "KB-0103", "relevance": "low", "reason": "General payment-service troubleshooting, not deploy-specific"}
  ],
  "relatedChanges": ["CHG-2026-001"],
  "isRecurring": false,
  "confidence": 0.82
}
```
