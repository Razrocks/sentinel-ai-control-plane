# Sentinel Docs

Sentinel is a policy-enforced operational control plane. This directory holds the canonical specification: the ontology, the workflow contracts, the agent system, the integration model, and the build plan. The goal is that any new contributor — human or agentic — can read this tree and understand what the system is, what it does, and how it is allowed to act.

## How to read this tree

Read top-down. The order is roughly: what the system *is*, what it *contains*, how it *behaves*, how it *delegates intelligence*, what it *talks to*, and how it gets *built*.

| When you want to understand... | Read |
|---|---|
| Why this product exists, the problem framing, who uses it | [ontology/business-ontology.md](ontology/business-ontology.md) |
| How the system is decomposed in code: subsystems, dependencies, boundaries | [ontology/engineering-ontology.md](ontology/engineering-ontology.md) |
| The shared language: Change, Incident, AccessRequest, Approval, AuditEvent, Recommendation, FreezeWindow, BlastRadius, AgentInvocation | [ontology/abstractions.md](ontology/abstractions.md) |
| The 6 user roles and what each role is, conceptually | [ontology/role-model.md](ontology/role-model.md) |
| What each role is allowed to do — actions, surfaces, scopes | [ontology/permissions.md](ontology/permissions.md) |
| How approvals are modeled: types, co-approval chains, conditions, propagation | [ontology/approval-model.md](ontology/approval-model.md) |
| The end-to-end flows: WF-CHG, WF-INC, WF-ACC, WF-APR, WF-REM, WF-EXE | [workflows/workflow-contracts.md](workflows/workflow-contracts.md) |
| The 7 v1 agents, their inputs/outputs, allowed skills, tier of autonomy, guardrails | [agents/agent-system.md](agents/agent-system.md) |
| What the agent layer remembers, what is cached, what is per-turn vs per-entity | [agents/memory-model.md](agents/memory-model.md) |
| How agents surface in the UI per role (ChatPanel, ContextualAssistant, role quick-actions) | [agents/ui-role-surfaces.md](agents/ui-role-surfaces.md) |
| What external systems Sentinel talks to and why | [integrations/integrations.md](integrations/integrations.md) |
| How those connections work via MCP — server registry, adapters, lifecycle | [integrations/mcp-model.md](integrations/mcp-model.md) |
| What gets built when, and what each phase deliverable is | [implementation/implementation-phases.md](implementation/implementation-phases.md) |

## Sibling tree

- `/skills/` — agentic skill specs (one folder per skill, each with `skill.md` and optional `memory.md`). See [/skills/README.md](../skills/README.md).
- `/backend/` — Fastify + Prisma + PostgreSQL service.
- `/frontend/` — React + Vite + Tailwind console.

## Status

- **Phase 0** — schema reconciliation: complete (2026-04-27). AgentInvocation, FreezeWindow, condition resolution fields, maintenance window timestamps, user manager hierarchy.
- **Phases 1–7** — backend skeleton through Claude streaming chat: complete.
- **Phase 8** — skills registry, context builder, refactored advisors: in scope next.
- **Phase 9** — autonomous skills (write-path): gated on Phase 8.

## Non-negotiable principles

1. **Deterministic governance.** Policy decisions, approval gates, execution permission, and audit writes never run inside an LLM. They live in services. Agents *advise*; services *decide*.
2. **Provenance for every agentic call.** Every agent invocation that produces an output writes one `AgentInvocation` row, optionally linked to the audit event it produced.
3. **Closed verb set.** Skill names use one of: `assess`, `analyze`, `triage`, `evaluate`, `support`, `draft`, `propose`, `explain`, `summarize`, `route`. New verbs require explicit ontology change.
4. **Audit is append-only.** No application-level update or delete on `audit_events`.
5. **Roles are enforced server-side.** The frontend's `useRole()` is a UX hint, not a security boundary.
