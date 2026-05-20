# Memory Model

What the agent layer remembers, what is cached, what is per-turn vs per-entity. This is *not* a vector store; Sentinel does not embed-and-retrieve over arbitrary corpora. Memory here means **what the prompt builder includes** at each call site, broken into tiers by lifetime and cacheability.

## Six tiers

| Tier | Name | Lifetime | Cacheable | Source |
|---|---|---|---|---|
| **T1** | Identity & Policy | Until policy or role config changes | Yes — system-prompt-cache friendly | Static config files + policy bundle |
| **T2** | Entity | Lifetime of the entity | Per-entity, with version | DB rows for change/incident/access-request |
| **T3** | Conversation | Lifetime of the user session | Per-session | In-memory on the assistant orchestrator |
| **T4** | Audit & KB | Long-lived, append-only | Read-mostly | DB (audit_events) + MCP (KB articles) |
| **T5** | Temporal | Hours | Per-snapshot | Composed at request time |
| **T6** | Session | Single turn | No | Built fresh per request |

## T1 — Identity, Policy & Org Catalog

**What it is.** The persistent context every Claude call gets at the top of the system prompt. Five sub-sections:

**T1.a — Sentinel identity.**
- Role definition: "you are an assistant for a policy-enforced operational control plane."
- The closed verb set and the skill registry summary.
- Hard constraints: never decide policy, never trigger state-changing actions from chat, never invent users/services/policies that aren't in the catalog.

**T1.b — Policy bundle.**
- Active rule names, scopes, decisions, descriptions.
- Active bundle version + last sync timestamp.

**T1.c — Role-aware constraints.**
- The current user's role and what it can/cannot do (the `permissions.md` matrix, narrowed to one row).
- Separation-of-duties rules relevant to the role.

**T1.d — Org & Service Catalog** *(this tier is the "who-to-contact" backbone)*.
- **User directory:** every active user — `id, name, email, team, role`. Compact JSON or table.
- **Manager hierarchy:** `userId → managerId` map (built from `User.managerId`). Lets the agent answer "who is my manager / their manager / their reports."
- **Service catalog:** every known service identifier → `{ ownerTeam, owners[] }` (built by indexing `User.systemsOwned`). Lets the agent answer "who owns payment-service" / "who do I talk to about a problem in the customer-data-warehouse."
- **Team directory:** team name → member list, role distribution. Lets the agent answer "who is on the SRE team."
- **Approver registry:** for each role flag (`approver`, `access_approver`, `admin`), the users who hold it. Lets the agent answer "who can approve a change to this service" without LLM inference.

**T1.e — Skill registry summary.**
- Names + one-line purpose of every registered skill, so the agent picks the right one.
- Capabilities the agent has *without* calling a skill (catalog lookup, state summary, decision narration).

**Why cacheable.** Anthropic prompt caching is keyed by prefix. Identical T1 prefix across thousands of calls → cache hit. T1 changes when admin edits policy, when an admin promotes/demotes a user, when ownership changes, when the bundle reloads. Otherwise it is identical for every user, every turn, every skill.

**Implementation.** The prompt builder (`backend/src/services/skills/prompt.ts`) loads T1 once per process startup and refreshes on:
- Policy bundle reload (admin action).
- User table mutation (create / role change / managerId change / systemsOwned change).
- Skill registry version bump.

T1 is concatenated to the front of every prompt with `cache_control: ephemeral` set on the relevant content blocks (when the SDK supports it).

