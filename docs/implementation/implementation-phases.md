# Implementation Phases

What gets built when. Each phase has a goal, the deliverable, the verification gate, and the dependency on prior phases. Phases 1–7 are complete; this document captures their state and lays out 8–11.

## Phase status

| Phase | Goal | Status |
|---|---|---|
| **0** | Schema reconciliation: align Prisma schema with the ontology in `/docs/ontology/abstractions.md`. | ✓ complete (2026-04-27) |
| **1** | Backend skeleton + Docker + DB up. | ✓ complete |
| **2** | Core read APIs (changes, incidents, access, approvals, audit, policies). | ✓ complete |
| **3** | Frontend integration via React Query, no mock imports. | ✓ complete |
| **4** | Auth + RBAC (JWT, 6 roles, requireAction). | ✓ complete |
| **5** | Action endpoints + audit + policy engine + frontend mutations. | ✓ complete |
| **6** | Real-time audit stream (SSE). | ✓ complete |
| **7** | Claude API integration for ChatPanel + ContextualAssistant. | ✓ complete |
| **8** | Skills registry + context builder + advisor refactor. | next |
| **9** | Tier-2 autonomous skills (read-path: triage, assess). | gated on 8 |
| **10** | MCP client connections (ServiceNow, GitHub, OPA). | gated on 9 |
| **11** | Tier-3 autonomous skills (write-path remediation, with explicit policy bundles). | gated on 10 |

## Phase 0 — Schema reconciliation (done)

**Goal.** Make the Prisma schema match the ontology.

**Deliverables (applied 2026-04-27):**
- `AgentInvocation` table (id, auditEventId? unique FK, skill, kind, model, promptHash, tokensIn/Out, cached, latencyMs, confidence?, status, errorMessage?, actor, createdAt). Indexes on skill, createdAt desc, actor.
- `FreezeWindow` table (name, description, startsAt, endsAt, appliesTo[], isActive). Indexes on startsAt, endsAt, isActive.
- `Approval` extended: `conditionResolved`, `conditionResolvedAt`, `conditionResolvedBy`.
- `Change` extended: `maintenanceWindowStart`, `maintenanceWindowEnd` (timestamps; existing string label kept for display).
- `User` extended: `managerId` (self-FK, SetNull on delete), `systemsOwned: String[]`. Index on managerId.
- Enums added: `AgentInvocationStatus`, `AgentSkillKind`.
- AuditEvent ↔ AgentInvocation back-relation.

**Migration:** `20260427033037_phase0_ontology_alignment` applied.

**Seed updated:** explicit user IDs (usr-admin, usr-operator, usr-engineer, usr-itsupport, usr-approver, usr-access-approver), manager hierarchy populated, chg-002 maintenance window timestamps set, two seed freeze windows (frz-001 active, frz-002 inactive).

**Frontend types mirrored:** `frontend/src/types/index.ts` adds FreezeWindow, AgentInvocation interfaces and the Change/Approval extensions.

## Phase 1 — Backend skeleton (done)

Fastify + Prisma + Postgres up via docker-compose. Health endpoint returns 200. Seed loads.

## Phase 2 — Read APIs (done)

`GET /api/changes`, `/changes/:id`, `/incidents`, `/incidents/:id`, `/access-requests`, `/access-requests/:id`, `/approvals`, `/audit-events`, `/policies`. All with optional filters.

## Phase 3 — Frontend integration (done)

`@tanstack/react-query` installed. `frontend/src/lib/api.ts` with apiFetch. Hooks: useChanges, useChange, useIncidents, useIncident, useAccessRequests, useAccessRequest, useApprovals, useAuditEvents, usePolicies. 11 pages migrated off mocks.

## Phase 4 — Auth + RBAC (done)

`POST /api/auth/login`, `/refresh`, `GET /api/auth/me`. JWT (15m access + 7d refresh). bcrypt for passwords. `requireAuth`, `requireAction` middleware. 6 seeded users covering each role. Frontend login page; route guards via existing `useRole()` connected to JWT.

## Phase 5 — Actions + policy + audit (done)

`backend/src/services/audit.ts` — single audit factory.
`backend/src/services/policy-engine.ts` — rule eval, scope match.
`backend/src/services/approval-chain.ts` — co-approval state machine, propagation.
`backend/src/routes/actions.ts` — POST endpoints: approval decide, change execute/simulate/escalate, access decide, incident status update.
`frontend/src/hooks/useMutations.ts` — React Query mutations + cache invalidation.
4 frontend pages wired (Approvals, ChangeDetail, AccessRequestDetail, IncidentDetail).

## Phase 6 — SSE audit stream (done)

`GET /api/audit-events/stream` — SSE. Backend broadcast on every audit write. `useAuditStream()` merges into React Query cache. Audit page updates without refresh.

## Phase 7 — Claude integration (done)

`@anthropic-ai/sdk` installed. `backend/src/services/claude.ts` with two prompt builders (chat, contextual). `backend/src/routes/chat.ts` with SSE streaming. `frontend/src/lib/api.ts` extended with `chatStream()`. ChatPanel + ContextualAssistant wired to real streaming, mock responses removed.

## Phase 8 — Skills registry + context builder + advisor refactor

**Goal.** Replace ad-hoc `claude.ts` callers with a registry of named, typed skills. Every skill call writes provenance.

**Deliverables.**
- `backend/src/services/skills/registry.ts` — Map of skill name → `{ inputSchema, outputSchema, promptTemplate, kind, defaultModel }`.
- `backend/src/services/skills/runner.ts` — `runSkill(name, input, context)`:
  1. Build prompt from template + input + context (T1–T6).
  2. Hash prompt.
  3. Call Anthropic SDK.
  4. Parse + validate output against schema.
  5. Write `agent_invocations` row.
  6. Return validated output.
