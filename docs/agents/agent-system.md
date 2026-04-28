# Agent System

The agent layer is **prep, not action**. Agents read entities, call skills, return structured advice. Services consume the advice, write to the database, emit audit events. There is no agent that holds a Prisma client. There is no skill that decides policy.

## Two layers

```
┌──────────────────────────────────────────────────┐
│  Agents (named, role-bound, conversation surface) │
│  - ChangeTriageAgent, ChatPanelAgent, ...         │
│  - Choose which skills to run                     │
│  - Build the system prompt and context            │
│  - Stream output to the UI                        │
└──────────────────────────────────────────────────┘
                       │ (calls)
                       ▼
┌──────────────────────────────────────────────────┐
│  Skills (verb_noun, single-purpose, typed I/O)    │
│  - assess_change, route_request, ...              │
│  - One Claude call per invocation                 │
│  - Validated output schema                        │
│  - Provenance row written by the runner           │
└──────────────────────────────────────────────────┘
```

The agent is the *conversational entity* the user is talking to. The skill is the *atomic unit of LLM work*. An agent may invoke zero, one, or many skills per turn.

## v1 agents (7)

| Agent | Surface | Allowed skills | Tier |
|---|---|---|---|
| **ChangeTriageAgent** | Backend at change intake. Not user-facing. | `assess_change`, `analyze_blast_radius`, `route_request`, `support_approval_decision` | Tier 2 (autonomous on the read path) |
| **IncidentTriageAgent** | Backend at incident intake. Not user-facing. | `triage_incident` | Tier 2 |
| **AccessReviewerAgent** | Backend at access-request intake. Not user-facing. | `evaluate_access_request`, `route_request`, `support_approval_decision` | Tier 2 |
| **ApprovalRouterAgent** | Invoked by approval-chain service when constructing chains. Not user-facing. | `route_request`, `support_approval_decision` | Tier 1 (system-only) |
| **RemediationDrafterAgent** | Triggered from incident detail by engineer/IT. User-facing as a one-shot. | `propose_bounded_remediation` | Tier 1 (human-initiated, human-decided) |
| **ChatPanelAgent** | Global bottom-bar chat (existing UI). | `explain_policy_decision`, `summarize_decision_impact`, `route_request` (read-only routing questions) | Tier 1 |
| **ContextualAssistantAgent** | Right-rail on detail pages (existing UI). Entity-scoped. | All read-side skills + `draft_work_note`, `draft_customer_response`, `draft_approval_packet` | Tier 1 (drafts only, never auto-applies) |

**Tier definitions:**
- **Tier 1** — Human-initiated. Output is shown to the user; no DB writes other than provenance + audit.
- **Tier 2** — Autonomous read-path. Triggered by entity creation. Writes structured fields (e.g. `riskLevel`, `recommendedFix`). Audit + provenance for every call. **Never writes** approvalState, status transitions, or anything in the decision path.
- **Tier 3** — Autonomous write-path. Not in v1. Reserved for future skills like auto-resolve-low-severity-incident, gated by explicit policy bundles.

## Per-agent specifications

### ChangeTriageAgent

**When it runs.** Synchronously after a change is inserted (in the same handler as `POST /api/changes`).

**Input.** Full `Change` row (no relations yet — relations are what this agent *produces*).

**Output.** Side effects on the change row:
- `riskLevel` — possibly revised from intake.
- `blastRadius[]` — fresh rows.
- `recommendations[]` — fresh rows.
- `policyDecision` — invoked via S6 once risk is set; not directly produced by the agent, but the agent's risk feeds into policy.

**Skills called, in order.**
1. `assess_change` — reads change body, returns `{riskLevel, summary, riskRationale, confidence}`.
2. `analyze_blast_radius` — reads change body + linked PRs/services from MCP, returns blast radius items.
3. (Service then calls policy engine deterministically — not a skill.)
4. `support_approval_decision` — runs once per approval row to populate decision-impact strings.

**Guardrails.**
- Cannot revise `status`, `approvalState`, or `policyDecision` — only `riskLevel` and nested rows.
- If `assess_change` returns a higher risk than intake, the change keeps the higher value (defensive).
- If any skill returns `validation_failed`, the change retains its intake state and the agent emits an audit event with `result='blocked'`.

**Failure mode.** Skills can fail; the agent reports per-skill outcomes and the change is still queryable. Operators see a "triage incomplete" indicator.

### IncidentTriageAgent

**When it runs.** Synchronously after an incident is inserted.

**Input.** Full `Incident` row.

**Output.** Side effects on the incident row:
- `severity` — possibly revised.
- `likelyIssueType`, `rootCauseCategory`, `recommendedFix` — set from skill output.
- `kbArticles[]` — populated from the skill's KB matches (KB content fetched via MCP).
- `relatedChanges[]` — populated from temporal correlation with recent change deploys on the same `affectedService`.

**Skills called.** `triage_incident` (single skill in v1).

