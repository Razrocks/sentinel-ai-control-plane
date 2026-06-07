/**
 * Slack outbound notifications.
 *
 * Side-effect helpers that the approval / change pipeline calls when a
 * state change happens worth telling humans about. All functions:
 *
 *   - No-op silently when the slack integration isn't configured or is
 *     disconnected — Sentinel works fine without Slack.
 *   - Catch transport errors. A Slack outage MUST NOT block an approval
 *     decision from committing.
 *   - Never log the bot token.
 *
 * Channel selection: every channel id under `config.scopes` receives the
 * notification. Future iteration can route by entity type / severity.
 */

import { prisma } from '../../lib/prisma.js'
import { decrypt } from '../_base/encryption.js'
import { chatPostMessage, SlackApiError } from './client.js'

/**
 * Look up the active slack integration's bot token + target channels.
 * Returns null when slack isn't configured so callers can short-circuit.
 */
async function loadSlackContext(): Promise<{ token: string; channelIds: string[] } | null> {
  const integration = await prisma.integration.findUnique({
    where: { type: 'slack' },
  })
  if (!integration || integration.status !== 'connected') return null
  if (!integration.credentialsCiphertext) return null

  const cfg = integration.config as { scopes?: string[] } | null
  const channelIds = cfg?.scopes ?? []
  if (channelIds.length === 0) return null

  let token: string
  try {
    token = decrypt(integration.credentialsCiphertext)
  } catch {
    // Mark integration as degraded so the operator sees it in Settings;
    // surface no token to the caller.
    await prisma.integration.update({
      where: { id: integration.id },
      data: { status: 'degraded', lastError: 'token decryption failed' },
    })
    return null
  }
  return { token, channelIds }
}

/**
 * Post a plain text message to every configured channel. Returns the count
 * of successful deliveries; failures are logged inline but don't throw.
 */
async function postToAll(token: string, channelIds: string[], text: string): Promise<number> {
  let ok = 0
  for (const channelId of channelIds) {
    try {
      await chatPostMessage(token, channelId, text)
      ok++
    } catch (err) {
      const reason = err instanceof SlackApiError ? err.slackError : err instanceof Error ? err.message : String(err)
      // eslint-disable-next-line no-console
      console.warn(`[slack-notify] failed to post to ${channelId}: ${reason}`)
    }
  }
  return ok
}

// ─── Approval lifecycle hooks ───────────────────────────

export interface ApprovalDecidedNotification {
  approvalId: string
  approvalTitle: string
  decision: 'approved' | 'denied' | 'approved_with_condition'
  actor: string
  condition?: string
  isFinal: boolean
}

/**
 * Notify Slack that an approver acted on an approval. Posts a one-liner
 * with the title, decision, and actor. The wizard's selected channels all
 * receive the message.
 *
 * Fire-and-forget: callers should not await this in the critical path of
 * an HTTP response. The function never throws so a bare `void notify(...)`
 * is safe.
 */
export async function notifyApprovalDecided(input: ApprovalDecidedNotification): Promise<void> {
  try {
    const ctx = await loadSlackContext()
    if (!ctx) return

    const verb =
      input.decision === 'approved'
        ? '✓ *Approved*'
        : input.decision === 'denied'
          ? '✗ *Denied*'
          : '◐ *Approved with condition*'
    const final = input.isFinal ? ' · chain complete' : ' · chain advanced'
    const conditionLine = input.condition ? `\n_Condition_: ${input.condition}` : ''

    const text = `${verb} by *${input.actor}*${final}\n*${input.approvalTitle}* (\`${input.approvalId}\`)${conditionLine}`

    await postToAll(ctx.token, ctx.channelIds, text)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[slack-notify] notifyApprovalDecided failed:', err instanceof Error ? err.message : err)
  }
}

/**
 * Notify Slack that a new approval has entered the inbox and is waiting
 * for a decision. Used by the approval-router agent after the chain is
 * constructed.
 */
export async function notifyApprovalCreated(input: {
  approvalId: string
  title: string
  riskLevel: string
  requester: string
}): Promise<void> {
  try {
    const ctx = await loadSlackContext()
    if (!ctx) return

    const riskBadge =
      input.riskLevel === 'critical'
        ? '🔴 CRITICAL'
        : input.riskLevel === 'high'
          ? '🟠 HIGH'
          : input.riskLevel === 'medium'
            ? '🟡 MEDIUM'
            : '🟢 LOW'

    const text = `📥 *New approval requested* · ${riskBadge}\n*${input.title}* (\`${input.approvalId}\`)\nRequested by *${input.requester}*`

    await postToAll(ctx.token, ctx.channelIds, text)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[slack-notify] notifyApprovalCreated failed:', err instanceof Error ? err.message : err)
  }
}
