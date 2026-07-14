# Sentinel

> An ops console where Claude reads the messy parts (PR diffs, incident
> chatter, half-typed access requests) and writes back a structured
> proposal — risk level, blast radius, who needs to approve, what
> happens if you say yes. The human still pushes the button. Sentinel
> just makes sure pushing the button is the only fast path, and that
> every push leaves a trail.

![status](https://img.shields.io/badge/status-personal--project-blue)
![stack](https://img.shields.io/badge/stack-react%20%2B%20fastify%20%2B%20postgres-green)
![model](https://img.shields.io/badge/model-claude--sonnet--4--6-purple)

---

## Why Sentinel

Tools that let an LLM touch production usually pick one of two shapes:
a chatbot that suggests things and the human pastes them somewhere
useful, or an autonomous agent that does the work and tells you about
it afterwards. The first is too slow, the second is too scary.

Sentinel splits the difference. The agent runs the analysis — read the
change, find the affected services, classify the risk, look up the
right approvers, draft the message. It writes that analysis into the
database as a proposal, and the UI surfaces it next to the buttons that
turn it into a real action.

Three rules show up everywhere in the code:

1. **No silent action.** Every state change writes an immutable `AuditEvent`. The table has no update or delete path — nothing gets quietly rewritten.
2. **No bypass.** Policy rules are reloaded from the DB on every skill invocation. Editing a rule in the UI changes the next agent run.
3. **No self-approval.** Whoever filed the request gets dropped from their own approval chain. Doesn't matter what role they have.

---

## What it does

| Domain | Agent does | Human does |
|---|---|---|
| **Changes** | Risk classification · blast radius · approval routing · packet drafting | Approve / deny / merge |
| **Incidents** | Severity triage · 2-3 ranked remediation options · customer reply + work-note drafts | Pick option · send reply · resolve |
| **Access requests** | Eligibility check · policy explanation | Grant · time-box · deny |
| **Approvals** | SOD-clean chain construction · "if approved/denied/escalated" prose | The decision |

---

## Quick start

```bash
# Backend + Postgres (dev mode, hot reload)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d

# Frontend
cd frontend && npm install && npm run dev

# Open http://localhost:5173 → admin@sentinel.dev / password
```

Set up `backend/.env` from `.env.example`. Minimum:
`ANTHROPIC_API_KEY` for agents, `ENCRYPTION_KEY` for credential storage.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Run tests:

```bash
cd backend && npm test   # 96 unit tests, pure logic, no infra needed
cd frontend && npm test  # 38 unit tests, no browser needed
```

More detail in [docs/testing.md](docs/testing.md).

---

## Context tiers

Every skill prompt gets assembled out of named context tiers, so you can
read the prompt and know exactly what the agent was looking at when it
made a call. The runner caches the static tiers and only re-renders the
dynamic ones per request:

- **T1.a** identity — what the agent is, what platform it's on
- **T1.b** policy bundle — the active rules, pulled fresh from the DB
- **T1.c** role constraints — what the operating role is allowed to do
- **T1.d** org catalog — users, teams, services, ownership
- **T1.e** skill registry — the other skills this run can reach for
- **T2** recent activity on the affected service (deploys, incidents)
- **T4** the relevant slice of the audit log
- **T5** time-aware context — current time, weekend, active freeze windows

Which tiers each skill receives is mapped in
[`docs/skills-context-audit.md`](docs/skills-context-audit.md).

---

## Design docs

The interesting reading. Each is a focused explainer of one part of the system.

**Core model**
- [Engineering ontology](docs/ontology/engineering-ontology.md) — Change, Incident, Approval, BlastRadiusItem, PolicyRule, CoApproval, DecisionImpact, AuditEvent
- [Business ontology](docs/ontology/business-ontology.md) — domain → ops mapping
- [Approval model](docs/ontology/approval-model.md) — SOD, chain construction, optimistic locking
- [Role model](docs/ontology/role-model.md) + [Permissions](docs/ontology/permissions.md)

**Agents + skills**
- [Agent system](docs/agents/agent-system.md) — orchestration, composition, idempotency
- [Memory model](docs/agents/memory-model.md) — T1/T2/T4/T5 context tiers, prompt cache strategy
- [UI role surfaces](docs/agents/ui-role-surfaces.md) — what each role sees
- [Skills context audit](docs/skills-context-audit.md) — per-skill T-tier matrix
- [LangChain integration](docs/langchain.md) — where LangChain is used (chat RAG + one skill runtime) and why the split

**Integrations**
- [GitHub](docs/integrations/github.md) · [Slack](docs/integrations/slack.md) · [Linear](docs/integrations/linear.md) · [Sentry](docs/integrations/sentry.md)
- [Adapter overview](docs/integrations/integrations.md)

**Workflows + ops**
- [Workflow contracts](docs/workflows/workflow-contracts.md) — UI ↔ route ↔ skill ↔ audit wire contracts
- [Implementation phases](docs/implementation/implementation-phases.md)
- [DB restore runbook](docs/runbooks/db-restore.md)
- [Testing](docs/testing.md) — Vitest layout + what's covered vs deferred to eval harness

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 19 · TypeScript · Vite 6 · Tailwind v4 · shadcn/ui · TanStack Query |
| Backend | Node 22 · Fastify · Prisma 6 · Anthropic SDK · Zod · Pino |
| DB | Postgres 16 |
| Agent | Claude Sonnet 4.6 with Haiku 4.5 fallback |
| LangChain | Chat RAG (retriever + Xenova embeddings) + one skill runtime (LCEL + `withStructuredOutput` + LangSmith tracing, env-gated) |
| Tests | Vitest (backend node + frontend happy-dom) — 134 unit tests, no infra |
| Ops | Docker Compose · GitHub Actions |

---

## License

Personal project — no warranty, no support.
