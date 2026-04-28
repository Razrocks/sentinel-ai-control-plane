# Workflow Contracts

A workflow is a named, end-to-end sequence — entry point through final state — that crosses subsystem boundaries. Workflows are the unit at which Sentinel is *behaviorally* specified: "what happens when X enters the system."

Each workflow has a stable ID, a trigger, an actor surface, the subsystems it touches, the deterministic gates it passes through, the agentic skills it invokes, and the audit events it produces.

## The 6 v1 workflows

| ID | Name | Trigger | Primary actor |
|---|---|---|---|
| **WF-CHG** | Change submission → review → execution | New change ticket arrives or `POST /api/changes` | Engineer files; approver decides; engineer executes |
| **WF-INC** | Incident triage → response → resolution | New incident or `POST /api/incidents` | IT support / engineer |
| **WF-ACC** | Access request → eval → approval chain | `POST /api/access-requests` | Requester; manager + owner |
| **WF-APR** | Generic approval decision flow | `POST /api/approvals/:id/decide` | Approver / access_approver |
| **WF-REM** | Bounded remediation proposal | Engineer/IT triggers `propose_bounded_remediation` from incident detail | Engineer (filer); approver (signer) |
| **WF-EXE** | Execution attempt for an approved change | `POST /api/changes/:id/execute` | Engineer (with execute action allowed) |

## Shared template

Every workflow specification answers the same questions:

1. **Trigger** — What initiates this workflow.
2. **Actors** — Who participates and at which step.
3. **Subsystems touched** — In order.
4. **Gates** — Deterministic checks that may halt or branch the flow.
5. **Skills invoked** — Agentic skills called and the points at which they run.
6. **Audit events emitted** — In order.
7. **Terminal states** — Success / failure / escalated.
8. **Failure modes** — What goes wrong and what happens then.

---

## WF-CHG — Change Lifecycle

**Trigger.** Change row created (via API, MCP intake from ServiceNow, or seed).

**Actors.** Filer (engineer or admin). Approver(s) on the chain. Optionally the executor (engineer with `execute` and matching service ownership).

**Subsystems touched.** S1 (Change Assessment) → S2 (Blast Radius) → S5 (Approval Engine) → S6 (Policy) → S7 (Execution Guard) → S10 (Audit) throughout.

**Gates.**
- G1: Policy engine evaluates change at intake. Sets `policyDecision`. If `deny` → terminal.
- G2: Approval chain constructed by `route_request` + `support_approval_decision` skills. Approval rows persisted.
- G3: Co-approval state machine waits for human decisions. May transition to `denied` at any time.
- G4: Once approved, execution is gated by execution guard: approval state, policy verdict, freeze-window overlap, maintenance-window currency.

**Skills invoked.**
- At intake: `assess_change` (risk, summary), `analyze_blast_radius` (affected entities), `route_request` (chain construction).
- At approval review: `support_approval_decision` (decision impact + why-required strings), invoked when the approval row is created (not per-visit).
- At pre-execution review (assistant): `explain_policy_decision` on demand.

**Audit events.**
1. `change_filed` (objectType=change, result=success).
2. `policy_evaluated` (objectType=change, policyRule=<matched>, result=success).
3. `change_assessed` (objectType=change, result=success, agentInvocation linked).
4. `blast_radius_computed` (objectType=change, result=success, agentInvocation linked).
5. `approval_created` (objectType=approval, one per approval row).
6. `co_approval_recorded` (per co-approver decision).
7. `approval_completed` OR `approval_denied`.
8. `approval_obtained` (objectType=change, on propagation).
9. (When execute attempted) `execution_blocked` or `execution_completed`.

**Terminal states.**
- `change.status = deployed` (via WF-EXE).
- `change.status = blocked` (any policy `deny`).
- `change.status = escalated` (manual escalation).
- `change.status = rolled_back` (post-deploy rollback, separate workflow in v2).

**Failure modes.**
- Skill `assess_change` returns malformed output → `agent_invocations.status='validation_failed'`, change keeps its intake-time risk class.
- Policy engine errors → workflow halts, audit event with result='blocked', operator paged (in v2).
- Approval chain has zero co-approvers → caught at construction; treated as a configuration error, audit `result='blocked'`.

---

## WF-INC — Incident Lifecycle

**Trigger.** Incident row created (via API, MCP intake from ServiceNow alerting, or seed).

**Actors.** IT support (initial triage). Engineer (when their service is implicated). Approver (when remediation requires sign-off).

