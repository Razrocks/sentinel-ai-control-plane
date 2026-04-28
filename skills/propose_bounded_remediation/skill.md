# propose_bounded_remediation

## Purpose
Given an incident, produce a **proposed change artifact** that — if accepted by the engineer — becomes a real Change row entering WF-CHG. The proposal is *bounded*: single service, single change-type (config / restart / rollback), single environment, with an estimated blast radius and a rollback plan.

The skill **does not** create the Change. The user accepts via UI; the frontend creates the Change. The skill **does not** auto-execute. v1 is Tier-1 (human-initiated); Tier-3 autonomous remediation is gated on Phase 11.

## Kind
agentic

## Used by
- `RemediationDrafterAgent` (engineer/IT triggers from incident detail page)

## Inputs

```typescript
{
  incident: { /* full Incident with triage output */ }
  authorContext: {
    name: string
    role: UserRole
    team: string
    systemsOwned: string[]
  }
  intent: 'rollback' | 'config_change' | 'restart' | 'failover' | 'auto_choose'
  freeFormHint?: string                // engineer's optional written intent
}
```

## Outputs

```typescript
{
  proposed: {
    title: string                      // suitable as Change.title
    description: string                // 4-8 sentences, suitable as Change.description
    targetService: string              // exactly one
    environment: string                // exactly one — usually production
    changeType: 'rollback' | 'config_change' | 'restart' | 'failover'
    estimatedRiskLevel: RiskLevel
    estimatedBlastRadius: Array<{ name: string; type: string; reason: string }>
    rollbackPlan: string               // 2-4 sentences
    rollbackTested: boolean            // whether the proposal claims tested rollback
    suggestedMaintenanceWindow: string | null   // ISO range or null for "execute now"
  }
  rationale: string                    // why this remediation, why not others
  dependencies: string[]               // human-readable prerequisites
  warnings: Array<{ severity: 'info' | 'warn' | 'block'; note: string }>
  confidence: number
}
```

The output schema is **strict**. Outputs that violate "single service / single environment / single changeType" → `validation_failed`. The bounded shape is the safety guarantee.

## Context tiers consumed
- T1.a, T1.b, T1.d — identity, policy, catalog
- T2 — incident + triage output
- T4 — recent deploys on the incident's service (last 7d) — used to identify rollback candidates
- T5 — active freezes touching the service

## Prompt template

```
[T1.a — identity]
You are drafting a bounded remediation proposal. The proposal:
- targets exactly one service
- in exactly one environment
- using exactly one change-type
- with an estimated blast radius and a rollback plan
You DO NOT create the change. You DO NOT execute. The output is a draft.

[T1.b — policy bundle]
[T1.d — service catalog]

[T2 — incident with triage]
{incident_with_triage}

[T4 — recent deploys on affected service]
{recent_deploys_table}

[T5 — temporal]
Active freezes: {active_freezes}

[author]
{name} ({role}, {team}). Systems owned: {systemsOwned}.
Intent: {intent}
Free-form hint: {freeFormHint_or_none}

[task]
Propose ONE bounded remediation. Decide:
- targetService (must be one of authorContext.systemsOwned, OR incident.affectedService
  if author has cross-team authority)
- environment (production unless incident is staging)
- changeType (rollback / config_change / restart / failover)
- estimated risk + blast radius
- rollback plan (with tested-on-staging assertion if true)
- suggested maintenance window (or null for "execute now" if low risk)

If the proposed remediation cannot satisfy "bounded" (e.g. requires changes across
services), do NOT relax the constraint. Instead, return warnings explaining why the
incident requires a multi-service approach and propose only the first-step single-service
change.

Output strictly as JSON.
```

## Model
`claude-sonnet-4-20250514`

## Temperature
`0.2`

## Token budget
- Input: ≤ 6000
- Output: ≤ 1200

## Failure modes

| Mode | Runner response |
|---|---|
| Output not valid JSON | `validation_failed` |
| Multiple services in `targetService` (separator detected) or in `estimatedBlastRadius` flagged as primary | `validation_failed`. Bounded scope is non-negotiable. |
| `changeType` outside enum | `validation_failed` |
| Output references a service not in author's `systemsOwned` AND not the incident's `affectedService` | `validation_failed`. Author cannot remediate someone else's service. |
| Missing rollback plan | `validation_failed` |

## Audit
- Skill: `agent_invocations` only.
- When user accepts and creates the Change: caller writes audit `remediation_proposed` and the new Change's `change_filed` event.

## Examples

**Input intent: rollback, sev2 incident on payment-service after CHG-2026-001 deploy:**
```json
{
  "proposed": {
    "title": "Rollback CHG-2026-001 on payment-service",
    "description": "Revert payment-service to the binary deployed before CHG-2026-001 (timestamp 2026-04-28T14:18Z). Restores prior order-api integration code. Schema is unchanged (CHG-2026-001 was code-only). Targets resolution of elevated 5xx errors observed since deploy.",
    "targetService": "payment-service",
    "environment": "production",
    "changeType": "rollback",
    "estimatedRiskLevel": "medium",
    "estimatedBlastRadius": [
      {"name": "payment-service", "type": "service", "reason": "Direct rollback target"},
      {"name": "order-api", "type": "api", "reason": "Will see prior interface version; backward compatible"}
    ],
    "rollbackPlan": "If the rollback itself causes regressions, re-deploy CHG-2026-001's binary. Both versions are available in the artifact registry. Rollback-of-rollback estimated at 4 minutes.",
    "rollbackTested": false,
    "suggestedMaintenanceWindow": null
  },
  "rationale": "Rollback chosen over config-change because the symptom (elevated 5xx) appeared exactly at deploy time and no relevant config changed. Restart was considered and rejected — symptoms persist across pod recycles, indicating code, not state.",
  "dependencies": ["Confirm with on-call J. Wu before applying", "Verify rollback path in artifact registry"],
  "warnings": [
    {"severity": "info", "note": "Rollback has not been tested on staging since the deploy was applied directly. Recommend a staging dry-run before applying to production unless severity warrants direct action."}
  ],
  "confidence": 0.81
}
```
