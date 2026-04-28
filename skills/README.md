# Sentinel Skills

A **skill** is the atomic unit of LLM work in Sentinel: one named, typed, single-purpose function backed by one Claude call. Skills are invoked by agents and services. Every skill call writes a provenance row to `agent_invocations`. Skills do not write any other DB rows; they return validated structured output.

## Naming

Skill names are `verb_noun` snake_case. The verb must come from the **closed verb set**:

| Verb | Use for |
|---|---|
| `assess` | Risk classification, qualitative judgment with a known scale (low/medium/high/critical). |
| `analyze` | Decomposition / enumeration of components or relationships (blast radius, dependencies). |
| `triage` | Multi-output classification + immediate-next-step suggestion (incident triage). |
| `evaluate` | Multi-criterion scoring producing a structured verdict (access request evaluation). |
| `support` | Generates auxiliary structured content for a human decision (decision impact strings). |
| `draft` | Generates user-facing prose in a known format (work note, customer response, approval packet). |
| `propose` | Generates a structured *artifact* the human can accept / reject (a remediation change spec). |
| `explain` | Renders a human-readable explanation of a deterministic fact (policy decision, freeze block). |
| `summarize` | Compresses an existing structured object to prose (decision impact summary). |
| `route` | Identifies the participants/owners for an entity (approval chain, escalation target). |

Adding a verb requires an explicit edit to this file.

## The 12 v1 skills

| # | Skill | Kind | Used by | Output |
|---|---|---|---|---|
| 1 | `assess_change` | agentic | ChangeTriageAgent | risk, summary, rationale |
| 2 | `analyze_blast_radius` | agentic | ChangeTriageAgent | blast radius items |
| 3 | `triage_incident` | agentic | IncidentTriageAgent | severity, root cause, KB matches |
| 4 | `evaluate_access_request` | agentic | AccessReviewerAgent | risk, justification quality |
| 5 | `support_approval_decision` | agentic | ApprovalRouterAgent | decision impact strings |
| 6 | `draft_work_note` | agentic | ContextualAssistantAgent (incidents) | work-note prose |
| 7 | `draft_customer_response` | agentic | ContextualAssistantAgent (incidents) | customer-facing prose |
| 8 | `draft_approval_packet` | agentic | ContextualAssistantAgent (changes) | approval-packet sections |
| 9 | `propose_bounded_remediation` | agentic | RemediationDrafterAgent | structured change spec |
| 10 | `explain_policy_decision` | agentic | ChatPanelAgent / ContextualAssistantAgent | rule rationale |
| 11 | `summarize_decision_impact` | agentic | ChatPanelAgent / ContextualAssistantAgent | one-line approve/deny/escalate prose |
| 12 | `route_request` | agentic | ApprovalRouterAgent / AccessReviewerAgent | chain participants + why-required |

## Folder layout

```
skills/
├── README.md                         # this file
├── assess_change/
│   ├── skill.md                      # spec
│   └── memory.md                     # (optional) skill-specific memory notes
├── analyze_blast_radius/
│   └── skill.md
├── triage_incident/
│   └── skill.md
├── evaluate_access_request/
│   └── skill.md
├── support_approval_decision/
│   └── skill.md
├── draft_work_note/
│   └── skill.md
├── draft_customer_response/
│   └── skill.md
├── draft_approval_packet/
│   └── skill.md
├── propose_bounded_remediation/
│   └── skill.md
├── explain_policy_decision/
│   └── skill.md
├── summarize_decision_impact/
│   └── skill.md
└── route_request/
    └── skill.md
```

## skill.md — canonical structure

Every `skill.md` follows this structure:

```markdown
# <skill_name>

## Purpose
<one paragraph: what this skill does and what it doesn't do>

## Kind
<agentic | deterministic | integration>

## Used by
<list of agents and services that call this skill>

## Inputs
<typed schema — fields, types, required vs optional, with one-line descriptions>

## Outputs
<typed schema — fields, types, required vs optional, with one-line descriptions>
<note: validation is strict; mismatched output → status='validation_failed'>

## Context tiers consumed
<which of T1–T6 this skill prompt includes>

## Prompt template
<a sketch of the system prompt structure — what sections, in what order>

## Model
<default model id>

## Temperature
<typical: 0.0–0.2 for assess/triage/evaluate/route, 0.3–0.5 for draft/propose>

## Token budget
<input ≤ X, output ≤ Y>

## Failure modes
<what can go wrong, what the runner does in each case>

## Audit
<what audit_events action string this skill's call produces, when applicable>

## Examples
<one or two minimal example input/output pairs>
```

## memory.md — optional per-skill memory

A `memory.md` in a skill folder captures *what should be in the skill's prompt that is not in the input* — non-obvious phrasing, edge-case handling rules, examples of bad outputs to avoid, deltas from a sibling skill. Optional; only present if the skill needs it.

## Naming examples

✓ Good:
- `assess_change`
- `triage_incident`
- `route_request`
- `draft_work_note`
- `explain_policy_decision`

✗ Bad:
- `change_assessment` — noun first, no verb.
- `do_change` — generic verb.
- `handle_incident` — `handle` is not in the closed set.
- `getRecommendation` — camelCase, also `get` not in set.
- `incident-triager` — kebab-case, agent name not skill name.
- `triage` — no noun.

## Adding a new skill

1. Choose a verb from the closed set; if none fit, propose a verb addition in PR.
2. Pick a noun describing the *thing acted on*.
3. Create `skills/<verb_noun>/skill.md` with the full structure above.
4. Add a row to the table in this README.
5. Implement the registry entry in `backend/src/services/skills/registry.ts`:
   - Zod input schema
   - Zod output schema
   - Prompt template path → `skills/<verb_noun>/skill.md`
   - Default model
6. Write at least one fixture test that pins a sample output structure.

## Skill vs agent vs workflow

These three concepts are easy to confuse. Quick reference:

- A **skill** is one Claude call with typed I/O. Examples: `assess_change`, `draft_work_note`.
- An **agent** is a named entity the user (or a service) talks to. It chooses which skills to run. Examples: `ChangeTriageAgent`, `ContextualAssistantAgent`.
- A **workflow** is an end-to-end multi-step business sequence. Examples: WF-CHG (change lifecycle), WF-ACC (access request).

A workflow may invoke many skills via many agents. A skill never invokes another skill. An agent never invokes another agent.

## Provenance contract

Every agentic skill call writes one row to `agent_invocations`:
- `skill` — the verb_noun name from this README.
- `kind='agentic'`.
- `model` — exact model id.
- `prompt_hash` — SHA-256 of the rendered prompt (post-cache substitution).
- `tokens_in/out` — from the SDK response.
- `cached` — false in v1.
- `latency_ms` — measured in the runner.
- `confidence` — present if the skill self-reports; nullable.
- `status` — `success | validation_failed | error`.
- `error_message` — present on non-success.
- `actor` — user.name or `'system'`.
- `audit_event_id` — set if this call produced an audit event.

## What's not a skill

- **Policy evaluation** — deterministic, lives in `services/policy-engine.ts`.
- **Audit writing** — single canonical service, never an LLM.
- **DB queries** — services do this and pass results to skills.
- **MCP calls** — services do this and pass results to skills.
- **Multi-step orchestration** — that's an agent's job, not a skill's.

## v1 skill specs

The 12 individual `skill.md` files will be added under their respective folders. They share the structure above. The first reference implementation (`assess_change/skill.md`) is the canonical example to follow when writing the others.