**Subsystems touched.** S3 (Incident Triage) → S10 (Audit) → optionally S8 (Artifact Generation) → optionally WF-REM.

**Gates.**
- G1: Status transitions are validated against the allowed sequence (`new_incident → investigating → identified → monitoring → resolved`). Out-of-order transitions return 409 unless escalating.
- G2: Recurring-incident detection is informational only; does not gate.

**Skills invoked.**
- On creation: `triage_incident` (severity inference, root-cause category, KB matches, related-change correlation).
- On demand from detail page: `draft_work_note`, `draft_customer_response`.
- On engineer choosing to act: `propose_bounded_remediation` → kicks WF-REM.

**Audit events.**
1. `incident_filed`.
2. `incident_triaged` (with agentInvocation).
3. `incident_status_updated` (per transition).
4. `work_note_drafted` / `customer_response_drafted` (when artifact saved).
5. `remediation_proposed` (when WF-REM begins).
6. `incident_resolved` (terminal status).

**Terminal states.** `status=resolved`. Incidents are not deleted; resolved incidents stay queryable.

**Failure modes.**
- Triage skill fails → incident remains with intake severity; UI shows "triage unavailable" badge.
- Status transition out-of-order → 409, no audit emitted (the rejection itself is audited as `incident_status_blocked`).

---

## WF-ACC — Access Request Lifecycle

**Trigger.** `POST /api/access-requests` (or seed).

**Actors.** Requester (any role). Manager (`access_approver` whose reports include the requester). System owner (`access_approver` whose `systemsOwned` includes the requested system).

**Subsystems touched.** S4 (Access Eval) → S5 (Approval Engine, two co-approval rows: manager + owner) → S6 (Policy) → S10 (Audit).

**Gates.**
- G1: Entitlement check (deterministic): is this user *eligible* for this role on this system? Output: `eligible | ineligible | review_required`.
- G2: Risk classification (`evaluate_access_request` skill).
- G3: Policy engine evaluates. May set `policyDecision='auto_grant'` if conditions met.
- G4: Auto-grant eligibility check: `entitlementCheck=eligible AND risk≤medium AND no manager required AND no owner required` → bypass approvals, status='approved' immediately. (In v1, auto-grant defaults to `false` — deferred until policy bundles are richer.)
- G5: Approval chain — manager and owner co-approval rows created with the access type.

**Skills invoked.**
- At intake: `evaluate_access_request` (risk, justification quality, entitlement narrative), `route_request` (chain).
- At approval: `support_approval_decision` (decision impact strings).

**Audit events.**
1. `access_request_filed`.
2. `entitlement_checked`.
3. `access_evaluated` (with agentInvocation).
4. `policy_evaluated`.
5. `approval_created` (manager + owner).
6. `co_approval_recorded` (per decision).
7. `approval_completed` / `approval_denied`.
8. `access_granted` / `access_denied`.

**Terminal states.** `approved` (access provisioned via MCP), `denied`, `expired`, `revoked`.

**Failure modes.**
- Manager not found (no `User.managerId`) → entry returns 422 at intake, audit `result='blocked'`.
- System owner not found (no `User.systemsOwned ∋ system`) → same.
- Provisioning via MCP fails → `accessRequest.status` stays `approved` but a `provisioning_failed` audit event is written; admin attention required.

---

## WF-APR — Generic Approval Decision

**Trigger.** `POST /api/approvals/:id/decide`.

**Actors.** A co-approver on the approval's chain.

**Subsystems touched.** S5 (Approval Engine) → S10 (Audit) → linked workflow (CHG, ACC, REM, etc.) for propagation.

**Gates.**
- G1: RBAC — `requireAction('approve')` or `requireAction('deny')`.
- G2: Scoping — actor must be in `coApprovals[]`.
- G3: Idempotency — actor's existing co-approval status must be `pending`.
- G4: Self-approval prevention — actor must not be the original filer.

**Skills invoked.** None at decision time. Decision impact strings were prepopulated when approval was created.

**Audit events.**
1. `co_approval_recorded`.
2. `approval_completed` / `approval_denied` (when chain transitions terminal).
3. Linked-workflow propagation events (e.g. `approval_obtained` on the change, `access_granted` on the access request).

**Terminal states.** Approval transitions to `approved` / `approved_with_condition` / `denied`. The decide endpoint returns the updated approval.

**Failure modes.**
- Idempotency violation → 409.
- Filer-equals-approver → 403, audit `result='blocked'`.
- Propagation transaction fails → entire decide TX rolls back; approval stays `pending`.

