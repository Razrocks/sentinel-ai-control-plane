# route_request

## Purpose
Given an entity (change / access request / remediation / escalation) and the org-graph context, identify the **co-approval chain participants** for the entity's Approval row, with a one-line "why required" string per participant. Used both at intake (when constructing a new Approval) and on demand (when a user asks "who needs to approve this?").

The skill **does not** create the Approval row. It returns chain participants; the calling service persists them. It does not bypass the separation-of-duties rule (filer ≠ approver) — that filter is applied by the calling service after this skill returns.

## Kind
agentic

## Used by
- `ApprovalRouterAgent` (autonomous, called by `services/approval-chain.ts` at chain construction)
- `ChatPanelAgent` ("who approves this kind of change to payment-service?")
- `ContextualAssistantAgent` on detail pages ("walk me through the approval chain")

## Inputs

```typescript
{
  entity: {
    type: 'change' | 'access' | 'remediation' | 'escalation'
    id: string
    title: string
    relevantFields: Record<string, any>     // role, system, riskLevel, environment, etc.
  }
  policyContext: {
    requiredApproverRoles: string[]          // from policy bundle, e.g. ['SRE-Owner', 'Database-Owner', 'Risk-Compliance']
    activeFreezesAffecting: string[]
  }
  orgCatalog: {
    usersByRole: Record<string, Array<{ id: string; name: string; team: string }>>
    serviceOwners: Record<string, Array<{ id: string; name: string; team: string }>>
    managerHierarchy: Record<string, string | null>     // userId → managerId
  }
  filerName?: string                          // who initiated the entity (for SOD signaling)
  mode: 'construct_chain' | 'explain_chain'
}
```

## Outputs

```typescript
{
  participants: Array<{
    role: string                       // one of policyContext.requiredApproverRoles
    name: string                       // resolved user name from orgCatalog
    userId: string
    why: string                        // 1 sentence, why this person for this role
    isFiler: boolean                   // true if name === filerName (SOD conflict)
  }>
  chainNotes: string                   // overall narrative about the chain
  unresolvedRoles: string[]            // roles with no eligible candidate (rare; flagged)
}
```

The runner's caller post-filters `participants` to drop any with `isFiler=true` and surfaces those omissions as audit warnings.

## Context tiers consumed
- T1.a, T1.b, T1.d — identity, policy, full org catalog
- T2 — entity + policy context

Skipped: T3 (autonomous skill), T4, T5, T6.

## Prompt template

```
[T1.a — identity]
You construct or explain approval chains. You never approve.
You never bypass separation-of-duties; if the filer matches an eligible approver, mark
isFiler=true and let the calling service handle the conflict.

[T1.b — policy bundle, approver role mapping]
[T1.d — org catalog]

[entity]
Type: {entity.type}
ID: {entity.id} — {entity.title}
Relevant fields: {relevantFields}

[policy context]
Required approver roles for this entity: {requiredApproverRoles}
Active freezes affecting: {activeFreezesAffecting}

[org catalog]
{usersByRole_excerpt}
{serviceOwners_excerpt}
{managerHierarchy_excerpt}

[filer]
{filerName_or_unknown}

[mode]
- construct_chain: produce minimal valid chain (one user per required role)
- explain_chain: produce the full set of eligible candidates per role with reasoning

[task]
For each required approver role, identify the user(s). Prefer:
- service-specific owner over generic role-holder when the entity has a service field
- the user's manager when the entity is access-related and the role is "manager-of-requester"
- the system owner when the role is "owner-of-system"
- when multiple eligible, pick the team-aligned one (most adjacent to the entity's ownerTeam)

For each chosen user, write a 1-sentence "why" explaining their fit.

If a required role has no eligible user, list it in unresolvedRoles.

Output strictly as JSON.
```

## Model
`claude-sonnet-4-6`

## Temperature
`0.1`

## Token budget
- Input: ≤ 6000 (org catalog dominates; truncate to relevant scope when possible)
- Output: ≤ 800

## Failure modes

| Mode | Runner response |
|---|---|
| Output not valid JSON | `validation_failed`. Caller falls back to a deterministic chain (first available user per role). |
| Output references a `userId` not in `orgCatalog` | filtered out; caller substitutes deterministic pick. |
| Output role not in `requiredApproverRoles` | filtered out. |
| All required roles `unresolvedRoles` | Caller flags admin alert and persists the entity in `intake_blocked` state. |

## Audit
- `action="approval_chain_constructed"` (when mode=construct_chain)
- `result="success"`, `"escalated"` (if SOD conflict caused omission), or `"blocked"` (validation_failed / unresolved roles)
- `details` summarizes the chain: "{role}: {name}, {role}: {name}, ..."

## Examples

**Input: chg-002 (mode=construct_chain), filer=M. Liu (engineer, Payments):**
```json
{
  "participants": [
    {
      "role": "SRE-Owner",
      "name": "J. Wu",
      "userId": "usr-jwu",
      "why": "J. Wu owns the SRE function for payment-service per service catalog and holds the SRE-Owner approver role.",
      "isFiler": false
    },
    {
      "role": "Database-Owner",
      "name": "C. Davies",
      "userId": "usr-cdavies",
      "why": "C. Davies owns the database tier (systemsOwned includes payment_methods_db) and is required because the change includes a schema migration.",
      "isFiler": false
    },
    {
      "role": "Risk-Compliance",
      "name": "M. Patel",
      "userId": "usr-mpatel",
      "why": "M. Patel holds the Risk-Compliance role; required because chg-002 overlaps active freeze frz-001.",
      "isFiler": false
    }
  ],
  "chainNotes": "All three required roles resolved to clear candidates. M. Liu (filer) is in the Payments team but does not hold any of the required approver roles, so no SOD conflict.",
  "unresolvedRoles": []
}
```
