# GitHub integration

Source-of-truth for pull requests, branches, CI status. Webhook-driven
intake: when a PR opens or pushes happen, a `Change` row is created/updated
and routed through the policy engine.

## What it does

- **PR → Change sync.** New PR → new Sentinel Change. PR state (open /
  merged / closed) tracks Sentinel Change status.
- **CI status mirror.** GitHub check runs surface as `change.ciStatus`
  (passing / failing / pending) so approvers see CI before deciding.
- **Push events.** Direct pushes to protected branches surface as Change
  events for audit.
- **Merge button.** Sentinel can merge a PR once approval gates pass
  (admin role only).

## Setup

### 1. Create a GitHub App OR PAT

For a single-org personal project, a Personal Access Token is simplest:

1. github.com/settings/tokens → "Generate new token (classic)"
2. Scopes: `repo` (full), `read:org`
3. Copy the token — you'll paste it into the integration form, never into
   chat or commits.

For multi-repo / team use later, swap to a GitHub App for finer scopes +
rotating credentials.

### 2. Add webhook

In each repo → Settings → Webhooks → Add webhook:

- **Payload URL:** `https://<your-tunnel-or-domain>/api/webhooks/github`
  - In dev: `cloudflared tunnel --url http://localhost:3001` gives you a
    public URL.
- **Content type:** `application/json`
- **Secret:** generate one (`openssl rand -hex 32`), save for next step
- **Events:** Pull requests, Pushes, Check runs

### 3. Wire in Sentinel

Settings → Integrations → GitHub → Connect:

- Paste PAT
- Paste webhook secret
- Pick default repo (optional — controls which repo the merge button
  targets when context is ambiguous)

Verify on the integration card: status pill should flip to green within
~10s of receiving the first webhook ping.

## Env vars

None required — credentials live encrypted in the `integrations` table.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Webhook events drop with 401 | Signature mismatch | Re-copy the secret from GitHub into Sentinel; both must match exactly |
| Changes don't update on PR close | Webhook missing `pull_request` event | Edit webhook on GitHub, ensure event is selected |
| CI status stuck on "pending" | `check_run` event not subscribed | Add it to the webhook event list |
| Merge button blocked | Approval gate didn't pass | Check Approvals page — Sentinel only merges past approved gates |

## Audit actions emitted

- `pr_synced` — PR state change reflected in Change
- `ci_status_updated` — check run completed
- `change_merged` — Sentinel performed the merge