- `backend/src/services/skills/prompt.ts` — context builders (T1, T2, T4, T5).
- `backend/src/services/skills/types.ts` — shared types.
- 12 skill specs in `/skills/<verb_noun>/skill.md` — read by registry at boot.
- Refactor `routes/chat.ts` to use the registry instead of inline prompt construction.
- Refactor existing advisors (whatever uses `claude.ts` directly) to use the registry.
- Tests: per-skill unit tests with fixed input → output contracts.

**Verification gate.**
- All chat traffic produces `agent_invocations` rows.
- Skills with deterministic test fixtures produce deterministic prompt hashes.
- Refactored chat endpoints behave identically from the frontend's perspective (regression-tested manually + smoke).
- Schema for each skill is both code-typed (Zod) and doc-typed (skill.md).

**Out of scope for this phase.** Autonomous skills. Phase 8 is *infrastructure*; no new skills go autonomous.

## Phase 9 — Tier-2 autonomous skills (read-path)

**Goal.** Wire `assess_change`, `analyze_blast_radius`, `route_request`, `support_approval_decision` into change intake. Wire `triage_incident` into incident intake. Wire `evaluate_access_request` into access intake.

**Deliverables.**
- `services/change-assessment/intake.ts` — runs after `POST /api/changes` insert, calls skills in order, updates the change row's nested fields.
- `services/incident-triage/intake.ts` — runs after `POST /api/incidents` insert.
- `services/access-eval/intake.ts` — runs after `POST /api/access-requests` insert.
- Each intake writes its own audit events with the agentInvocation FK.
- Skills run synchronously in v1 (request blocks until done). Async/queued is v2.
- UI updates to show "triage in progress" → "triage complete" badge.

**Verification gate.**
- Filing a new change via API produces a change with `riskLevel` reassessed (or unchanged), populated `blastRadius[]` and `recommendations[]`, and an Approval row with co-approvals + decisionImpact.
- Filing a new incident produces an incident with severity, likelyIssueType, rootCauseCategory, recommendedFix populated.
- Filing a new access request produces an access request with riskLevel, entitlementCheck, two Approval rows (manager + owner) with decisionImpact strings.
- Each intake writes the expected audit events in order.
- No skill writes to the DB; only the calling service does.

**Risk.** Skill prompt drift (output not matching schema). Mitigation: every skill has a low-temp call (≤0.2), strict schema, and `validation_failed` recorded if parse fails. The intake degrades gracefully (entity stays with intake values).

## Phase 10 — MCP client connections

**Goal.** Replace any seed-or-stub data sources with live MCP integrations.

**Deliverables.**
- `backend/src/mcp/client.ts` — registry + lifecycle.
- `backend/src/mcp/servicenow.ts` — adapter (webhook listener + outbound update).
- `backend/src/mcp/github.ts` — PR + CI status fetches.
- `backend/src/mcp/opa.ts` — bundle sync routine (every 5m).
- `routes/settings.ts` — `GET /api/settings/integrations`, `POST /api/settings/integrations/:name/test`.
- Frontend Settings page wired to real status.
- Webhook endpoint for ServiceNow ticket events.

**Verification gate.**
- Settings page shows live connection status for all three.
- Manual test button triggers a real round-trip and reports.
- A new ServiceNow ticket appears in Sentinel within 60s of creation.
- A blast-radius analysis on a real change pulls real PR + CI data.
- OPA bundle changes (admin edits in OPA) appear in `policy_rules` within 5m.

**Out of scope.** Outbound updates back to ServiceNow on Sentinel decisions. v1: log them locally. v2: write back via `updateTicket`.

## Phase 11 — Tier-3 autonomous skills (write-path)

**Goal.** Allow `propose_bounded_remediation` to *create* a Change row autonomously when triggered from incident triage, gated by an explicit policy bundle that authorizes the action.

**Deliverables.**
- New policy rule type: `auto_remediation` — explicitly allows certain remediation classes to bypass the engineer-click intermediate step.
- Skill output → change creation pipeline.
- Audit events with `actor='system'`.
- UI changes to show "auto-proposed" badges and let humans intervene.

**Verification gate.**
- A SEV3 recurring incident on a service with `auto_remediation` policy enabled produces an auto-created Change in `pending_review`.
- The change still goes through normal approval; only the *creation* step is autonomous.
- Audit shows `change_filed` with `actor='system'` + agentInvocation linked.
- Disabling the policy rule immediately disables auto-creation.

**Out of scope (post-v1).**
- Auto-execute. Even with auto-create, execution is human-only.
- Cross-skill multi-step planning. Each Tier-3 skill is single-step.

## Cross-phase invariants (must hold from phase 1 onward)

1. **Audit table is append-only.** No phase introduces UPDATE/DELETE on `audit_events`.
2. **Policy engine has no LLM calls.** From phase 5 forward, this is enforced by code review.
3. **Skills validate output.** From phase 8 forward, every skill has a Zod schema; validation_failed is logged, never silently passed through.
4. **No agent → DB write.** Services own writes. Skills return data; services persist.
5. **Provenance for every agentic call.** From phase 8, every `runSkill()` writes `agent_invocations`. Existing chat traffic from phase 7 will be retrofitted in phase 8.

## What is *not* a phase

- **Multi-tenant** — out of scope for the foreseeable future.
- **Public API** — Sentinel is internal. No rate limiting / API key infrastructure.
- **Dashboards beyond the existing pages** — analytics is a v2+ project.
- **Mobile / offline** — desktop browser only.
- **Localization** — English only in v1.
