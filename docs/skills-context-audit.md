# Skill context audit (Phase 1.2)

Audit of which context tiers each skill receives in its system prompt.
Tiers come from `services/agents/context.ts` (loader) and `services/skills/prompt.ts`
(renderer). Defaults in `makeBuildPrompt`: all tiers included except T3.

## Tier reference

| Tier | Purpose | Loaded by |
|---|---|---|
| T1.a | Sentinel identity / role-of-the-AI | static |
| T1.b | Active policy bundle (rules + freeze windows) | `loadPolicyBundle` |
| T1.c | Calling user's role constraints (what they can do) | static table |
| T1.d | Org catalog (users, services, ownership, managers) | `loadOrgCatalog` |
| T1.e | Skill registry (peer skills callable in pipeline) | static |
| T2 | Service-specific extras (recent deploys, related incidents) | `loadIncidentT2Extras` |
| T3 | Conversation memory (not yet wired across skills) | — |
| T4 | Audit slice on this entity (recent actions) | `loadAuditSlice` |
| T5 | Temporal context (now, weekend, freeze windows live) | static |

## Per-skill inclusion map

| Skill | T1.b policy | T1.c role | T1.d catalog | T2 | T4 | T5 |
|---|---|---|---|---|---|---|
| `assess_change` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `analyze_blast_radius` | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| `triage_incident` | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ |
| `evaluate_access_request` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `support_approval_decision` | ✓ | ✓ ✱ | ✓ | ✓ | ✓ | ✓ |
| `route_request` | ✓ | ✗ | ✓ | ✓ | ✗ | ✓ |
| `propose_bounded_remediation` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `draft_approval_packet` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `draft_work_note` | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `draft_customer_response` | ✗ | ✓ | ✗ | ✓ | ✗ | ✓ |
| `explain_policy_decision` | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| `summarize_decision_impact` | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ |

✱ Updated this audit — see "fixes" below.

## Rationale per exclusion

- **`analyze_blast_radius` skips T5** — structural impact analysis. Temporal
  state ("currently in freeze") doesn't change WHICH systems are blast
  radius, only whether the change can ship. T5 belongs on the executing
  skill, not the analyzer.
- **`triage_incident` skips T1.c role** — agent triages on behalf of the
  system, not a specific approver. Role constraints would bias the
  recommended fix toward what the human happens to be allowed to do.
- **`route_request` skips T1.c role + T4 audit** — routing constructs the
  chain. The caller's role isn't relevant; what matters is the org catalog
  + policy. T4 (recent actions on this approval) was excluded to avoid
  echo-routing same approvers, but borderline — revisit if routing loops
  appear.
- **`draft_work_note` skips T1.b policy** — drafting prose, not policy
  decisions. Policy rules would just bloat the prompt without changing the
  note content.
- **`draft_customer_response` skips T1.b + T1.d + T4** — customer comms
  must NOT leak internal service names (T1.d) or audit trail (T4). Policy
  isn't customer-facing either.
- **`explain_policy_decision` skips T4 + T5** — explains a rule's intent.
  Audit history of rule violations would help but rule-level audit isn't
  loaded today; revisit if/when we add it.
- **`summarize_decision_impact` skips everything except T2** — pure prose
  task with input already containing all needed facts. Adding tiers would
  waste cache budget.

## Fixes applied this audit

- **`support_approval_decision` now INCLUDES T1.c role.** It generates the
  "If approved / If denied / If escalated" prose shown to the approver on
  the decision-impact panel. The approver's role constraints determine
  which of those branches are actually available to them, so the model
  needs T1.c to phrase impacts accurately ("you'd escalate to the SRE
  lead" vs "this would route past you to the next approver").

## No-action findings (reasonable defaults, documented for posterity)

- `route_request` skipping T4 — borderline. Acceptable today; if routing
  starts looping (assigning same approver repeatedly) revisit.
- `explain_policy_decision` skipping T5 — explanations are evergreen, not
  temporal. OK.
- All drafting skills skipping T1.b — keeps prose generation honest, OK.
