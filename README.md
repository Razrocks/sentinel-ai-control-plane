# Sentinel

> A policy-enforced operational control plane for AI agents. Built to let
> Claude do real work in production systems — opening PRs, triaging
> incidents, granting access — without ever letting it skip an audit log,
> bypass a policy rule, or self-approve its own actions.

![status](https://img.shields.io/badge/status-personal--project-blue)
![stack](https://img.shields.io/badge/stack-react%20%2B%20fastify%20%2B%20postgres-green)
![model](https://img.shields.io/badge/model-claude--sonnet--4--6-purple)

---

## Why Sentinel exists

Most "AI ops" tooling is either a chatbot bolted onto a dashboard or a
fully autonomous agent with no brakes. Sentinel sits in the middle: the
agent does the **cognitive** work (classify risk, propose options, draft
prose, find the right approver), but every **action** flows through a
human-readable policy gate and an immutable audit log.

The system is designed around three hard rules:

1. **No silent action.** Every state change emits an `AuditEvent`. The
   table has no `UPDATE` or `DELETE` paths in code — it's append-only.
2. **No bypass.** Policy rules are loaded fresh on each skill invocation
   and rendered into the prompt as `T1.b PolicyBundle`. The agent reads
   what it's bound by every time.
3. **No self-approval.** Separation of Duties is enforced at the
   `ApprovalRouterAgent` layer — the filer is dropped from the approver
   chain regardless of role.

If a human disagrees with the agent, the agent loses. The agent's job is
to do the boring reasoning fast so the human's job becomes a yes/no on
the proposal, not a from-scratch analysis.

---

## What it does (concretely)

| Domain | What the agent does | What stays with the human |
|---|---|---|
| **Changes** | Classifies risk · computes blast radius · routes to approvers · drafts the approval packet | Approves / denies / escalates · merges PR |
| **Incidents** | Triages severity · proposes 2-3 ranked remediation options · drafts customer reply + work note | Picks the option · sends the reply · marks resolved |
| **Access requests** | Evaluates eligibility against policy · checks entitlements · explains the decision | Grants / denies · sets time-box |
| **Approvals** | Constructs SOD-clean chain · generates "If approved / If denied / If escalated" impact prose | The actual decision |

Everything is wired into a single TanStack-Query-driven UI where the
operator sees the agent's reasoning inline, can challenge it via a chat
panel (with full conversation persistence), edit policy rules with rich
context that feeds back into the next agent run, and watch the audit
trail update live.

---

## Quick start

```bash
# Backend + Postgres (dev mode with hot reload)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d

# Frontend
cd frontend && npm install && npm run dev

# Open http://localhost:5173
# Log in as admin@sentinel.dev / password
```

Set up `backend/.env` from `.env.example` first — minimally need
`ANTHROPIC_API_KEY` for agent skills to work, and `ENCRYPTION_KEY` for
integration credential storage:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

---

## Architecture

### Layered view

```
┌─────────────────────────────────────────────────────────────────────┐
│  UI layer                                                           │
│  React 19 · shadcn/ui · TanStack Query · React Router               │
│  - Role-aware action surfaces (operator/engineer/approver/admin)    │
│  - ChatPanel (global) + ContextualAssistant (per-entity)            │
│  - Persistent chat across browsers/devices via backend store        │
└────────────────────┬────────────────────────────────────────────────┘
                     │ REST + SSE
┌────────────────────▼────────────────────────────────────────────────┐
│  Route layer (Fastify)                                              │
│  - RBAC middleware (role × action matrix)                           │
│  - B5 optimistic concurrency (If-Match / expectedVersion → 412)     │
│  - Idempotency replay (X-Idempotency-Key)                           │
└────────────────────┬────────────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────────────┐
│  Skill runner                                                       │
│  - Loads T1/T2/T4/T5 context tiers (policy · org · audit · time)    │
│  - Renders prompt with cache breakpoint between cached/dynamic      │
│  - Runs skill against Anthropic SDK                                 │
│  - A9 self-critique pass → blocks hallucinations before persist     │
│  - Validates output against Zod schema → audit emission             │
└────────────────────┬────────────────────────────────────────────────┘
                     │ Prisma
┌────────────────────▼────────────────────────────────────────────────┐
│  Postgres                                                           │
│  Users · Changes · Incidents · AccessRequests · Approvals           │
│  · PolicyRules · CoApprovals · DecisionImpact · IncidentNotes       │
│  · ApprovalNotes · ChatMessages · Integrations (AES-GCM encrypted)  │
│  · AuditEvents (append-only, every state change logged)             │
└────────────────────┬────────────────────────────────────────────────┘
                     │ HMAC-verified webhooks
┌────────────────────▼────────────────────────────────────────────────┐
│  External integrations                                              │
│  GitHub · Slack · Linear · Sentry                                   │
└─────────────────────────────────────────────────────────────────────┘
```

### Context-tier model

Every skill receives a layered prompt assembled from these context tiers
(see [`docs/skills-context-audit.md`](docs/skills-context-audit.md) for
the per-skill matrix):

- **T1.a Identity** — who the agent is, what platform it runs on
- **T1.b PolicyBundle** — active rules (live-edited from `/policies` page)
- **T1.c RoleConstraints** — what the *operating* role is authorized to do
- **T1.d OrgCatalog** — users · teams · services · ownership graph
- **T1.e SkillRegistry** — other skills available to this run
- **T2** — recent deploys + incidents on the affected service
- **T4** — relevant slice of the audit log
- **T5** — temporal context (current time, weekend, active freezes)

The cached/dynamic split goes through a `<CACHE_BREAK>` marker so
Anthropic's prompt cache hits on the policy + org context across calls.

### The agent loop

```
                       ┌──────────────────────────┐
                       │   Webhook / UI trigger   │
                       └──────────┬───────────────┘
                                  │
                ┌─────────────────▼──────────────────┐
                │   Triage Agent (assess_change /    │
                │   triage_incident / etc)           │
                └─────────────────┬──────────────────┘
                                  │  produces risk + structured fields
                ┌─────────────────▼──────────────────┐
                │   Self-critique (A9)               │
                │   blocks hallucinated entities,    │
                │   contradiction with policy,       │
                │   missing required fields          │
                └─────────────────┬──────────────────┘
              persist + audit     │   or fail → audit only
                ┌─────────────────▼──────────────────┐
                │   ApprovalRouter (route_request +  │
                │   support_approval_decision)       │
                └─────────────────┬──────────────────┘
              CoApproval chain    │   + DecisionImpact prose
                ┌─────────────────▼──────────────────┐
                │   Human decision (approve/deny/    │
                │   escalate) via UI or Slack        │
                └─────────────────┬──────────────────┘
                                  │
                ┌─────────────────▼──────────────────┐
                │   Audit + downstream sync          │
                │   (Slack notify · GitHub merge ·   │
                │   Linear status push)              │
                └────────────────────────────────────┘
```

---

## Integrations

Per-integration setup, scopes, troubleshooting:

- [**GitHub**](docs/integrations/github.md) — PR ↔ Change sync, CI status, controlled merge
- [**Slack**](docs/integrations/slack.md) — channel routing, interactive approve/deny
- [**Linear**](docs/integrations/linear.md) — ticket ↔ Change bidirectional sync
- [**Sentry**](docs/integrations/sentry.md) — error events → auto-Incident with dedup
- [Integrations overview](docs/integrations/integrations.md) — adapter pattern + webhook router

---

## Design docs (read these to understand the system)

### Core model

- [**Engineering ontology**](docs/ontology/engineering-ontology.md) — the abstractions: Change, Incident, Approval, BlastRadiusItem, PolicyRule, CoApproval, DecisionImpact, AuditEvent
- [**Business ontology**](docs/ontology/business-ontology.md) — how the domain concepts map to ops reality
- [**Approval model**](docs/ontology/approval-model.md) — SOD enforcement, chain construction, optimistic locking semantics
- [**Role model**](docs/ontology/role-model.md) — operator · engineer · it_support · approver · access_approver · admin
- [**Permissions**](docs/ontology/permissions.md) — action × role matrix (mirrors `backend/src/middleware/rbac.ts`)

### Agents

- [**Agent system**](docs/agents/agent-system.md) — orchestration, skill composition, idempotency
- [**Memory model**](docs/agents/memory-model.md) — context tiers, prompt cache strategy, T1/T2/T4/T5
- [**UI role surfaces**](docs/agents/ui-role-surfaces.md) — what each role sees + can do

### Skills

- [**Skills context audit**](docs/skills-context-audit.md) — per-skill T1/T2/T4/T5 inclusion matrix + rationale
- Each skill has a full spec in [`skills/<name>/skill.md`](skills/) — purpose, input/output, prompt structure, eval cases

### Workflows

- [**Workflow contracts**](docs/workflows/workflow-contracts.md) — the wire contracts between UI ↔ route ↔ skill ↔ audit
- [**Implementation phases**](docs/implementation/implementation-phases.md) — phase plan + decisions log

### Ops

- [**DB restore runbook**](docs/runbooks/db-restore.md) — backup schedule + restore drill
- [Integration MCP model](docs/integrations/mcp-model.md) — how MCP-style adapters compose

---

## Scripts

```bash
./scripts/smoke.sh                  # end-to-end smoke test (16 assertions)
./scripts/secret-scan.mjs           # scan repo for committed secrets
./scripts/secret-scan.mjs --staged  # only staged files (pre-commit gate)
./scripts/db-backup.sh              # nightly backup helper
./scripts/db-restore.sh FILE        # restore drill
```

Pre-commit hook in `.git/hooks/pre-commit` runs the secret scanner against
staged files; CI mirrors it in `.github/workflows/secret-scan.yml`.

---

## Security posture

- **API key never reaches frontend bundle** — reads `backend/.env` only.
  No `ANTHROPIC_API_KEY` in `import.meta.env`, no proxy through the client.
- **Pino redaction** on log output + secret scrubbing on every error
  message before it reaches the wire.
- **Integration credentials AES-GCM encrypted at rest** via
  `ENCRYPTION_KEY`. Webhook signatures HMAC-verified.
- **Append-only audit table** — destructive UI actions write
  `*_deleted` / `*_unlinked` rows, never erase history. Soft delete on
  notes preserves the row for forensics.
- **Optimistic concurrency (B5)** — every mutation that bumps state
  requires `If-Match` header. Two operators acting on the same approval
  get a clean `412 Precondition Failed`, never a silent overwrite.
- **Idempotency replay** — `X-Idempotency-Key` on actions means a
  network retry never double-executes.
- **Pre-commit + CI secret scan gate** against accidentally committing
  keys or `.env` files.

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 19 · TypeScript · Vite 6 · Tailwind v4 · shadcn/ui · TanStack Query · React Router · Sonner |
| Backend | Node 22 · Fastify · TypeScript · Prisma 6 · Anthropic SDK · Pino · Zod |
| Database | Postgres 16 (docker) |
| Agent | Claude Sonnet 4.6 (`claude-sonnet-4-6`) with Haiku 4.5 fallback |
| Auth | JWT (access + refresh) · bcrypt password hash |
| Ops | Docker Compose (dev + prod profiles) · GitHub Actions |
| Observability | Pino structured logs · opt-in `@sentry/react` for frontend crashes |

---

## License

Personal project — no warranty, no support. Use freely with attribution.
