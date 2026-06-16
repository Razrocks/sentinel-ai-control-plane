# Abstractions

Canonical vocabulary. Every entity here corresponds to a Prisma model, a TypeScript interface, and a frontend rendering. If you see a field name in code or a UI label that disagrees with this file, this file is wrong or the code is wrong — flag it.

## Entity index

| Entity | Prisma model | Frontend type | Plural slug | Primary route |
|---|---|---|---|---|
| Change | `Change` | `Change` | `changes` | `/changes/:id` |
| Incident | `Incident` | `Incident` | `incidents` | `/incidents/:id` |
| Access Request | `AccessRequest` | `AccessRequest` | `access-requests` | `/access-requests/:id` |
| Approval | `Approval` | `Approval` | `approvals` | `/approvals` |
| Audit Event | `AuditEvent` | `AuditEvent` | `audit-events` | `/audit` |
| Policy Rule | `PolicyRule` | `PolicyRule` | `policies` | `/policies` |
| Freeze Window | `FreezeWindow` | `FreezeWindow` | `freeze-windows` | `/settings` (admin) |
| Recommendation | `Recommendation` | `Recommendation` | (nested) | (nested under change) |
| Blast Radius Item | `BlastRadiusItem` | `BlastRadiusItem` | (nested) | (nested under change) |
| Co-Approval | `CoApproval` | `CoApproval` | (nested) | (nested under approval) |
| Decision Impact | `DecisionImpact` | `DecisionImpact` | (nested) | (nested under approval) |
| Agent Invocation | `AgentInvocation` | `AgentInvocation` | `agent-invocations` | (admin/audit only) |
| User | `User` | (no public type — JWT only) | `users` | (admin only) |

## Change

A proposed modification to a production-like system.

| Field | Type | Notes |
|---|---|---|
| `id` | string (cuid) | Primary key. |
| `ticketId` | string | External ticket identifier (e.g. `CHG-2026-001`). Unique. |
| `title`, `description` | string | Human-authored. |
| `owner`, `ownerTeam` | string | Display values; not FKs to users in v1. |
| `service` | string | Service catalog identifier. |
| `environment` | string | E.g. `production`, `staging`. |
| `riskLevel` | enum `critical \| high \| medium \| low` | Set initially by intake; can be revised by `assess_change` skill. |
| `status` | enum `open \| in_review \| approved \| blocked \| escalated \| deployed \| rolled_back` | Workflow state. |
| `approvalState` | enum `approved \| pending \| denied \| not_required` | Aggregate of co-approval chain. |
| `policyDecision` | enum `allow \| deny \| escalate \| simulate_only` | Output of policy engine at last evaluation. |
| `linkedPRs` | string[] | URLs or repo paths. |
| `ciStatus` | `passing \| failing \| pending` | Sourced via GitHub MCP. |
| `maintenanceWindow` | string \| null | Display label. |
| `maintenanceWindowStart` / `maintenanceWindowEnd` | ISO timestamps \| null | Authoritative for execution-guard window check. |
| `rollbackPlan` | boolean | Exists / doesn't. |
| `blastRadius` | `BlastRadiusItem[]` | 1:N. |
| `recommendations` | `Recommendation[]` | 1:N. |
| `auditEvents` | `AuditEvent[]` | 1:N (filtered by `objectType=change` and `objectId`). |

**Lifecycle:** `open → in_review → (approved | escalated | blocked) → (deployed | rolled_back)`. Transitions are made by service code (`approval-chain.ts`, `actions.ts`); no agent transitions a change directly.

## Incident

A reported degradation or outage.

| Field | Type | Notes |
|---|---|---|
| `id` | string (cuid) | |
| `incidentId` | string | External ID, unique. |
| `severity` | enum `sev1 \| sev2 \| sev3 \| sev4` | |
| `status` | enum `new_incident \| investigating \| identified \| monitoring \| resolved` | Note: enum value is `new_incident` due to `new` being reserved; UI shows "New". |
| `affectedService`, `assignmentGroup` | string | |
| `relatedCI`, `relatedChanges`, `kbArticles` | string[] | |
| `likelyIssueType`, `rootCauseCategory`, `recommendedFix` | string | Output of `triage_incident` skill, displayed but not authoritative. |
| `isRecurring` | boolean | |

**Lifecycle:** transitions allowed only in declared order (`new_incident → investigating → identified → monitoring → resolved`). Backwards transitions go through escalation.

## Access Request

A user asking for a role on a system.

| Field | Type | Notes |
|---|---|---|
| `id` | string (cuid) | |
| `requestId` | string | Unique. |
| `requester`, `requesterEmail`, `manager`, `systemOwner` | string | Display strings. |
| `requestedSystem`, `requestedRole` | string | |
| `justification`, `reason` | string | Justification is from requester; reason is policy/system explanation. |
| `status` | enum `pending \| approved \| denied \| revoked \| expired` | |
| `riskLevel` | enum | Set by `evaluate_access_request`. |
| `policyDecision` | enum | From policy engine. |
| `entitlementCheck` | enum `eligible \| ineligible \| review_required` | Deterministic check vs role catalog. |
| `autoGrantAllowed` | boolean | True only if entitlement is `eligible`, risk ≤ medium, no manager required, no owner required. |
| `managerApprovalRequired` / `ownerApprovalRequired` | boolean | |
| `managerApproval` / `ownerApproval` | enum `approved \| pending \| denied \| not_required` | |

## Approval

A decision artifact attached to a change, an access request, a remediation, or an escalation.