---

## WF-REM — Bounded Remediation

**Trigger.** Engineer or IT clicks "Propose remediation" on an incident detail page (or `POST /api/incidents/:id/propose-remediation`).

**Actors.** Filer (engineer or IT). Approver (an approver-role co-approver).

**Subsystems touched.** S3 (Incident Triage) → S8 (Artifact Generation) → S5 (Approval Engine) → S6 (Policy).

**Gates.**
- G1: RBAC — `requireAction('propose_remediation')`.
- G2: Bounded-scope check — the remediation skill output must declare a single service, a single change-type (config/restart/rollback), and an estimated blast radius. Outputs that don't conform are validation_failed.
- G3: Approval chain construction — same pattern as WF-CHG.

**Skills invoked.** `propose_bounded_remediation` (the proposal artifact). `support_approval_decision` (chain construction).

**Audit events.**
1. `remediation_proposed`.
2. `approval_created`.
3. (Approval lifecycle events from WF-APR.)
4. `remediation_approved` / `remediation_denied`.
5. (If approved and executed) execution events from WF-EXE.

**Terminal states.** `denied`, or transitions into WF-EXE with the proposed change.

**Failure modes.**
- Skill output exceeds bounded scope → `validation_failed`, no proposal saved.
- Engineer attempts to bypass approval → 403.

---

## WF-EXE — Execution

**Trigger.** `POST /api/changes/:id/execute`.

**Actors.** Engineer (with `execute` action and matching service ownership).

**Subsystems touched.** S7 (Execution Guard) → S6 (Policy, re-evaluation at execute time) → S12 (MCP, for the actual write) → S10 (Audit).

**Gates.**
- G1: Approval state — `change.approvalState === 'approved'` AND (no condition OR `conditionResolved===true`).
- G2: Policy decision — re-evaluated at execute time. Must be `allow`. Bundles may have changed since approval.
- G3: Freeze-window overlap — no active freeze window covers the change's service or environment.
- G4: Maintenance-window currency — if `maintenanceWindowStart/End` is set, current time must be within them.
- G5: Separation of duties — executor ≠ filer for high/critical risk.

Any gate failure → 403 + audit event with `result='blocked'`.

**Skills invoked.** `explain_policy_decision` (on-demand from UI when blocked, to show the user *why* the gate denied them).

**Audit events.**
1. `execution_attempted`.
2. `execution_blocked` (with `policyRule` set to the failing gate's rule name) OR `execution_completed`.
3. (On completed) `change_status_updated` (status=deployed).

**Terminal states.** `change.status = deployed`. Failed executions leave the change in `approved` for retry.

**Failure modes.**
- Gate fails → blocked, change unchanged.
- MCP write fails (target system unreachable) → `execution_attempted` recorded, `execution_failed` recorded, change unchanged. Engineer retries.

---

## Workflow → service → skill mapping

| Workflow | Owning service file | Skills called |
|---|---|---|
| WF-CHG | `services/change-assessment/`, `services/approval-chain.ts`, `routes/changes.ts` | `assess_change`, `analyze_blast_radius`, `route_request`, `support_approval_decision` |
| WF-INC | `services/incident-triage/`, `routes/incidents.ts` | `triage_incident`, `draft_work_note`, `draft_customer_response` |
| WF-ACC | `services/access-eval/`, `services/approval-chain.ts`, `routes/access-requests.ts` | `evaluate_access_request`, `route_request`, `support_approval_decision` |
| WF-APR | `services/approval-chain.ts`, `routes/actions.ts` | (none at decide time) |
| WF-REM | `services/artifacts/`, `routes/actions.ts` | `propose_bounded_remediation`, `support_approval_decision` |
| WF-EXE | `services/execution-guard.ts`, `routes/actions.ts` | `explain_policy_decision` (on-demand) |

## Cross-workflow invariants

1. **A workflow never invokes another workflow's actions directly.** WF-CHG does not call execute; it ends at "approval_obtained." WF-EXE is a separate workflow triggered by a separate user action.
2. **A workflow's failure does not roll back another workflow's success.** If WF-EXE fails, WF-CHG remains complete with `approvalState=approved`.
3. **Audit events are workflow-scoped but not workflow-namespaced.** The same `action="approval_completed"` is used in WF-CHG, WF-ACC, and WF-REM. Disambiguation is by `objectType` + `objectId`.
4. **Skills are workflow-agnostic.** A skill does not know which workflow called it. The caller passes the entity; the skill returns a typed result.
