# Sentinel

Policy-enforced operational control plane for Claude. Internal ops console
for routing changes / incidents / access requests through a multi-skill
agent system with full audit and policy guardrails.

![status](https://img.shields.io/badge/status-personal--project-blue)
![stack](https://img.shields.io/badge/stack-react%20%2B%20fastify%20%2B%20postgres-green)

## What it does

- **Triage and route** changes, incidents, and access requests through
  policy → risk classification → approval chain → execution.
- **Multi-skill agents** that build context from policy bundle + org
  catalog + recent audit history, then propose decisions humans can
  approve, deny, or escalate.
- **Self-critique pipeline** (A9) — agents review their own output
  against hallucination + contradiction rules and block bad runs before
  they reach a human.
- **Multi-option proposals** (A6) — the remediation skill returns 2-3
  ranked alternatives instead of a single take-it-or-leave-it proposal.
- **Full audit trail** for every state change, including notes, draft
  responses, escalations, and policy edits.

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

## Architecture

```
┌───────────────────────────────────────────────────────────────┐
│                       Frontend (React)                         │
│  shadcn/ui · Vite · TanStack Query · React Router              │
└───────────────────┬───────────────────────────────────────────┘
                    │ REST + SSE (audit live stream)
┌───────────────────▼───────────────────────────────────────────┐
│                    Backend (Fastify)                           │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   Routes    │  │  RBAC + B5   │  │   Skill runner       │  │
│  │ (actions/   │  │  optimistic  │  │  + self-critique     │  │
│  │  auth/CRUD) │  │  locking     │  │  + idempotency       │  │
│  └─────────────┘  └──────────────┘  └──────────────────────┘  │
└───────────────────┬───────────────────────────────────────────┘
                    │ Prisma
┌───────────────────▼───────────────────────────────────────────┐
│                   Postgres                                     │
│  Users · Changes · Incidents · Approvals · PolicyRules         │
│  · AuditEvents · ChatMessages · IncidentNotes ·                │
│  · ApprovalNotes · Integrations (encrypted)                    │
└────────────────────────────────────────────────────────────────┘
                    │ HMAC-verified webhooks
┌───────────────────▼───────────────────────────────────────────┐
│  External: GitHub · Slack · Linear · Sentry                    │
└────────────────────────────────────────────────────────────────┘
```

## Integrations

Per-integration setup docs:

- [GitHub](docs/integrations/github.md) — PR → Change sync, CI status, merge button
- [Slack](docs/integrations/slack.md) — channel notifications + interactive approve/deny
- [Linear](docs/integrations/linear.md) — issue ↔ Change bidirectional sync
- [Sentry](docs/integrations/sentry.md) — error events → auto-Incident with dedup

## Key design docs

- [Skill context audit](docs/skills-context-audit.md) — which T1/T2/T5 tiers each skill receives
- [DB restore runbook](docs/runbooks/db-restore.md) — backup + drill + live recovery
- [Ontology + agents](docs/ontology/) — the underlying data model
- [Phase plan](docs/implementation/) — build phases + decisions

## Scripts

```bash
./scripts/smoke.sh                # end-to-end smoke test (16 assertions)
./scripts/secret-scan.mjs         # scan for committed secrets
./scripts/secret-scan.mjs --staged   # only staged files (pre-commit)
./scripts/db-backup.sh            # nightly backup helper
./scripts/db-restore.sh FILE      # restore drill
```

Pre-commit hook in `.git/hooks/pre-commit` runs the secret scanner against
staged files; CI mirrors it in `.github/workflows/secret-scan.yml`.

## Security posture

- API key never reaches frontend bundle. Reads `backend/.env` only.
- Pino redaction on log output + secret scrubbing on all error messages.
- All integration credentials AES-GCM encrypted at rest via
  `ENCRYPTION_KEY`.
- Append-only audit table — destructive UI actions write `*_deleted` /
  `*_unlinked` rows but never erase history.
- Pre-commit + CI gate against accidentally committing secrets.

## Stack

| Layer | What |
|---|---|
| Frontend | React 19 · TypeScript · Vite 6 · Tailwind v4 · shadcn/ui · TanStack Query · React Router · Sonner |
| Backend | Node 22 · Fastify · TypeScript · Prisma 6 · Anthropic SDK · Pino |
| Database | Postgres 16 (docker) |
| Agent | Claude Sonnet 4.6 (`claude-sonnet-4-6`) |
| Auth | JWT (access + refresh) |
| Ops | Docker Compose (dev + prod profiles) |

## License

Personal project — no warranty, no support. Use freely with attribution.