| Field | Type | Notes |
|---|---|---|
| `id` | string (cuid) | |
| `type` | enum `change \| access \| remediation \| escalation` | Determines `linkedObjectId` interpretation. |
| `linkedObjectId` | string | The id of the entity this approval governs. |
| `status` | enum `pending \| approved \| denied \| approved_with_condition` | |
| `condition` | string \| null | Free text; populated when status is `approved_with_condition`. |
| `conditionResolved` | boolean | Set true when the condition is verified satisfied. |
| `conditionResolvedAt` / `conditionResolvedBy` | timestamp / string | Provenance for resolution. |
| `coApprovals` | `CoApproval[]` | The chain. |
| `decisionImpact` | `DecisionImpact?` | Approve/deny/escalate consequences, surfaced in UI. |
| `whyYouAreRequired` | string \| null | Per-role explanation; populated by `route_request` skill. |

**Co-approval state machine:** see [approval-model.md](approval-model.md).

## Audit Event

An immutable record of *something that happened*.

| Field | Type | Notes |
|---|---|---|
| `id`, `timestamp` | cuid, datetime | Append-only. |
| `actor` | string | User name or `"system"` for autonomous skills. |
| `action` | string | `verb_noun` snake_case. New verbs require ontology change. |
| `objectType` | enum `change \| incident \| access \| policy \| execution \| approval` | |
| `objectId`, `objectTitle` | string | |
| `policyRule` | string \| null | Name of the policy rule, if applicable. |
| `result` | enum `success \| blocked \| escalated \| denied` | |
| `details` | string | Human-readable; sometimes prose-summary of what happened. |
| `changeId` | string \| null | Optional direct FK for change-scoped events. |
| `agentInvocation` | `AgentInvocation?` | Back-relation; set when this audit row was caused by an agentic skill. |

## Agent Invocation

Provenance for every agentic skill call.

| Field | Type | Notes |
|---|---|---|
| `id` | string (cuid) | |
| `auditEventId` | string \| null (unique) | Link to the audit event this call produced, if any. |
| `skill` | string | Skill name from the registry, e.g. `assess_change`. |
| `kind` | enum `agentic \| deterministic \| integration` | Deterministic skills do not write here; this column exists for forward-compat. |
| `model` | string | E.g. `claude-sonnet-4-6`. |
| `promptHash` | string | SHA-256 of the rendered prompt. |
| `tokensIn` / `tokensOut` | int | |
| `cached` | boolean | True when result came from a content-addressed cache. |
| `latencyMs` | int | |
| `confidence` | float \| null | Skill-reported confidence in `[0,1]`; nullable for skills that don't self-score. |
| `status` | enum `success \| validation_failed \| error` | |
| `errorMessage` | string \| null | |
| `actor` | string | User name or `"system"`. |

## Freeze Window

A bounded time interval during which writes are blocked.

| Field | Type | Notes |
|---|---|---|
| `id`, `name`, `description` | cuid, string, string | |
| `startsAt`, `endsAt` | datetime | |
| `appliesTo` | string[] | Service identifiers, environment names, or empty (= global). |
| `isActive` | boolean | A window is enforced only when active AND now ∈ [startsAt, endsAt]. |

Execution guard checks: `isActive AND now ∈ window AND (appliesTo is empty OR change.service ∈ appliesTo OR change.environment ∈ appliesTo)`. Match → block.

## Recommendation

Sentinel's suggestion attached to a change.

| Field | Type | Notes |
|---|---|---|
| `id`, `changeId` | cuid | |
| `title`, `reason`, `evidence`, `expectedBenefit` | string | |
| `classification` | enum `required_now \| recommended \| optional_optimization \| out_of_scope` | |
| `requiredApprovals` | string[] | Roles that must sign off if accepted. |
| `executableNow` / `draftOnly` | boolean | Mutually exclusive in practice. `draftOnly` recommendations need a human to commit. |

## Blast Radius Item

A downstream system affected by a change.

| Field | Type | Notes |
|---|---|---|
| `id`, `changeId` | cuid | |
| `name`, `details` | string | |
| `type` | enum `service \| database \| api \| queue \| job \| monitoring \| integration` | |
| `reason` | string | Why this is in scope. |
| `confidence` | enum `high \| medium \| low` | LLM-reported. |
| `criticality` | enum `critical \| high \| medium \| low` | LLM-reported. |
| `ownerTeam` | string | |

## User

| Field | Type | Notes |
|---|---|---|
| `id`, `email`, `name` | cuid, string, string | |
| `passwordHash` | string | Bcrypt. |
| `role` | enum `operator \| engineer \| it_support \| approver \| access_approver \| admin` | |
| `team` | string | |
| `managerId` | string \| null | Self-FK to User. Used by access-eval to construct manager approval. |
| `systemsOwned` | string[] | Service identifiers; used by access-eval for owner approval. |

## Cross-cutting conventions

- **Timestamps** — all are ISO 8601 UTC strings on the wire. Stored as `TIMESTAMP(3)` in Postgres.
- **IDs** — cuid for internal, external IDs (ticketId, incidentId, requestId) are strings provided by upstream systems.
- **Enums** — Postgres native enums; Prisma enums; TypeScript string-literal unions. All three layers must agree.
- **Optional vs nullable** — `?` on Prisma = nullable in DB. `?` on TS = optional field (may be absent from JSON). They are not the same; check both.
- **Array fields** — Postgres `text[]` for string arrays. Prisma `String[]`. TS `string[]`.
