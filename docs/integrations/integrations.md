# Integrations

External systems Sentinel talks to, and what each one is *for*. The protocol layer (MCP) is in [mcp-model.md](mcp-model.md); this file is about the *purpose* of each integration.

## v1 integrations (3)

| Name | Class | Purpose |
|---|---|---|
| **ServiceNow** | Source-of-truth | Ticket lifecycle for changes, incidents, access requests. Knowledge Base articles. |
| **GitHub** | Source-of-truth | Pull requests, repository metadata, CI status. |
| **OPA (Open Policy Agent)** | Policy engine bundle | Policy bundle source. Periodically synced; rules cached in DB. |

All three are connected via MCP. Sentinel is the **client**; the external systems run their own MCP servers (or Sentinel runs adapters that proxy to their REST APIs — see mcp-model.md).

## ServiceNow

**What it is.** Enterprise ticketing system. The single canonical place where changes, incidents, and access requests are *recorded* for the organization.

**Why integrated.**
- New changes filed in ServiceNow appear in Sentinel (intake).
- Sentinel's audit-relevant decisions (approved, denied, executed) flow back as ServiceNow ticket updates.
- KB articles linked to incidents are fetched for triage context.

**Data flow.**
- **Inbound:** ticket creation, ticket field updates (state, severity), KB article content.
- **Outbound:** Sentinel-side decisions written back as ticket comments and state transitions.
- **Bi-directional fields:** `ticketId`, `incidentId`, `requestId` — Sentinel uses these as external IDs.

**Source-of-truth boundary.**
- ServiceNow owns: the ticket existing, the assignment group, the customer-facing description.
- Sentinel owns: the policy verdict, the approval chain state, the audit trail of *its own* decisions, the blast radius analysis, the recommendations.

**Failure mode.** If ServiceNow MCP is down, Sentinel continues to operate on its local state. New tickets do not appear; outbound updates queue and replay on reconnect. UI shows a "ServiceNow degraded" badge.

## GitHub

**What it is.** Source code hosting + CI provider. Linked PRs and repo metadata live here.

**Why integrated.**
- Changes reference PRs (`Change.linkedPRs[]`); Sentinel fetches their state for risk/blast assessment.
- CI status (`Change.ciStatus`) is read live from GitHub.
- Repo metadata (default branch, owners, recent commits) feeds blast-radius discovery.

**Data flow.**
- **Inbound:** PR state, CI runs, branch protection rules, file-changed lists.
- **Outbound:** none in v1. Sentinel does not comment on PRs or set statuses.

**Source-of-truth boundary.**
- GitHub owns: PRs, code, CI results.
- Sentinel owns: how PR state maps to a Change's risk profile.

**Failure mode.** If GitHub MCP is down, `ciStatus` shows "unknown" and blast-radius analysis runs without PR context (degraded but not broken). UI shows a "GitHub degraded" badge.

## OPA

**What it is.** Open Policy Agent — declarative policy engine. The team's policy bundles live here as Rego code; Sentinel sync them periodically and caches the rule definitions in `policy_rules`.

**Why integrated.**
- Centralized policy authoring — admins edit Rego in OPA, Sentinel pulls.
- Policy evaluation in v1 is *local* (Sentinel re-implements the rules in `policy-engine.ts` for the cached bundle). v2: delegate evaluation to OPA via MCP for hot-path queries.

**Data flow.**
- **Inbound:** policy bundle metadata (rule names, scopes, decisions, descriptions). The Rego code itself is informational; Sentinel doesn't execute it.
- **Outbound:** none.

**Source-of-truth boundary.**
- OPA owns: policy code, bundle versions, rule semantics.
- Sentinel owns: which bundles are active, when they were synced, what local cache holds.

**Failure mode.** If OPA MCP is down, the cached bundle continues to be used. UI shows "OPA bundle: stale (last sync XXh ago)" warning. Admin is alerted; new policy edits do not propagate until reconnect.

## What gets imported, what gets created locally

| Object | Imported from | Created locally |
|---|---|---|
| Change | ServiceNow ticket → `changes` row | (none — no Sentinel-only changes in v1) |
| Incident | ServiceNow incident → `incidents` row | (none) |
| Access Request | ServiceNow request → `access_requests` row | (none) |
| Linked PR | GitHub PR | Stored as URL in `Change.linkedPRs[]` |
| KB Article | ServiceNow KB | Cached in `kbArticles[]` per incident |
| Policy Rule | OPA bundle | `policy_rules` row |
| User | (none — local only in v1) | Local seed |
| Approval | (local) | `approvals` row |
| Audit Event | (local) | `audit_events` row |
| Agent Invocation | (local) | `agent_invocations` row |
| Freeze Window | (local — admin) | `freeze_windows` row |

User accounts in v1 are local; v2 will integrate with the enterprise IdP (Okta/Entra) over OIDC.

## Sync cadence

| Integration | Cadence | Mechanism |
|---|---|---|
| ServiceNow ticket sync | Webhook on create/update; poll every 60s as fallback | Push from ServiceNow → Sentinel webhook endpoint OR Sentinel pulls |
| GitHub PR/CI status | On-demand at change-detail load | Per-request fetch; cached for 30s |
| OPA bundle | Every 5 minutes | Sentinel pulls latest bundle metadata |
| KB articles | On-demand at incident-detail load | Per-request fetch; cached 1h |

## Health surfacing

The Settings page shows integration health for admins:

- **Connected** — last successful exchange ≤ expected cadence × 2.
- **Degraded** — last successful exchange ≤ expected cadence × 6.
- **Disconnected** — beyond degraded threshold or explicit error.

Admins can trigger a manual test (`POST /api/settings/integrations/:name/test`) which performs a minimal request and reports.

## Why these 3 integrations

The minimum needed to make Sentinel a credible *governance layer over real ops*:

- ServiceNow: the work itself.
- GitHub: the artifacts of the work.
- OPA: the rules the work must follow.

Adding more integrations (Slack, PagerDuty, Datadog, Okta) expands the role surface and the audit reach but doesn't change the core value proposition. Those land in v2.

## What is intentionally not integrated in v1

- **Slack / Teams** — notifications. v1 has no outbound chat. v2 likely.
- **PagerDuty / OpsGenie** — paging. v2.
- **Datadog / Grafana / Splunk** — metrics + logs. Could feed into incident triage; deferred for v1 because the value-per-engineering-cost is high but the v1 scope is enough without.
- **Okta / Entra ID** — IdP. v1 uses local users. v2 OIDC.
- **Terraform / Atlantis** — IaC. Adjacent space; v2.
- **Kubernetes / cloud APIs** — direct deploy. Not Sentinel's job; deploys go through whatever MCP wraps the team's CD tooling. v2.

## Adding an integration

The contract for adding a new integration:

1. Decide what data flows in/out and what entities it produces or annotates.
2. Add an adapter in `backend/src/mcp/<name>.ts` that conforms to the `McpAdapter` interface (see mcp-model.md).
3. Register the adapter in the `client.ts` registry.
4. If it produces entities, write a sync routine in `services/<entity>-sync.ts`.
5. If it annotates existing entities, hook into the relevant intake (e.g. blast-radius discovery).
6. Add a row to the Settings page integration list (with health check).
7. Document in this file.

A new integration is not a new subsystem — it lives inside S12 (MCP Layer).
