# Approval Model

How approvals are structured, how the co-approval chain advances, what a condition means, and how acceptance propagates to the linked entity.

## Approval is an object, not a verb

In Sentinel, "approve" is what a user *does*. An **Approval** is an *object* — a row in `approvals` — that represents a single decision artifact attached to one change, access request, remediation, or escalation. The Approval object holds the chain of co-approvers, their individual statuses, the aggregate status, and any condition.

This separation is intentional. It lets:
- Co-approval chains exist without mutating the underlying entity.
- Approvals be inspected and audited independently of what they govern.
- The same chain pattern apply across change/access/remediation without four divergent state machines.

## Lifecycle

```
                                       ┌── (any deny) ──→ denied  [terminal]
                                       │
pending ──(first approval, others wait)─┤
                                       │
                                       ├─ (all approve, no condition) ──→ approved
                                       │
                                       └─ (all approve, condition set) ──→ approved_with_condition
                                                                                │
                                                                                └─ (condition resolved) ──→ approved [via conditionResolved=true]
```

States in `Approval.status`:
- `pending` — not all co-approvers have decided.
- `approved` — every co-approver decided `approved`, no condition attached.
- `approved_with_condition` — every co-approver decided, at least one set a condition.
- `denied` — at least one co-approver decided `denied`. Terminal.

The transition into `approved` from `approved_with_condition` is **not** automatic on its own — there must be an explicit resolution action that sets `conditionResolved=true` (with `conditionResolvedBy` and `conditionResolvedAt`). Until resolved, downstream consumers (execution guard, propagation) treat `approved_with_condition` as **not yet executable**.

## Co-approval state machine

A `CoApproval` row has `status ∈ {approved, pending, denied}` and represents one chain participant.

The state machine for the parent `Approval` advances on each `CoApproval` mutation:

```
on co-approval mutation (id, decision):
  set co_approval.status = decision, co_approval.decided_at = now()
  if any sibling has status='denied':
    parent.status = 'denied'                       # terminal
  else if all siblings have status='approved':
    parent.status = 'approved' OR 'approved_with_condition' (if condition param given)
  else:
    parent.status = 'pending'                      # still waiting
```

Implementation lives in `backend/src/services/approval-chain.ts` (`resolveCoApproval()`), called from `POST /api/approvals/:id/decide`.

**Idempotency:** if a co-approver attempts to re-decide, the call is rejected with `409 Conflict`. The decision is only modifiable in v2 via an explicit "withdraw decision" flow that itself audits.

**Order independence:** co-approvers can decide in any order. There is no required sequence in v1.

## Co-approver identification

When `POST /api/approvals/:id/decide` arrives:

1. Load approval with `coApprovals[]`.
2. Find the row where `coApproval.name === request.user.name` OR (more permissively) `coApproval.role === request.user.role`.
3. If no match → 403 (`actor not in chain`).
4. If matched but `coApproval.status !== 'pending'` → 409.
5. Apply the decision via `resolveCoApproval()`.

Server-side scoping:
- For change approvals — actor must be in the chain.
- For access approvals — actor must satisfy the role-driven scope: manager (`User.managerId` of requester === actor.id) OR owner (actor.systemsOwned ∋ requestedSystem).

## Conditions

A condition is free text attached to a `approved_with_condition` decision. Examples in seed data:
- "Maintenance window confirmed with on-call before deploy."
- "Rollback drill completed on staging."

Conditions create a **secondary verification step**. Until the condition is resolved (`conditionResolved=true`), the linked entity does not enter executable state. Resolution is itself an action:

`POST /api/approvals/:id/resolve-condition`
Body: `{ resolved: true, evidence?: string }`

This:
1. Sets `conditionResolved=true`, `conditionResolvedAt=now`, `conditionResolvedBy=actor.name`.
2. Writes an audit event with `action="condition_resolved"`, `result="success"`.
3. **Does not** retroactively change `status` from `approved_with_condition` to `approved` — the status remains `approved_with_condition` so the audit is preserved. Downstream checks consult `conditionResolved` AND `status ∈ {approved, approved_with_condition}` as the executable predicate.

Why not just flip the status? Because the historical record matters. An auditor wants to see "this change was approved with a condition, and the condition was satisfied at T+30m" — not "this was approved." The flag preserves both facts.

## Propagation to linked entity

When an approval transitions to `approved` (and, for `approved_with_condition`, when the condition resolves), the linked entity is updated:

| Approval type | Propagation |
|---|---|
| `change` | `change.approvalState = 'approved'`. Audit: `action="approval_obtained"`, `objectType="change"`. |
| `access` | `accessRequest.status = 'approved'` if both `managerApproval` and `ownerApproval` are now `approved`. The `managerApproval` and `ownerApproval` fields are also updated as the corresponding co-approvers decide. |
| `remediation` | The linked incident's `recommendedFix` is marked accepted; an audit event with `action="remediation_approved"` is written. |
| `escalation` | The linked change/incident gets `status='escalated'` if not already; audit event recorded. |

Propagation is part of the same DB transaction as the final co-approval decision. An approval that completes but fails to propagate (e.g. transient DB error on the linked-entity update) rolls back, leaving the chain in `pending` for retry. There is no "approved but not propagated" state.

## DecisionImpact

Each Approval may carry a `DecisionImpact` row — three short text fields explaining what happens on approve / deny / escalate. This is rendered in the Approver UI to make the decision transparent.

`DecisionImpact` is **populated by the `support_approval_decision` skill** at approval-creation time, then becomes static data the human reads when deciding. It is not regenerated per visit.

## whyYouAreRequired

`Approval.whyYouAreRequired` is a per-approval string explaining to the current viewer why their sign-off is needed. Populated by the `route_request` skill when the chain is constructed. Empty for approvals that are universal (e.g. "any approver can sign off").

## Audit events for approval lifecycle

Every transition writes one audit event:

| Action string | When |
|---|---|
| `approval_created` | Approval row inserted. |
| `co_approval_recorded` | Individual co-approver decided. `details` includes their name + decision. |
| `approval_completed` | Aggregate transitioned to `approved` or `approved_with_condition`. |
| `approval_denied` | Aggregate transitioned to `denied`. |
| `condition_resolved` | Condition flagged satisfied. |
| `approval_obtained` | Linked entity updated. |

The `co_approval_recorded` and `approval_completed` events may be the same DB transaction; they are still two distinct audit rows because they describe two distinct facts.

## What is not modeled

- **Approval delegation** — "while I'm out, my reports go to X." Not in v1.
- **Time-bounded auto-approval** — "if no decision in 24h, auto-approve at lower risk." Not in v1; would require explicit policy bundle.
- **Approval revocation** — once an approval is `approved`, it cannot be un-approved. To unwind, an explicit "rollback" change is filed, which has its own approval chain.
- **Quorum approvals** — "any 2 of 4 senior engineers." Currently every co-approver must approve. Quorum support is v2.
