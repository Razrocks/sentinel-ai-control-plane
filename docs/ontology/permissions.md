# Permissions

What each role is allowed to do, at the granularity of *actions* — the verbs the API exposes. Frontend hides what role can't do; backend enforces it.

## Action vocabulary

Every state-changing endpoint maps to one of these action names. They are the strings passed to `requireAction()` in `backend/src/middleware/rbac.ts`.

| Action | Meaning |
|---|---|
| `view` | Read access. Enforced as `requireAuth` only — the matrix below assumes any authenticated role can view; restricted reads are noted explicitly. |
| `triage` | Open an entity for review, advance through investigation states. |
| `approve` | Sign off on a pending approval (change, access, remediation, escalation). |
| `deny` | Reject a pending approval. |
| `escalate` | Move a change or incident to a higher attention tier. |
| `execute` | Apply an approved change to the target system (writes through MCP / out-of-band). |
| `simulate` | Dry-run an approved or unapproved change. Always read-only. |
| `request_access` | File an access request. |
| `update_incident_status` | Transition incident lifecycle. |
| `draft_artifact` | Run a `draft_*` skill (work note, customer response, approval packet). |
| `propose_remediation` | Run `propose_bounded_remediation`. |
| `configure_policy` | Edit policy rules. |
| `configure_freeze_window` | Edit freeze windows. |
| `manage_users` | Create users, assign roles, set manager hierarchy. |
| `test_integration` | Trigger an MCP connection test. |

## Role × action matrix

✓ = allowed. ✗ = denied. ◐ = allowed with scope/condition (see notes).

| Action | operator | engineer | it_support | approver | access_approver | admin |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| `view` (general) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `triage` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `approve` (change) | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ |
| `approve` (access) | ✗ | ✗ | ✗ | ✗ | ◐ ¹ | ✗ |
| `approve` (remediation/escalation) | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ |
| `deny` (any) | ✗ | ✗ | ✗ | ◐ ² | ◐ ¹ | ✗ |
| `escalate` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `execute` | ✗ | ◐ ³ | ✗ | ✗ | ✗ | ✗ |
| `simulate` | ✓ | ✓ | ✗ | ✓ | ✗ | ✓ |
| `request_access` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `update_incident_status` | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| `draft_artifact` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `propose_remediation` | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ |
| `configure_policy` | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| `configure_freeze_window` | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| `manage_users` | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| `test_integration` | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |

**Notes:**

1. **`access_approver` approve/deny scope** — Allowed only when the request implicates a user this approver manages (`User.managerId === approver.id`) OR a system this approver owns (`approver.systemsOwned` ∋ `request.requestedSystem`). Cross-checked server-side; UI filters the inbox.
2. **`approver` deny** — Allowed for change/remediation/escalation approvals where the approver is a participating co-approver. Cannot deny on someone else's chain. Cross-checked server-side.
3. **`engineer` execute** — Allowed only when (a) the engineer owns the change's service (`engineer.systemsOwned` ∋ `change.service`) AND (b) the change's `approvalState === 'approved'` AND (c) the policy engine allows the action AND (d) no active freeze window covers the change. All four are checked by `execution-guard.ts`; failure of any one returns `result: blocked`.

## Separation-of-duties rules

Encoded in `requireAction()` and the relevant service code; not just policy.

- **Filer ≠ Approver.** A user cannot approve a change/access/remediation they themselves filed. Checked at `POST /api/approvals/:id/decide`.
- **Filer ≠ Executor for high-risk.** For changes with `riskLevel ∈ {critical, high}`, the executor must not be the filer. Lower-risk changes may be executed by their filer (still requires approval).
- **Approver ≠ Executor.** Default policy: an approver may not also execute the same change. Overridable per policy bundle in v2; hardcoded in v1.

## Surface-level restrictions

Some pages are role-gated even though the actions on them are matrix-controlled.

| Page | Operator | Engineer | IT | Approver | Access Approver | Admin |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Dashboard | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Changes (list/detail) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Incidents (list/detail) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Access Requests | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Approvals (inbox) | ◐ ⁴ | ◐ ⁴ | ◐ ⁴ | ✓ | ✓ | ◐ ⁴ |
| Audit Trail | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Policies | ✓ ⁵ | ✓ ⁵ | ✓ ⁵ | ✓ ⁵ | ✓ ⁵ | ✓ |
| Settings | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |

4. **Approvals inbox** — Visible to all roles but the listing is filtered to *items the user can act on*. For non-approver roles, this is typically items they filed (read-only) or items requesting their input (e.g. an access requester sees their own request).
5. **Policies page** — Read-only for all roles except admin; admin gets edit affordances.

## RBAC enforcement contract

The frontend renders affordances based on `useRole()`. The backend enforces:

```
requireAuth         // verifies JWT, populates request.user
  ↓
requireAction(...)  // checks user.role against the action's allowed roles
  ↓
service-level       // checks scope (e.g. "is this approver in this approval's chain?")
  ↓
policy engine       // separately, checks rule-driven decisions
```

Any one of these returning a denial produces an audit event with `result: 'blocked'` (RBAC) or `result: 'denied'` (policy) and an HTTP 403.

## What is not a permission

- **Read filtering by team** — v1: every role sees every entity (the audit table is visible to all). v2: row-level filters by team/service.
- **Per-environment role gating** — e.g. "engineer X can execute in staging but not production." Currently enforced via policy bundle on `execute`, not via role.
- **Approval delegation** — "while I'm out, route my approvals to Y." Not in v1.
- **Role inheritance** — admin is *not* "operator + engineer + ...". An admin who needs to file a change does so in their admin role and the system enforces accordingly. There is no impersonation.
