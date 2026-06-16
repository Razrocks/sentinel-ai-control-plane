# Slack integration

Approver notifications + interactive approve/deny from inside Slack. Lets
on-call humans decide approvals without leaving their main work surface.

## What it does

- **Notify on approval queue.** New high-risk Change or Access Request →
  message to a designated channel with risk badge + summary.
- **Interactive buttons.** `Approve` / `Deny` / `Open in Sentinel` —
  decisions made via Slack write back to the same Approval row with full
  audit (actor = Slack user resolved to Sentinel user).
- **Incident routing.** Sev1/Sev2 incidents post to the on-call channel
  automatically.

## Setup

### 1. Create Slack app

api.slack.com/apps → Create New App → From scratch.

- Name: `Sentinel` (or whatever)
- Workspace: pick one

### 2. Configure OAuth scopes

OAuth & Permissions → Bot Token Scopes:

- `chat:write` — post messages
- `commands` — slash command (optional, for `/sentinel approve INC-123`)
- `users:read` — resolve Slack user → Sentinel user
- `users:read.email` — match by email

Click "Install to Workspace" → copy the **Bot User OAuth Token** (starts
`xoxb-`).

### 3. Configure event subscriptions

Event Subscriptions:

- Request URL: `https://<tunnel>/api/webhooks/slack/events`
- Bot Events: subscribe to `message.channels` (for chat replies) and
  `app_mention`

### 4. Configure interactive components

Interactivity & Shortcuts:

- Request URL: `https://<tunnel>/api/webhooks/slack/interactive`

### 5. Wire in Sentinel

Settings → Integrations → Slack → Connect:

- Paste bot token
- Paste signing secret (Basic Information page)
- Pick default channel for approval notifications

## Env vars

None required — credentials encrypted in DB.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Buttons grayed out + "Sentinel is offline" | Interactive Request URL wrong/unreachable | Re-check URL; cloudflared tunnel may have rotated |
| Decisions made in Slack don't appear in audit | Slack user can't be resolved to a Sentinel user | Make sure Slack email matches a user.email in Sentinel users table |
| Notifications stop after a day | Slack token revoked / re-installed | Re-paste bot token in integration form |
| Slash command 404 | App installation didn't include `commands` scope | Re-install with full scope set |

## Audit actions emitted

- `slack_approval_sent` — notification posted to channel
- `decision_via_slack` — actor used a Slack button instead of the web UI