**Guardrails.**
- Cannot transition `status`. The incident enters `new_incident` and stays there until a human acts.
- `recommendedFix` is *display* — clicking "Apply" routes to WF-REM, never auto-applies.

### AccessReviewerAgent

**When it runs.** Synchronously after an access request is inserted.

**Input.** Full `AccessRequest` row + the requester's `User` row (for manager + systems-owned context).

**Output.** Side effects:
- `riskLevel`, `policyDecision` (latter via deterministic policy engine after risk set).
- `entitlementCheck` — set by deterministic eligibility check, not the skill. The skill rationalizes; the deterministic check decides.
- `managerApprovalRequired`, `ownerApprovalRequired`, `autoGrantAllowed` — derived deterministically from policy.
- Two `Approval` rows created (manager + owner) when required, with `coApprovals[]` populated.

**Skills called.**
1. `evaluate_access_request` — reads request + user context, returns `{riskLevel, justificationQuality, narrative}`.
2. `route_request` — identifies the specific manager and owner and returns chain participants.
3. `support_approval_decision` — populates decision-impact for each approval row.

**Guardrails.**
- Cannot grant access. Only flagging requests as auto-grant-eligible; the actual grant is a separate explicit endpoint.
- If `route_request` cannot identify a manager (e.g. requester has `managerId=null`), the request is held and an admin alert is logged.

### ApprovalRouterAgent

**When it runs.** When the approval-chain service is constructing a new approval (called by ChangeTriageAgent and AccessReviewerAgent — not from a user-facing surface).

**Input.** The approval type, the linked entity, and the org-graph context.

**Output.** A list of `CoApproval` participants, plus a `whyYouAreRequired` string per participant.

**Skills called.** `route_request`, `support_approval_decision`.

**Guardrails.**
- Cannot bypass the SOD rule (filer ≠ approver). If routing produces a conflict, the chain is constructed without the conflicting participant and an audit event flags the omission.

### RemediationDrafterAgent

**When it runs.** On user click — engineer or IT triggers from an incident detail page.

**Input.** The incident + its triage output + the engineer's optional free-text intent.

**Output.** A *proposed change* artifact: title, description, target service, change-type (config/restart/rollback), estimated blast radius, rollback plan flag. The artifact is presented to the engineer; on accept, it becomes a real `Change` row and enters WF-CHG.

**Skills called.** `propose_bounded_remediation`.

**Guardrails.**
- The skill output schema enforces single-service, single-change-type, bounded-blast-radius shape.
- The created `Change` is never auto-approved or auto-executed; it goes through WF-CHG like any other change.

### ChatPanelAgent

**When it runs.** Per user message in the global bottom-bar chat (existing `ChatPanel.tsx`).

**Input.** Conversation history (T3) + page path + role + the full T1 stack (identity, policy, role constraints, **org & service catalog**, skill registry).

**Output.** Streaming text response. Defaults to free-form prose; can attach structured payloads (recommendations, action_proposals) when the answer warrants them.

**Capabilities — what it knows without calling a skill.**

The T1 catalog is in every prompt, so the agent can answer the following *inline* (no skill round-trip, no DB query):

- **Ownership lookups.** "Who owns `payment-service`?" → answers from the service catalog (`User.systemsOwned`). Returns name + team + role. Includes secondary owners and their reachability when relevant.
- **Contact-routing.** "Who do I talk to about a problem in `customer-data-warehouse`?" → resolves to system owners, their team's on-call contact (when integrations are configured), and the manager hierarchy if escalation is implied.
- **Hierarchy lookups.** "Who is my manager?" / "Who reports to J. Wu?" → `User.managerId` and `reports[]`.
- **Approver lookups.** "Who can approve a change to the `payments` service?" → cross-references service owners + users with `approver` role + active policy bundle scoping.
- **Team listings.** "Who's on the SRE team?" → from the team directory.
- **State summaries.** "What's pending right now?" / "What changed in the last 24h?" → small DB read (audit slice or list endpoint), narrated.
- **Recall of recent activity.** Within a session (T3), the agent remembers what the user already asked about and refers back ("you asked about chg-002 earlier; that one is now `approved_with_condition`").

**Skills called — when the agent needs LLM-driven analysis or routing logic:**
- "Why was this denied?" → `explain_policy_decision`.
- "Walk me through the approval chain for chg-002" → `route_request`.
- "Summarize the impact of approving appr-001" → `summarize_decision_impact`.

**Guardrails.**
- **Read-only.** Cannot trigger any state-changing action through chat. If the user asks "approve change chg-001", the agent explains how to do it (path: Approvals page → approve button) but never invokes the action itself.
- **Role-aware.** Responses respect the requesting user's role. An operator asking "how do I approve this" gets "your role can read but not approve — escalate to an approver via [link]," not approval mechanics.
- **Catalog-grounded.** When asked about a person, service, or team, the agent answers from T1 catalog. If the entity isn't in the catalog, it says so explicitly — never invents a name or service.
- **Page-aware, but not page-bound.** On `/changes/:id` the chat has change-context loaded as T2; elsewhere it has page-level context. The agent can still answer cross-cutting questions ("who owns payment-service") regardless of page.
- **Cross-session memory.** Within a session the agent recalls T3. Across sessions it does not — every new session starts fresh. (v2: optional persistent memory per user.)
- **Confidence about uncertainty.** When a question requires data the agent doesn't have (e.g. "is the on-call alerting working right now?"), the agent says "I can see ServiceNow is connected; on-call status isn't surfaced in v1," rather than guessing.

