/**
 * Minimal Slack Web API client.
 *
 * Auth: Bot User OAuth Token (`xoxb-...`). We avoid `@slack/web-api` for
 * the same reason we skipped `@octokit/rest`: small surface area, explicit
 * retry/timeout posture, no plugin layer.
 *
 * Token rules (HARD):
 *   - The bot token is read from Integration.credentialsCiphertext at use
 *     time and never logged.
 *   - All errors throw `SlackApiError` with the structured `error` field
 *     Slack returned so the wizard can render the cause.
 */

const API_BASE = 'https://slack.com/api'
const DEFAULT_TIMEOUT_MS = 15_000
const USER_AGENT = 'Sentinel-Integration/1.0'

export class SlackApiError extends Error {
  constructor(
    public slackError: string,
    public response?: unknown,
  ) {
    super(`Slack API error: ${slackError}`)
    this.name = 'SlackApiError'
  }
}

export interface SlackAuthTest {
  ok: boolean
  url: string
  team: string
  team_id: string
  user: string
  user_id: string
  bot_id?: string
}

export interface SlackChannel {
  id: string
  name: string
  is_private: boolean
  is_archived: boolean
  is_member: boolean
}

export interface SlackChatPostMessageResponse {
  ok: boolean
  channel: string
  ts: string
  message?: { text: string; ts: string }
}

/**
 * Slack returns 200 with `{ ok: false, error: "..." }` on logical failures
 * rather than HTTP error codes. Treat both paths the same.
 */
async function slackFetch<T extends { ok: boolean; error?: string }>(
  path: string,
  token: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...rest,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': USER_AGENT,
        ...(rest.body ? { 'Content-Type': 'application/json; charset=utf-8' } : {}),
        ...rest.headers,
      },
    })

    if (!res.ok) {
      throw new SlackApiError(`http_${res.status}`)
    }

    const data = (await res.json()) as T
    if (!data.ok) {
      throw new SlackApiError(data.error ?? 'unknown_error', data)
    }
    return data
  } finally {
    clearTimeout(timer)
  }
}

// ─── Public API ─────────────────────────────────────────

/** Verify the bot token + return identity. */
export async function authTest(token: string): Promise<SlackAuthTest> {
  return slackFetch<SlackAuthTest>('/auth.test', token, { method: 'POST' })
}

/**
 * List channels the bot can see (public + private channels it's a member
 * of). Capped at 200 — workspace-wide pagination would balloon the wizard.
 *
 * Slack types_filter is comma-separated. We include private_channel so
 * workspaces using only private channels still see results.
 */
export async function listChannels(
  token: string,
): Promise<{ ok: true; channels: SlackChannel[] }> {
  const url = '/conversations.list?limit=200&exclude_archived=true&types=public_channel,private_channel'
  return slackFetch<{ ok: true; channels: SlackChannel[] }>(url, token)
}

/**
 * Post a message to a channel. `blocks` is Slack's Block Kit array — used
 * for interactive approve/deny buttons. Plain `text` is required as a
 * fallback for clients that can't render blocks (email notifications, old
 * mobile, screen readers).
 */
export async function chatPostMessage(
  token: string,
  channelId: string,
  text: string,
  blocks?: unknown[],
): Promise<SlackChatPostMessageResponse> {
  const body: Record<string, unknown> = { channel: channelId, text }
  if (blocks) body.blocks = blocks
  return slackFetch<SlackChatPostMessageResponse>('/chat.postMessage', token, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

/**
 * Update a previously-sent message (e.g. after a user clicks Approve we
 * rewrite the message to "✓ Approved by @user" and remove the buttons).
 */
export async function chatUpdate(
  token: string,
  channelId: string,
  ts: string,
  text: string,
  blocks?: unknown[],
): Promise<SlackChatPostMessageResponse> {
  const body: Record<string, unknown> = { channel: channelId, ts, text }
  if (blocks) body.blocks = blocks
  return slackFetch<SlackChatPostMessageResponse>('/chat.update', token, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}
