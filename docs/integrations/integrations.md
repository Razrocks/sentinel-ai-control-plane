# Integrations

External systems Sentinel talks to, and what each one is *for*. The
protocol layer (adapter pattern + webhook router + encrypted credential
store) is described below; the older MCP-style design notes live in
[mcp-model.md](mcp-model.md) for context, but the v1 implementation went
with REST adapters + HMAC-verified webhooks, not full MCP.

## v1 integrations (4)

| Name | Class | Purpose |
|---|---|---|
| **GitHub** | Source-of-truth | Pull requests, repository metadata, CI status, merge button. |
| **Slack** | Notification + decision surface | Approver pings + interactive approve/deny from inside Slack. |
| **Linear** | Source-of-truth | Issue ↔ Change bidirectional sync, status mirror, comments. |
| **Sentry** | Inbound event source | Error events → auto-Incident with deduplication. |

Per-integration setup walkthroughs live in their own files:

- [github.md](github.md)
- [slack.md](slack.md)
- [linear.md](linear.md)
- [sentry.md](sentry.md)

## Architecture

Each integration consists of:

1. **Adapter** — TypeScript module under `backend/src/integrations/<name>/`
   implementing the `IntegrationAdapter` interface defined in
   `_base/adapter.ts`. Owns the outbound REST calls.
2. **Webhook handler** — registered under `/api/webhooks/:type`. Verifies
   HMAC signature, normalizes the payload, writes the matching Sentinel
   entity (`Change`, `Incident`, etc.) or audit row.
3. **DB row** — `integrations` table holds the encrypted credentials
   (AES-GCM via `ENCRYPTION_KEY`) and the per-integration config (default
   channel, repo, etc.).
4. **Setup card** — UI surface on the Settings page that walks the admin
   through paste-token + save + test-connection.

## Data ownership boundaries

| Object | Owned externally by | Owned locally by Sentinel |
|---|---|---|
| Pull request | GitHub | Mirrored as `Change.linkedPRs[]` + `ciStatus` |
| Linear issue | Linear | Mirrored as `Change.linkedTicket` |
| Sentry issue | Sentry | Mirrored as `Incident` with dedup key `sentry:<id>` |
| Slack channel | Slack | Sentinel knows channel id for notifications only |
| Change | Sentinel | (read by GitHub/Linear for sync-back) |
| Incident | Sentinel | (read by Sentry for resolution sync) |
| Approval / AuditEvent / PolicyRule | Sentinel | (never leave the DB) |

## Failure modes

| Integration down | What still works | What breaks |
|---|---|---|
| GitHub | Existing Changes stay readable. New PRs don't sync until reconnect. | CI status freezes; merge button blocked. |
| Slack | Web UI approvals still work. | Notification gap; interactive buttons fail. |
| Linear | Changes still flow through Sentinel. | Status updates don't echo back to Linear. |
| Sentry | Existing Incidents stay editable. | New errors don't auto-create Incidents. |

In all cases the failure is **degraded, not broken** — the human can use
the web UI directly. Each integration's Settings card shows last-success
timestamp + a "Test connection" button.

## Sync cadence

| Integration | Inbound | Outbound |
|---|---|---|
| GitHub | Webhook on PR/push/check_run | On-demand merge call |
| Slack | Webhook on user interaction | On Approval state change |
| Linear | Webhook on issue/comment events | On Change state change |
| Sentry | Webhook on issue.created / issue.resolved | (none — Sentinel never writes to Sentry) |

There's no polling fallback in v1. If a webhook is missed, the data drifts
until the next webhook hits — acceptable for a personal project.

## Health surfacing

The Settings page shows integration health for admins:

- **Connected** — credentials valid + at least one webhook event received
  within the cadence window.
- **Degraded** — credentials valid but no recent webhooks.
- **Disconnected** — credentials invalid (token revoked, secret rotated)
  OR never paired.

## What is intentionally NOT integrated in v1

| System | Why deferred |
|---|---|
| ServiceNow | Personal project — no enterprise ticketing context |
| PagerDuty | Slack covers the paging hop |
| Datadog / Honeycomb | Phase 6 (deferred forever for personal use) |
| Okta / Entra | Local JWT auth fine for demo |
| Terraform / Atlantis | Adjacent space, out of v1 scope |
| Kubernetes / cloud APIs | Sentinel governs decisions, not raw infra calls |

## Adding a new integration

1. Pick a name + dir: `backend/src/integrations/<name>/`.
2. Implement the `IntegrationAdapter` interface from `_base/adapter.ts`.
3. Add the webhook handler under `routes/webhooks.ts` (HMAC-verified).
4. Add the credential schema + UI setup card in `Settings.tsx`.
5. Document it under `docs/integrations/<name>.md` using the template the
   other 4 follow (what / setup / env / troubleshooting / audit actions).
