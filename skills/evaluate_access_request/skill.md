# evaluate_access_request

## Purpose
Read an Access Request and produce a risk classification, justification quality assessment, and a structured narrative explaining what's eligible/ineligible/marginal. The skill **does not** decide the entitlement check (that is deterministic, run by `services/access-eval/entitlement.ts`); it **does not** grant access; it **does not** route the chain (that is `route_request`'s job). It produces the *risk and quality lens* that informs the policy decision and the human approvers.

## Kind
agentic

## Used by
- `AccessReviewerAgent` (autonomous, at access-request intake — `services/access-eval/intake.ts`)

## Inputs

```typescript
{
  request: {
    id: string
    requestId: string
    requester: string
    requesterEmail: string
    requestedSystem: string
    requestedRole: string
    justification: string
    manager: string
    systemOwner: string
    riskLevel: RiskLevel              // intake-time, often default
    entitlementCheck: 'eligible' | 'ineligible' | 'review_required'
  }
  requesterContext: {
    role: UserRole                    // current sentinel role
    team: string
    managerId: string | null
    systemsOwned: string[]
    pastRequests: Array<{ requestId: string; system: string; role: string; status: string; resolvedAt: string }>
  }
  systemContext: {
    catalogTier: 'critical' | 'high' | 'medium' | 'low'
    rolePrivilegeLevel: 'read' | 'write' | 'admin'
    activeFreezeAffectingSystem: boolean
  }
}
```

## Outputs

```typescript
{
  riskLevel: 'critical' | 'high' | 'medium' | 'low'
  justificationQuality: 'strong' | 'adequate' | 'weak' | 'insufficient'
  narrative: string                   // 3-5 sentences, the "why" the human approvers need
  flags: Array<{
    kind: 'unusual_role' | 'unusual_system' | 'time_bounded_recommended' | 'scope_too_broad' | 'recent_denial' | 'no_prior_history' | 'freeze_active'
    severity: 'info' | 'warn' | 'block'
    note: string
  }>
  recommendedTimeBound: string | null  // ISO duration, e.g. "P30D", or null if no bound suggested
  confidence: number
}
```

## Context tiers consumed
- T1.a, T1.b, T1.c, T1.d — identity, policy bundle (auto-grant rules), role constraints, org catalog
- T2 — request + requester context + system context
- T4 — past requests by this user (last 90d) for pattern detection
- T5 — active freezes touching the system

Skipped: T3.

## Prompt template

```
[T1.a — identity, advisory-only]
[T1.b — policy bundle, auto-grant rules]
[T1.d — org catalog excerpt — requester's manager + the system's owners]

[T2 — request]
Request: {requestId}
Requester: {requester} ({requesterContext.role}, {requesterContext.team})
Requested: {requestedRole} on {requestedSystem}
Justification: {justification}
Entitlement check: {entitlementCheck}

[T2 — requester context]
Manager: {managerName_resolved_or_unknown}
Systems already owned: {systemsOwned}
Past requests (last 90d):
{past_requests_table}

[T2 — system context]
{requestedSystem} — tier {catalogTier}, role privilege {rolePrivilegeLevel}.
Active freeze touching this system: {yes/no}

[task]
Evaluate:
1. Risk level (consider system tier × role privilege × requester history × freeze)
2. Justification quality (strong/adequate/weak/insufficient)
3. Flags worth surfacing to approvers
4. Whether a time-bound is recommended (and what duration)

Output strictly as JSON.
```

## Model
`claude-sonnet-4-6`

## Temperature
`0.1`

## Token budget
- Input: ≤ 5000
- Output: ≤ 500

## Failure modes

| Mode | Runner response |
|---|---|
| Output not valid JSON | `validation_failed`. Caller retains intake riskLevel, no narrative. |
| `recommendedTimeBound` not parseable as ISO 8601 duration when non-null | Set to null, warning logged. |
| Skill suggests risk lower than intake | Caller keeps the higher value. Narrative still shown. |

## Audit
- `action="access_evaluated"`
- `result="success"` or `"blocked"`
- `details` summarizes risk + quality

## Examples

**Output sample:**
```json
{
  "riskLevel": "high",
  "justificationQuality": "adequate",
  "narrative": "Requester is an engineer on the Payments team requesting read_admin on the customer-data-warehouse for a Q2 reporting initiative. The role grants read across PII fields. Justification names the project but does not specify scope (which tables, what duration). Requester has no prior access to this system. Recommended time-bound is 30 days to align with quarterly reporting cycle.",
  "flags": [
    {"kind": "unusual_system", "severity": "warn", "note": "First-time access for this requester to customer-data-warehouse"},
    {"kind": "scope_too_broad", "severity": "warn", "note": "Justification mentions reporting but doesn't list specific datasets needed"},
    {"kind": "time_bounded_recommended", "severity": "info", "note": "Time-bound recommended given high system tier and one-off project"}
  ],
  "recommendedTimeBound": "P30D",
  "confidence": 0.74
}
```
