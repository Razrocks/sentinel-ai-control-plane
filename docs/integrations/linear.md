# Linear integration

Bi-directional sync between Linear issues and Sentinel Changes / Incidents.
Lets engineering use Linear as the planning surface while Sentinel handles
policy + execution.

## What it does

- **Issue → Change.** Linear issue labeled `change` becomes a Sentinel
  Change; issue ID stored on `change.linkedTicket`.
- **Status sync.** Sentinel status changes (approved, deployed) update
  the linked Linear issue's state.
- **Comment back.** Major policy decisions (escalated, denied) comment on
  the Linear issue so the engineer sees feedback in context.

## Setup

### 1. Create a Linear API key

linear.app → Settings → API → Create personal API key.

Scopes are global per workspace — no granular permission picker. The key
acts as the user who created it, so don't use a personal key for shared
production unless the user account is shared.

For team use, prefer an OAuth app (linear.app/docs/oauth-2-0-authentication).

### 2. Configure webhook

Settings → API → Webhooks → Create:

- URL: `https://<tunnel>/api/webhooks/linear`
- Events: `Issue create`, `Issue update`, `Issue label change`,
  `Comment create`
- Resource types: Issue, Comment

Copy the signing secret.

### 3. Wire in Sentinel

Settings → Integrations → Linear → Connect:

- Paste API key
- Paste webhook signing secret
- Pick the team you want sync'd (Linear scopes are workspace-wide; we
  scope by team to avoid grabbing every issue in the workspace)

## Env vars

None required.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Webhook ping returns 200 but no Change created | Issue lacks `change` label | Add the label OR change `slackable` in adapter config |
| Comments back to Linear don't post | API key user lacks comment permission on that team | Reissue key as a workspace member with the right team membership |
| Linear status updates fire repeatedly | Status name mismatch — Sentinel sends "Approved" but Linear team uses "Done" | Map Sentinel→Linear status in `integrations.linear.statusMap` |

## Audit actions emitted

- `linear_issue_linked` — issue first synced to a Change
- `linear_status_pushed` — status change reflected back to Linear
- `linear_comment_posted` — Sentinel commented on the issue
