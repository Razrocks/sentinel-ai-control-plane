# Sentinel Backend

Fastify + TypeScript + Prisma + Postgres. The control plane that owns
policy decisions, approval chains, audit, and agent skill invocations.

See the [root README](../README.md) for the project overview and quick-start.

## Run

```bash
# From repo root, dev mode with hot reload:
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d

# Manual (if you don't use docker):
npm install
npx prisma generate
npx prisma db push     # apply schema
npx tsx prisma/seed.ts # create users + sample data
npx tsx watch src/server.ts
```

Backend listens on `http://localhost:3001`. Requires Postgres at the URL
in `DATABASE_URL`.

## Env vars

| Var | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Prisma Postgres connection string |
| `JWT_SECRET` | yes | Signs access + refresh tokens |
| `ENCRYPTION_KEY` | yes | AES-GCM key for integration credentials. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `ANTHROPIC_API_KEY` | for agents | Required for skill runner to call Claude |
| `SENTRY_DSN` | optional | Phase 5.5 — Sentry self-monitoring (requires `npm install @sentry/node`) |
| `SENTINEL_RELEASE` | optional | Tag forwarded to Sentry |
| `NODE_ENV` | optional | `development` enables verbose error messages |

## Structure

```
src/
├── server.ts                       # Fastify boot, error handler, route registration
├── config.ts                       # env var loader + validation
│
├── routes/
│   ├── auth.ts                     # /api/auth/login + /refresh
│   ├── changes.ts                  # GET /api/changes + /:id
│   ├── incidents.ts                # GET /api/incidents + /:id
│   ├── access-requests.ts          # GET /api/access-requests + /:id
│   ├── approvals.ts                # GET /api/approvals + /:id (includes notes + decisionImpact)
│   ├── policies.ts                 # GET + POST + PATCH + DELETE /api/policies
│   ├── audit.ts                    # GET /api/audit-events + SSE /stream
│   ├── chat.ts                     # POST /api/chat + GET /api/chat/messages
│   ├── webhooks.ts                 # /api/webhooks/:type (HMAC-verified intake)
│   ├── settings.ts                 # /api/settings/integrations CRUD
│   ├── setup.ts                    # /api/setup/status + /complete
│   ├── agents.ts                   # POST /api/agents/* — triggers skill pipelines
│   └── actions.ts                  # mutation endpoints (decide / escalate / note / route / etc)
│
├── services/
│   ├── agents/                     # agent classes
│   │   ├── context.ts              # buildBaseContext — loads T1.b/c/d/e + T2 + T5
│   │   ├── change-triage.ts        # ChangeTriageAgent
│   │   ├── incident-triage.ts      # IncidentTriageAgent
│   │   ├── access-reviewer.ts      # AccessReviewerAgent
│   │   └── approval-router.ts      # ApprovalRouterAgent
│   ├── skills/                     # skill runner
│   │   ├── registry.ts             # 12 skill specs (assess_change, triage_incident, ...)
│   │   ├── schemas.ts              # Zod input/output schemas
│   │   ├── prompt.ts               # buildSystemPrompt + tier renderers
│   │   ├── runner.ts               # runSkill — retry + timeout + critique + cache
│   │   └── index.ts                # public surface
│   ├── policy-engine.ts            # checkExecutionAllowed / checkSimulationAllowed
│   ├── approval-chain.ts           # resolveCoApproval — SOD-aware advance
│   └── audit.ts                    # createAuditEvent + helpers
│
├── middleware/
│   ├── auth.ts                     # requireAuth (JWT verify)
│   ├── rbac.ts                     # requireRole + requireAction
│   └── idempotency.ts              # idempotency-key dedup
│
├── integrations/                   # per-system adapters
│   ├── _base/adapter.ts            # IntegrationAdapter interface
│   ├── github/
│   ├── slack/
│   ├── linear/
│   └── sentry/
│
├── lib/
│   ├── prisma.ts                   # singleton Prisma client
│   ├── errors.ts                   # AppError + subclasses (NotFound / Forbidden / 412 / etc)
│   ├── optimistic-lock.ts          # readExpectedVersion + assertVersion (B5)
│   ├── self-monitor.ts             # lazy Sentry stub
│   └── secret-scrub.ts             # never log raw error.message
│
└── ...
```

## Schema migrations

```bash
# Edit prisma/schema.prisma, then:
docker compose exec backend npx prisma db push --skip-generate
docker compose exec backend npx prisma generate
docker compose restart backend
# Frontend Prisma types live in backend's generated client; both runtimes
# share the same SQL schema.
```

For dev iteration we use `db push` (no migrations). The production path
would generate migrations with `prisma migrate dev` instead — out of scope
for this personal project.

## Key conventions

- **Routes never write directly to the LLM.** Skill calls go through
  `services/skills/runner.ts` which handles retry, timeout, idempotency,
  prompt caching, and the A9 self-critique pass.
- **Errors flow through `lib/errors.ts`.** Throw `NotFoundError`,
  `ValidationError`, `ForbiddenError`, `PreconditionFailedError` from
  routes; the global error handler in `server.ts` maps them to HTTP codes
  and scrubs secrets from the message.
- **Append-only audit.** Every state-changing action writes an
  `audit_events` row. There is no `prisma.auditEvent.update()` or
  `.delete()` anywhere in the codebase by design.
- **Optimistic locking (B5).** Versioned entities (Approval, PolicyRule,
  Change, Incident, AccessRequest) carry a `version` int. Mutations
  validate via `readExpectedVersion(request, body.expectedVersion)` +
  `assertVersion(...)`. Writes use `version: { increment: 1 }`.
- **Soft delete on notes.** `IncidentNote` and `ApprovalNote` use a
  `deletedAt` timestamp instead of row deletion so the audit trail can
  still reference the original content.

## Smoke test

```bash
# Backend + DB must be up
./scripts/smoke.sh    # 16 assertions, exits non-zero on any failure
```

## Optional opt-ins

| Feature | How to enable |
|---|---|
| Sentry self-monitoring | `npm install @sentry/node` + add `SENTRY_DSN=...` to `.env`. Wired in `src/lib/self-monitor.ts` via lazy import — no-op when not configured. Server error handler forwards 5xx exceptions via `captureException()`. |
