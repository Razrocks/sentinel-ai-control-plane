# Testing

Sentinel has two testing layers, deliberately.

## Vitest — pure-logic unit tests

Fast (< 5s), no I/O, no external services. Cover the helpers that show
up all over the codebase — errors, prompt rendering, RBAC matrix,
retry math, encryption round-trip, formatting helpers. If any of these
drift, downstream behavior breaks silently, so they get pinned.

**Run:**

```bash
# Backend
cd backend && npm test
cd backend && npm run test:watch   # dev mode

# Frontend
cd frontend && npm test
cd frontend && npm run test:coverage
```

**Backend suites** (`backend/src/**/*.test.ts`):

- [`lib/errors.test.ts`](../backend/src/lib/errors.test.ts) — every error class + PreconditionFailedError version fields
- [`services/skills/reliability.test.ts`](../backend/src/services/skills/reliability.test.ts) — `isTransientError` matrix, `withRetry` w/ fake timers, breaker state transitions, token-bucket refill
- [`services/skills/prompt.test.ts`](../backend/src/services/skills/prompt.test.ts) — `buildSystemPrompt` include/exclude, `splitOnCacheBreak` roundtrip, tier render order
- [`services/skills/validate-references.test.ts`](../backend/src/services/skills/validate-references.test.ts) — `collectStrings`, service-name flagging, input-passthrough allow rule
- [`services/agents/confidence.test.ts`](../backend/src/services/agents/confidence.test.ts) — `gateConfidence` per-skill overrides, null confidence handling
- [`integrations/_base/encryption.test.ts`](../backend/src/integrations/_base/encryption.test.ts) — encrypt/decrypt roundtrip, GCM tamper detection, `maskCredential` boundaries

**Frontend suites** (`frontend/src/**/*.test.{ts,tsx}`):

- [`lib/utils.test.ts`](../frontend/src/lib/utils.test.ts) — `cn`, `formatDate`, `timeAgo` boundaries with `vi.setSystemTime`
- [`lib/api.test.ts`](../frontend/src/lib/api.test.ts) — `apiFetch` with stubbed `fetch`, `ApiError.body`/`status`/`etag` extraction, 412 body preservation
- [`lib/roles.test.tsx`](../frontend/src/lib/roles.test.tsx) — `canAction`/`canAccess` matrix per role, `getActionPermission` reason strings

**Configs:**

- Backend: [`backend/vitest.config.ts`](../backend/vitest.config.ts) — Node env, no globals, co-located test files
- Frontend: [`frontend/vitest.config.ts`](../frontend/vitest.config.ts) — happy-dom env (jsdom v27 has a CJS/ESM incompat on Node 22), setup file registers `@testing-library/jest-dom/vitest` matchers

## Two testing layers

Sentinel splits testing into two complementary layers, each optimized
for what it does best.

**Layer 1 — Vitest (this doc):** covers logic that can fail without a
network. Fast, deterministic, runnable on every save with zero secrets
or infra. Perfect for the pure functions that show up everywhere —
error classes, prompt rendering, RBAC matrices, retry math, encryption,
formatting helpers.

**Layer 2 — [`backend/eval/`](../backend/eval/):** covers logic that
can only fail *with* a network. Runs real model calls against golden
inputs, gated on `ANTHROPIC_API_KEY`. Exercises end-to-end skill runs,
structured-output contracts, A9 self-critique behavior, and prompt
cache hit rate — the parts that involve real LLM inference and need
real inference to validate.

The split is intentional. Trying to unit-test model behavior with mocks
produces expensive tests that don't catch real regressions; trying to
run eval on every save burns tokens and time. Together they give
Sentinel full coverage across both determinism boundaries.

| Layer | Runs against | Speed | Requires | What it catches |
|---|---|---|---|---|
| Vitest | Pure logic | < 5s | Nothing | Helper drift, matrix regressions, encryption tamper, retry/breaker math |
| Eval | Real Anthropic API | ~30s per skill | `ANTHROPIC_API_KEY` | Prompt regressions, structured-output drift, critique false-positives, cache misses |

## CI

[`.github/workflows/test.yml`](../.github/workflows/test.yml) runs the
Vitest suites in a matrix on every push and PR. Eval runs on demand
(`npm run eval`) to control token spend — surface it in CI later on a
scheduled workflow if you want nightly regression signal.
