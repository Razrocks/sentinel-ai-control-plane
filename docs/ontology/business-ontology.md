# Business Ontology

## Thesis

Operations work in regulated environments — change management, incident response, privileged access — is bottlenecked not by the cost of doing the work, but by the cost of *proving* the work was safe. Reviewers spend their time gathering blast-radius context, comparing the requested action against policy, reconstructing approval chains, and writing audit narratives. The actual decision is often a few seconds; the surrounding evidence-collection takes hours.

Sentinel's wager is that an LLM-backed assistant can compress that evidence-collection into seconds while a deterministic policy engine retains authority over whether the action is allowed. The human reviewer reads a structured packet — risk, blast radius, policy verdict, recommended approvals, draft work notes — and decides. The system records exactly what was shown, what was decided, who decided, and why.

This is not an autonomy product. It is a **governed-assistant** product. The agent never decides; the agent *prepares*.

## Who uses Sentinel

| Role | Job in the system | Pain Sentinel removes |
|---|---|---|
| **Operator** | Watches the queue: changes pending, incidents open, access requests waiting. Triages, escalates, monitors. Does not approve high-risk items. | Switching context across ServiceNow, GitHub, Grafana, OPA dashboards to figure out *what is going on*. |
| **Engineer** | Owns specific services. Files changes, responds when their service is implicated in an incident, requests access when needed. | Drafting work notes, reconstructing change rationale, hunting blast radius. |
| **IT Support** | Front line for incidents — receives alerts, runs initial triage, escalates to engineers. | Searching KB articles, identifying recurring patterns, writing customer-facing updates. |
| **Approver** | Signs off on infrastructure/change risk. Holds the line on production safety. | Reading 40-page change tickets to find the actual blast radius and policy intersection. |
| **Access Approver** | Signs off on privileged access. Manager + system-owner side. | Verifying entitlement, justification quality, and time-bound scope. |
| **Admin** | Configures policy bundles, freeze windows, integration credentials, role assignments. | Reasoning about policy precedence and freeze-window overlap manually. |

Roles are **functional** not **hierarchical**. An admin is not "more senior" than an engineer — they have different responsibilities. The role of the user determines which surfaces, actions, agents, and skills are available.

## Domain entities (business view)

Engineering specifics are in [abstractions.md](abstractions.md). At the business level:

- **Change** — A proposed modification to a production-like system. Has an owner, a service, an environment, a risk class, an approval chain, and (when approved) a maintenance window.
- **Incident** — A reported degradation or outage. Has a severity, an affected service, a triage state, and (often) related changes.
- **Access Request** — A user asking for a role on a system. Has a justification, a risk class, an entitlement check, and a manager-and-owner approval chain.
- **Approval** — A decision artifact attached to one of the three above. Has a type, a status, optional co-approvers, and an optional condition.
- **Audit Event** — An immutable record of *something that happened* — an action, a policy decision, a state transition, an agent invocation.
- **Policy Rule** — A named, scoped, decision-producing rule. Evaluated by the policy engine; never evaluated by an LLM.
- **Freeze Window** — A bounded time interval during which writes to a scope (service, environment, or global) are blocked regardless of approval state.
- **Recommendation** — Sentinel's suggestion attached to a change. Classified as required-now, recommended, optional-optimization, or out-of-scope. Drafts only — humans accept.
- **Blast Radius Item** — A downstream system, service, or job affected by a change. Built by a deterministic discovery service plus an LLM-backed classifier.

## Decision boundary

| Class | Who decides | Examples |
|---|---|---|
| **Deterministic** | Policy engine | "Production write blocked because change is in `approvalState: pending`." "Freeze window `frz-001` (Q1 close) overlaps requested execution time." |
| **Advisory** | Agent + skill | "Risk likely *high* because the change touches the payments DB schema and the maintenance window starts in 18 hours." "Suggested approvers: SRE-Owner (J. Wu), Database-Owner (C. Davies), Risk-Compliance (M. Patel)." |
| **Human** | User | Approve / deny / approve-with-condition / escalate / execute. |

Sentinel never advances state on the basis of an agent's confidence alone. Every state transition is either a deterministic policy verdict (e.g. "policy denied") or a human action.

## Out of scope

- Customer-facing chat, public APIs, multi-tenant SaaS.
- Continuous monitoring / observability dashboards (Sentinel *consumes* monitoring metadata via MCP; it does not host metrics).
- Ticket lifecycle ownership (ServiceNow remains source of truth for the ticket; Sentinel is the *governance layer*).
- Self-modifying agents, tool discovery, or any form of unattended write without an explicit policy bundle authorizing it.

## Why agents at all

Three reasons, in priority order:

1. **Compression of evidence.** Reading the change, the linked PRs, the related CI status, the blast-radius graph, and the relevant policy rules — and producing a one-page summary — is a job an LLM does well and humans do slowly.
2. **Drafting of structured artifacts.** Work notes, customer responses, approval packets, escalation messages — the format is repetitive, the content is specific. Drafts get accepted, edited, or rejected by a human.
3. **Routing.** Given an entity, identifying the correct approver, the correct co-approval chain, and the correct policy bundle is mechanical *but* requires reading prose. Skills handle the prose; services handle the chain.

Agents are *not* used for: deciding policy, writing to the database without a service mediating, generating audit events directly, evaluating identity or RBAC.
