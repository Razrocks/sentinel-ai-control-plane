# Engineering Ontology

The system is decomposed into **subsystems**. A subsystem is a code-level boundary with one set of responsibilities, one set of tests, and one place to look when something breaks. Subsystems are *not* always 1:1 with directories — some span multiple files, some are still notional in v1 — but the names are the canonical vocabulary used in PRs, in audit details strings, and in agent skill specs.

## The 14 subsystems

| ID | Name | Responsibility | Owner directory (v1) |
|---|---|---|---|
| **S1** | Change Assessment | Risk, blast radius classification, recommendation generation for a change. | `backend/src/services/change-assessment/` |
| **S2** | Blast Radius Discovery | Walking dependency graphs (linked PRs, CI dependencies, service catalog) to enumerate downstream impact candidates. | `backend/src/services/blast-radius/` |
| **S3** | Incident Triage | Severity inference, root-cause categorization, KB-article matching, related-change correlation. | `backend/src/services/incident-triage/` |
| **S4** | Access Evaluation | Entitlement check, auto-grant eligibility, manager + owner approval chain construction. | `backend/src/services/access-eval/` |
| **S5** | Approval Engine | Co-approval state machine, condition tracking, propagation to linked entity (change/access/incident). | `backend/src/services/approval-chain.ts` |
| **S6** | Policy Engine | Rule loading, scope matching, decision computation. **Never agentic.** | `backend/src/services/policy-engine.ts` |
| **S7** | Execution Guard | Pre-execute checks: approval state, policy verdict, freeze-window overlap, maintenance window currency. | `backend/src/services/execution-guard.ts` |
| **S8** | Artifact Generation | Drafting work notes, customer responses, approval packets, escalation messages. Skills layer. | `backend/src/services/artifacts/` |
| **S9** | Assistant Orchestrator | Routing chat turns to the correct skill, building per-role context, streaming Claude responses. | `backend/src/services/assistant/` |
| **S10** | Audit | Single write path for `audit_events`. Single broadcast path for SSE. | `backend/src/services/audit.ts` |
| **S11** | UI Surfaces | Role-aware navigation, per-page assistant context, dashboard composition. | `frontend/src/` |
| **S12** | MCP Layer | Client lifecycle, adapter implementations (ServiceNow, GitHub, OPA), connection registry. | `backend/src/mcp/` |
| **S13** | Skills System | Skill registry, prompt builders, validators, provenance writes. | `backend/src/services/skills/` |
| **S14** | Memory | T1–T6 memory tiers (identity/policy, entity, conversation, audit/KB, temporal, session). Cache layer for cacheable tiers. | `backend/src/services/memory/` |

## Dependency graph

```
S11 (UI)  →  S9 (Assistant)  →  S13 (Skills)  →  S14 (Memory)
                              │
                              ├→  S1 / S3 / S4   (assessment / triage / eval)
                              │           │
                              │           └→  S2 (blast radius)
                              │
S11  →  /api/...   →  S5 (Approval)  →  S6 (Policy)  →  S7 (Execution)
                                 │             │
                                 │             └→  S14 (T1 cache)
                                 └→  S10 (Audit) ← every write path lands here
                                                  │
                                                  └→  SSE broadcast → S11
S12 (MCP)  ↔  S2, S3, S6   (integration data feeds discovery, triage, policy bundles)
```

Read this as: every external surface is in S11. Every state-changing operation flows through a service layer; the service layer flows through S6 (policy) and writes through S10 (audit). The agent layer (S9 + S13) sits *beside* the service layer, not above it — agent output is consumed by services, never the reverse.

## Trust boundaries

| Boundary | Direction | Rule |
|---|---|---|
| Browser → API | Untrusted → Trusted | All requests pass JWT verification (`requireAuth`) and RBAC (`requireAction`). |
| API → Service | Trusted → Trusted | Services assume valid auth; they never re-check the token. They *do* re-check role for sensitive ops. |
| Service → Agent (skill call) | Trusted → Untrusted | Service calls skill; skill returns a structured object. Service validates the object (Zod) before using it. |
| Agent → Service | **Forbidden** | Agents have no write methods on services. The skill returns data; the *caller* (a service) decides what to do with it. |
| Agent → DB | **Forbidden** | Agents do not hold a Prisma client. Provenance writes happen in the skill *runner*, which is service-side. |
| Service → MCP | Trusted → Untrusted | MCP responses are validated against a Zod schema before consumption. |

The phrase that captures this: **agents prepare, services decide, audit records.**

## Build invariants

These are properties the system must continuously satisfy. Tests assert them.

1. **Every state-changing endpoint writes exactly one `audit_events` row per state change.** Bulk operations write one row per affected entity.
2. **Every agentic skill call writes exactly one `agent_invocations` row.** Deterministic skills do not.
3. **The `audit_events` table accepts INSERT only.** No UPDATE, no DELETE, ever, at the application level.
4. **Policy evaluation has no side effects.** Calling `evaluatePolicy()` reads only; it does not write.
5. **Freeze-window check is part of execution guard, not policy engine.** Policy says "this kind of change in this scope is `escalate`"; execution guard says "even if approved, you cannot execute right now because frz-001 is active."
6. **Skill outputs are typed.** Every skill has a Zod output schema. Skills returning malformed output are recorded as `validation_failed` and the caller treats the result as absent.
7. **Skill prompts are content-hashed.** The hash goes into `agent_invocations.prompt_hash` so duplicate prompts can be detected and (in v2) cached.

## Versioning

- **Subsystem identifiers** (S1–S14) are stable. New subsystems get new IDs. Subsystems do not get renamed.
- **Skill names** are stable once published in [/skills/README.md](../../skills/README.md). Renaming a skill requires writing a new skill and deprecating the old one.
- **Workflow IDs** (WF-CHG etc.) are stable. New workflows get new IDs.
- **Audit `action` strings** follow the convention `verb_noun` and are stable; new actions are additive.

## What is *not* a subsystem

Things that look like subsystems but are intentionally collapsed into existing ones:

- "Notifications" — there is no notification service in v1. SSE handles real-time UI; everything else is on-demand fetch. If/when external notifications are added, they will be a new subsystem.
- "Search" — no full-text search in v1. List endpoints have filters; that is sufficient.
- "Reporting" — no analytics or dashboard service. The Audit Trail page is the report.
- "User management" — embedded in S5 (approval) and S11 (UI). Promote to a subsystem when the access-control surface grows.
