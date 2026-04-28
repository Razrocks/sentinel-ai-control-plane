# Role Model

## The 6 roles

Roles are functional, not hierarchical. Each role is a job description, not a seniority level.

### `operator`

The on-call operations engineer. Watches the queue, triages, escalates, monitors. Does not approve high-risk items; does not have write access on production services. Reads everything.

**Mental model:** "What's happening across the estate right now, and what needs attention?"

**Daily pages:** Dashboard, Changes (list), Incidents (list), Audit Trail.

**Rare pages:** Change/Incident details (read), Access Requests (read), Policies (read), Settings (no).

**Cannot:** approve, deny with finality, execute, configure policy, edit freeze windows.

### `engineer`

A service owner. Files changes, responds to incidents involving their service, requests access. Has skin in the game on specific services (`User.systemsOwned`).

**Mental model:** "My service has a change in flight; here is what's happening to it."

**Daily pages:** Changes (filtered to their team/owner), incident detail when their service is implicated, change detail (write).

**Cannot:** approve their own changes (separation of duties), approve other changes outside policy-allowed scope, execute production write without policy permitting.

### `it_support`

Front-line incident handler. Receives alerts, runs initial triage, drafts work notes and customer responses, escalates to engineers when needed.

**Mental model:** "Caller / alert just opened a ticket; what is this and where does it go?"

**Daily pages:** Incidents (list, detail), Audit Trail (read for context).

**Cannot:** approve, edit changes, configure policy. Can transition incident states forward but not arbitrary backward transitions (those go through escalation).

### `approver`

Infrastructure / change risk owner. Holds the line on production safety. Reviews change packets, approves or denies, occasionally approves with condition.

**Mental model:** "Should this change be allowed to deploy, given its blast radius and the current freeze posture?"

**Daily pages:** Approvals (inbox), Change detail (read+approve), Policies (read), Audit Trail.

**Cannot:** execute changes (separation of duties), approve their own filed changes, configure policy, override freeze windows.

### `access_approver`

The manager-or-owner side of access requests. Two distinct sub-roles collapsed into one role flag for v1:

- **Manager** — approves access requests for their direct reports (matched via `User.managerId`).
- **System Owner** — approves access requests for systems they own (matched via `User.systemsOwned`).

A single user may be both. The approval chain treats them as separate co-approvers.

**Mental model:** "Does my report need this access? Does my system permit this role?"

**Daily pages:** Approvals (filtered to access type), Access Request detail, Audit Trail.

**Cannot:** approve change-type approvals, approve access for users not in their reports/systems, edit policy.

### `admin`

Configures the system. Manages policy bundles, freeze windows, integration credentials, role assignments, user manager mapping.

**Mental model:** "Are the rules right, the integrations healthy, and the right people in the right roles?"

**Daily pages:** Settings, Policies (write), Audit Trail.

**Cannot:** approve their own changes; cannot bypass policy at runtime — admin can *change* policy, then a subsequent action evaluates against the new policy. There is no admin-impersonation or god-mode action.

## Role assignment

- One role per user in v1. Multi-role is a v2 problem.
- Role is on `User.role`, populated at seed time and modifiable by admin only.
- Role enters the JWT at login; the JWT is the source of truth for the request lifecycle.
- Frontend `useRole()` reads from the JWT; it is **not** a security boundary — it controls what UI to render. Server-side `requireAction()` is the boundary.

## Manager hierarchy

`User.managerId` is a self-FK. A user can have at most one manager. Managers can have many reports (`reports` relation).

Used by:
- Access-eval (`evaluate_access_request` skill) — to identify the manager co-approver.
- Approval router (`route_request` skill) — to identify chain participants.
- Future: escalation policies (e.g. "if no decision in 24h, escalate to manager").

Not used by:
- Permissions. Being someone's manager does **not** grant access to their tickets in v1. RBAC is by role, not hierarchy.

## System ownership

`User.systemsOwned` is a string array of service identifiers. Used by:
- Access-eval — to identify the system-owner co-approver.
- Future: change routing — when a change targets a service, suggest its owners as approvers.

Not used by:
- Implicit approval rights on the service. A system owner is not automatically an approver-role; they receive the `access_approver` co-approval *if* the access-eval logic determines the request needs an owner sign-off.

## Why these 6

The roles cover the orthogonal jobs: watch, build, support, approve-change, approve-access, configure. There is no "viewer" role because every role is allowed to read; restricted reads are not a v1 problem. There is no "auditor" role because audit access is a property of role + page (every authenticated role sees Audit Trail; what they see may differ in v2 with row-level filters).

## What's not a role

- **"Senior approver" / "principal"** — not modeled. If two approvers are required, that is encoded in the co-approval chain on the specific approval, not in the user's role.
- **"Service owner" as a top-level role** — collapsed into `access_approver` plus `engineer`. Owning a system grants access-approval authority for that system; building on a service is the engineer role.
- **"Read-only auditor"** — every role can read audit. No distinct read-only role in v1.
