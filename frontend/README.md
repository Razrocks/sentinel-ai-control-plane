# Sentinel Frontend

React + TypeScript + Vite + Tailwind v4 + shadcn/ui.

The ops console — every page lives under `src/pages/`. State comes from
TanStack Query hooks in `src/hooks/useData.ts` (reads) and
`src/hooks/useMutations.ts` (writes). UI primitives are the shadcn preset
`b43xY389C` under `src/components/ui/`; shared composites (badges,
EmptyState, ChatPanel, ContextualAssistant, ErrorBoundary) live under
`src/components/shared/`.

See the [root README](../README.md) for the project overview, quick-start,
and architecture diagram.

## Run

```bash
npm install
npm run dev          # vite on http://localhost:5173
npm run build        # tsc + vite build
npm run lint         # eslint
```

Backend must be running at http://localhost:3001 — see `../docker-compose.yml`.

## Structure

```
src/
├── pages/                  # one file per route
│   ├── Dashboard.tsx       # 5 role-specific dashboards in one file
│   ├── Approvals.tsx       # inbox + decision cards + NotesSection
│   ├── Changes.tsx         # list + KPI row
│   ├── ChangeDetail.tsx    # 3-col + tab nav
│   ├── Incidents.tsx       # list + KPI row
│   ├── IncidentDetail.tsx  # 2-col + accordion body + multi-option remediation picker
│   ├── AccessRequests.tsx
│   ├── AccessRequestDetail.tsx
│   ├── AuditTrail.tsx      # filterable stream + SSE live tail
│   ├── Policies.tsx        # rule CRUD + agent-context preview
│   ├── Settings.tsx        # integration cards
│   ├── AdminMetrics.tsx    # skill costs, latency, model usage
│   ├── Setup.tsx           # first-run wizard
│   └── Login.tsx
│
├── components/
│   ├── ui/                 # shadcn preset primitives — don't hand-edit
│   ├── shared/             # app-specific composites
│   │   ├── EmptyState.tsx
│   │   ├── ErrorBoundary.tsx
│   │   ├── ChatPanel.tsx
│   │   ├── ContextualAssistant.tsx
│   │   ├── ReanalyzeButton.tsx
│   │   ├── RiskBadge.tsx
│   │   ├── ApprovalBadge.tsx
│   │   └── ...
│   └── layout/             # AppShell, Sidebar, TopBar
│
├── hooks/
│   ├── useData.ts          # GET hooks (useChanges, useIncidents, ...)
│   ├── useMutations.ts     # POST/PATCH/DELETE hooks with toast + If-Match
│   ├── useAuditStream.ts   # SSE subscription
│   └── useSetup.ts
│
├── lib/
│   ├── api.ts              # fetch wrapper + ApiError
│   ├── auth.ts             # JWT context + useAuth
│   ├── roles.ts            # role → permitted actions map
│   ├── self-monitor.ts     # lazy Sentry stub (opt-in)
│   └── utils.ts            # cn(), formatDate(), timeAgo()
│
├── types/index.ts          # mirrors backend response shapes
└── main.tsx                # ErrorBoundary + QueryClient + Toaster + Router
```

## Key conventions

- **Path alias `@/`** → `src/`. Configured in `vite.config.ts` and
  `tsconfig.json`.
- **Tailwind v4 with `@theme inline`** — design tokens in `src/index.css`.
  No `tailwind.config.js`.
- **shadcn primitives** — installed via preset `b43xY389C`. The Card
  primitive has `overflow-hidden` REMOVED globally so text near rounded
  corners doesn't get clipped (see `src/components/ui/card.tsx`).
- **Optimistic locking (B5)** — mutations on versioned entities send
  `If-Match: "<version>"` + `expectedVersion` body field. 412 → auto
  refetch + warning toast.
- **Toast pattern** — `useMutation` hooks call `toast.success()` on
  success, route 412 to a warn toast, fall through to a generic error
  toast with backend `message` surfaced via `readableError()`.
- **Chat persistence** — ChatPanel + ContextualAssistant use a
  deterministic sessionId (`global` / `entity-<type>-<id>`) so the same
  user on a different browser sees the same conversation. Server is
  source of truth; localStorage is a cache.

## Adding a page

1. Create the component under `src/pages/`.
2. Register the route in `src/App.tsx`.
3. Add a sidebar entry in `src/components/layout/Sidebar.tsx` if the page
   is user-navigable.
4. Use a query hook in `src/hooks/useData.ts` for data; don't fetch inline.
5. Reach for shadcn primitives over hand-rolled equivalents.

## Optional opt-ins

| Feature | How to enable |
|---|---|
| Sentry error reporting | `npm install @sentry/react` + add `VITE_SENTRY_DSN=...` to `.env`. Wired in `src/lib/self-monitor.ts` via lazy dynamic import — no-op when not configured. |
