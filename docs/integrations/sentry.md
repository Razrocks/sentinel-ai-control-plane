# Sentry integration

Inbound webhook from Sentry → Sentinel Incident creation. Lets your error
monitoring drive incident triage automatically.

## What it does

- **Issue event → Incident.** New unresolved Sentry issue above a
  threshold (configurable, default `error` level + frequency > N/hour)
  creates a Sentinel Incident with the stack trace + event metadata.
- **Deduplication.** Same Sentry issue ID → existing Incident gets a new
  audit event, not a new row.
- **Severity mapping.** Sentry `error` → Sev3, `fatal` → Sev1; configurable.

## Setup

### 1. Create Sentry internal integration

Sentry → Settings → Organization → Developer Settings → New Internal
Integration.

- Name: `Sentinel webhook`
- Webhook URL: `https://<tunnel>/api/webhooks/sentry`
- Permissions: `Read` on Issue & Event
- Webhooks: enable, subscribe to `issue.created` and `issue.resolved`

Save → copy the **Client Secret** (used to verify HMAC signatures).

### 2. Wire in Sentinel

Settings → Integrations → Sentry → Connect:

- Paste client secret
- Pick severity threshold (default `error`)
- Pick frequency threshold (default `>10/hr`)

## Env vars

None required.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Webhooks land but Incidents don't appear | Severity below threshold | Lower threshold OR check the event is `error`/`fatal`, not `warning` |
| Multiple Incidents for the same Sentry issue | Dedup key mismatch | Each Sentinel Incident's `linkedExternalId` is `sentry:<issue.id>`. If you see dupes, check the issue id field is being parsed |
| HMAC verification fails | Client secret rotated in Sentry but not re-pasted | Re-paste the new secret in the integration form |
| Stack traces missing | Webhook payload truncated by tunnel | cloudflared has body size limits; if Sentry payloads are >1MB, use a real domain instead of tunnel |

## Audit actions emitted

- `sentry_incident_created` — new Incident from Sentry event
- `sentry_incident_updated` — existing Incident received new event
- `sentry_incident_resolved` — Sentry resolved → Sentinel auto-resolves