**Bounded size.** Target ≤ 8 KB. The org & service catalog dominates; if it pushes past 16 KB the prompt builder switches to a *summarized* catalog (top N most-active services + the requesting user's adjacent context) and lazy-loads the rest via per-turn reads. v1 cap: ~200 users / ~50 services fits comfortably; beyond that, summarize.

**Why catalog-in-prompt instead of tool-call lookup.** Two reasons:
1. **Latency.** A "who owns this" question shouldn't cost an extra round trip — the answer is bounded data and fits in cache.
2. **Conversational cohesion.** Catalog inline means the agent can *weave* ownership into multi-part answers ("the change is blocked because chain co-approver C. Davies hasn't decided — she owns the database tier and is on the SRE team") without orchestrating tool calls per fact.

## T2 — Entity

**What it is.** The entity the current operation is about — a Change row, an Incident row, an AccessRequest row, plus its first-degree relations (blast radius, co-approvals, etc.).

**Lifetime.** As long as the entity row's `updated_at` is unchanged.

**Cacheable.** Yes, per `entityType:entityId:updated_at`. A second skill call against the same entity within the same `updated_at` reuses the entity context.

**Implementation.** The orchestrator loads the entity with relations once per request and passes it through. For SSE chat with multiple turns about the same entity, the entity is reloaded only when its `updated_at` changes (cheap to check).

**What's *not* in T2.** Audit history. Other entities. Policy. Those live in their own tiers.

## T3 — Conversation (per-user memory)

**What it is.** Per-user conversational memory spanning chat sessions plus a self-recall channel for skills:
- **userHistory** — recent chat messages this user exchanged with the assistant (ChatPanel + ContextualAssistant), across sessions.
- **recentInvocations** — last N skill invocations run *for this user*, so the assistant can recall "I analyzed CHG-002 for you ten minutes ago" without a tool call.
- **session metadata** — current sessionId + pagePath, when relevant.

**Lifetime.** Persisted across restarts. Bounded retention (rolling window per user, kept indefinitely in v1; future: TTL).

**Storage.** Postgres `chat_messages` table (id, userId, sessionId, role, content, contextJson, createdAt) with indexes on `(userId, createdAt DESC)` and `(sessionId, createdAt)`. The `agent_invocations` table provides the recentInvocations stream.

**Bounded.** Each call loads up to 10 user messages + 5 invocations by default. Conservative to bound prompt size; tuneable per call via `LoadT3Options`.

**Privacy.** Scoped to the requesting user. Other users' chats never appear. Org-wide activity belongs in T4, not T3.

**Cacheability.** Medium. The user's recent history is stable within a session window but invalidates as soon as they send a new message. Goes in the *dynamic* (non-cached) half of the prompt.

**Implementation.**
- Loader: `backend/src/services/chat-memory.ts` → `loadT3FromUser({ userId, sessionId, pagePath })` returns a `T3Context`.
- Renderer: `backend/src/services/skills/prompt.ts` → `renderT3Context(t3)` emits two markdown sections: "Your Past Conversations With This User" and "This User's Recent AI Analysis Runs".
- Compose: `buildSystemPrompt(ctx, { includeT3: true })` injects T3 after CACHE_BREAK_MARKER (dynamic half).
- Persistence: `saveChatMessage()` is called by `routes/chat.ts` on every user-sent and assistant-streamed turn (assistant save is fire-and-forget after stream end).

**When skills opt in.** Skills called from a chat surface can set `includeT3: true` to inherit the calling user's conversation context. Autonomous skills (triage at intake, etc.) leave T3 off — they're not user-initiated.

## T4 — Audit & KB

**What it is.** Reference material an agent may need:
- Recent audit events — either **org-wide** (used by chat to answer "what's been happening?") or **entity-scoped** (used by skills like `triage_incident` to find related changes).
- Knowledge base articles linked to the entity (via `relatedCI` for incidents, via service for changes).

**Lifetime.** Audit is append-only and indexed; KB is fetched on demand from MCP and cached for 1 hour.

**Cacheable.** Audit slices are not pre-cached; they're fetched per request. KB articles are cached by URL with 1-hour TTL.

**Implementation.**
- Loader: `backend/src/services/chat-memory.ts` → `loadT4RecentAudit({ objectId?, objectType?, limit? })` returns a `T4Context`. Without filters, returns the most recent N events org-wide.
- Renderer: `backend/src/services/skills/prompt.ts` → `renderT4Context(t4)` emits a "Recent System Activity" markdown section with actor + action + object + result per line.
- Compose: `buildSystemPrompt(ctx, { includeT4: true })` injects T4 in the dynamic half (after CACHE_BREAK_MARKER).

**Why not cached aggressively.** Audit changes constantly; caching would mask recent activity. KB is cached because it changes rarely.

## T5 — Temporal

**What it is.** "What is true *right now*":
- Active freeze windows (`isActive=true AND now ∈ window`).
- Current time relative to maintenance windows (e.g. "the requested window starts in 18 hours").
- Recent (last 24h) deploy activity on the same service.

**Lifetime.** Hours; refreshed per request.

**Cacheable.** Per-snapshot, with TTL ≤ 60 seconds. Useful when many skills run within a single request.

**Implementation.** Built by a `temporalContext()` helper called by the orchestrator at request entry. Passed by reference to all skills in the request.

## T6 — Session

**What it is.** Single-turn ephemerals:
- The user's current message.
- The page path they're viewing.
- The skill being invoked and its parameters.
- A request ID for log correlation.

**Lifetime.** One Claude call.

**Cacheable.** No.

## How tiers compose at a call site

For a skill invocation, the prompt is constructed in this order:

```
[ T1 ] System prompt header (cached prefix)
       - Sentinel identity, closed verb set, role constraints

[ T1 ] Policy bundle summary (cached prefix continued)
       - Rule names, scopes, decisions relevant to this skill

[ T2 ] Entity context (per-entity cache)
       - Full entity JSON + first-degree relations
       - Skill-relevant subset; not the whole DB

[ T4 ] Reference slice (request-fresh)
       - Last 50 audit events for this entity
       - KB articles linked to entity

[ T5 ] Temporal context (request-fresh)
       - Active freeze windows
       - Maintenance window timing
       - Recent same-service activity

[ T3 ] Conversation history (session-scoped, only for chat agents)
       - Last N user/assistant turns

[ T6 ] User turn (always fresh)
       - User's current message
       - Or, for autonomous skills, the trigger
```

Skills that run autonomously (intake skills) skip T3.

## What memory is *not*

- **Not a vector store.** No embeddings, no semantic retrieval. Sentinel knows its own ontology; it does not need fuzzy lookup over its own data.
- **Not user preferences.** No "remember that I prefer concise answers" in v1.
- **Not cross-session.** ChatPanel does not remember the previous session. (ContextualAssistant on the same entity may, in v2.)
- **Not training data.** Sentinel does not fine-tune on user data.

## Cache invalidation

| Tier | Invalidates when |
|---|---|
| T1 | Policy bundle reloaded; role config changed; skill registry version bumped |
| T2 | Entity `updated_at` changes |
| T3 | Session ends |
| T4 (KB) | TTL expires (1h); explicit reload from admin |
| T4 (audit) | Never cached |
| T5 | TTL expires (60s) |
| T6 | Per request — no cache |

## Token-budget targets

For a single skill call, the target prompt budget is:

| Tier | Target tokens |
|---|---|
| T1 | ≤ 2000 |
| T2 | ≤ 1500 |
| T3 | ≤ 2000 (chat only) |
| T4 | ≤ 1000 |
| T5 | ≤ 200 |
| T6 | ≤ 500 |
| **Total** | **≤ 7200** |

Output budget: ≤ 1024 tokens for advisory skills, ≤ 2048 for `draft_*` skills.

If a skill's prompt exceeds budget, the prompt builder logs a warning and truncates the lowest-priority tier first (T4 audit slice). T1, T2, T6 are never truncated.

## Provenance hooks

Every skill call records:
- `prompt_hash` — SHA-256 of the rendered prompt (post-cache-substitution).
- `tokens_in` / `tokens_out` — from the SDK response.
- `cached` — whether the response came from the content-addressed cache (v2; v1 always `false`).

This makes it possible later to ask "which skill calls used the same T1+T2 and could have been cached?" — informing the v2 cache design.