### ContextualAssistantAgent

**When it runs.** Per user message in the right-rail of detail pages (existing `ContextualAssistant.tsx`).

**Input.** Conversation history (T3) + the focal entity (change/incident/access-request, T2) + role + full T1 stack (including org & service catalog).

**Output.** Streaming text + offered actions (the existing message types: text, explanation, recommendation, draft_artifact, action_proposal).

**Capabilities — entity-grounded answers without round-trips.**

Because T1 carries the org/service catalog and T2 carries the entity with relations, the agent can answer:

- **Who's involved in this entity?** "Who's the owner of this change?" / "Which team will be paged if this incident escalates?" — drawn from `Change.owner`, `Change.ownerTeam`, the service catalog, and the manager hierarchy.
- **Why is this co-approver required?** Reads `Approval.coApprovals[]` + their roles + the approval routing rationale (`whyYouAreRequired`) and explains it in plain language.
- **What's the status of my action?** After the user clicks approve/deny/execute and the mutation runs, the assistant can summarize the resulting chain state ("you approved; 1 of 2 remaining co-approvers — C. Davies") from the refetched entity.
- **Cross-entity references.** "Are there related incidents on this service?" / "What other changes ship to `payment-service` this week?" — resolves via small list-endpoint reads scoped by the focal entity's service.
- **Ownership and contact resolution at the entity level.** "Who do I talk to about getting C. Davies's attention?" — resolves owner → manager → team → on-call (when MCP-connected; v2 for paging).

**Skills called.** All read-side skills + `draft_*` skills:
- Change pages: `assess_change` (re-run on demand), `analyze_blast_radius`, `explain_policy_decision`, `summarize_decision_impact`, `draft_approval_packet`.
- Incident pages: `triage_incident` (re-run / refine), `draft_work_note`, `draft_customer_response`, `propose_bounded_remediation`.
- Access request pages: `evaluate_access_request` (rationale recap), `route_request`, `summarize_decision_impact`.

**Guardrails.**
- Drafts are presented; the user explicitly accepts before persistence.
- `action_proposal` messages contain a *suggested* action for the user to take in UI; the agent never invokes the action.
- Entity scope is sticky. Asking about an unrelated entity returns "open `<entity>` to discuss it there" rather than answering across context.
- Same role-awareness, catalog-grounding, and uncertainty disclosure rules as ChatPanelAgent.

## Non-agent candidates (intentionally not agents)

| Candidate | Why not an agent |
|---|---|
| Policy evaluation | Deterministic; identical input must produce identical output. LLMs forbidden. |
| Audit event creation | Single canonical write path. No "intelligence" needed. |
| RBAC checks | Deterministic. |
| MCP integration plumbing | Lifecycle and protocol code, not domain reasoning. |
| Freeze-window check | Deterministic time-overlap math. |
| Entitlement check | Catalog lookup. |

## Agent invocation lifecycle

```
1. Caller (service or route) invokes agent with entity + context
2. Agent decides which skill(s) to call
3. For each skill:
   a. Skill runner builds prompt from skill.md + entity + context
   b. Prompt hashed (SHA-256), checked against cache (v2) — for v1, no cache
   c. Anthropic SDK called: messages.create or messages.stream
   d. Response validated against skill's Zod output schema
   e. agent_invocations row written: skill, model, hash, tokens, latency, status
   f. If skill produced an audit event, the audit row's id is set on agent_invocations.audit_event_id
4. Agent aggregates skill outputs and returns to caller
```

The skill runner is the only code that touches `agent_invocations`. Skills do not write provenance themselves.

## Trust boundary recap

- **Caller → Agent:** trusted call, untrusted return value. Caller validates.
- **Agent → Skill:** trusted call, untrusted return value. Skill runner validates against Zod schema.
- **Skill → Agent:** validated structured object only. No prose-as-decision.
- **Agent → DB:** none. Agents do not have a Prisma client.
- **Service → DB:** the only write path.

## What's not in v1

- **Multi-step planning agents.** No agent in v1 chooses a sequence of >3 skills. Multi-step orchestration is deferred until skill outputs prove stable.
- **Agent memory beyond a turn.** The conversational agents (ChatPanel, ContextualAssistant) keep history within a session; they do not persist memory across sessions in v1.
- **Cross-agent coordination.** Each agent is independent. There is no agent-to-agent message bus.
- **Agent tool calls (function calling).** v1 uses skill-based prompting, not Anthropic native tool-use. Skill prompts ask for JSON output; the runner parses and validates. Tool-use migration is v2.
