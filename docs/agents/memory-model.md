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

## T3 — Conversation

**What it is.** The history of user/assistant turns within a single conversational session (ChatPanel or ContextualAssistant).

**Lifetime.** Until the user navigates away or the session times out.

**Storage.** In-memory on the assistant orchestrator. Not persisted across server restarts in v1. (v2: optionally persisted per user.)

**Bounded.** Last N turns where N is sized to fit within the model's context window after T1 + T2. v1 default: last 10 turns or 8K tokens, whichever is smaller.

**Implementation.** A `conversationStore` map keyed by session ID. Cleared on disconnect. Each turn appends to the relevant session's array.

## T4 — Audit & KB

**What it is.** Reference material an agent may need:
- Recent audit events for the entity in scope (last 50 entries).
- Knowledge base articles linked to the entity (via `relatedCI` for incidents, via service for changes).

**Lifetime.** Audit is append-only and indexed; KB is fetched on demand from MCP and cached for 1 hour.

**Cacheable.** Audit slices are not pre-cached; they're fetched per request. KB articles are cached by URL with 1-hour TTL.

**Implementation.** When a skill needs audit context (e.g. `triage_incident` looking at recent incidents on the same service), the runner fetches the relevant slice and includes it in the prompt as a structured table.

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
