/**
 * SlackAdapter — implements IntegrationAdapter for Slack.
 *
 * Unlike GitHub, Slack does not let us register a webhook via API — the
 * delivery URL is configured on the Slack App's Event Subscriptions page
 * by the operator. We expose the URL via the wizard's webhook step so
 * they can copy-paste; `registerWebhook` is therefore a no-op success.
 *
 * Two secrets are involved:
 *   - Bot token (xoxb-...): stored as `credentialsCiphertext`, used to
 *     call chat.postMessage etc. Per-workspace.
 *   - Signing secret: stored as `webhookSecretCiphertext`, used by the
 *     webhook router to verify inbound `X-Slack-Signature` headers.
 *
 * The signing secret is fetched from the Slack app config by the
 * operator; we accept it via the connect-step body (the wizard will gain
 * a second input field for Slack specifically).
 *
 * Event handling (Phase 3.2 scope):
 *   - url_verification → respond with challenge (required for app setup)
 *   - app_mention → record audit event; deeper conversational handling
 *     ships in Phase 3.2b alongside Slack-driven approvals.
 *   - message (im) → ignored for now to avoid noisy logs.
 *   - block_actions (interactive components) → Phase 3.2b.
 */

import type { Integration } from '@prisma/client'
import {
  type IntegrationAdapter,
  type ConnectionTestResult,
  type ScopeOption,
  type WebhookRegistration,
  type InboundEvent,
  type EventResult,
  registerAdapter,
} from '../_base/adapter.js'
import { authTest, listChannels, SlackApiError } from './client.js'
import { prisma } from '../../lib/prisma.js'

function errorToTestResult(err: unknown): ConnectionTestResult {
  if (err instanceof SlackApiError) {
    if (err.slackError === 'invalid_auth' || err.slackError === 'not_authed') {
      return { ok: false, errorMessage: 'Slack rejected the bot token. Check it starts with `xoxb-` and is from the right workspace.' }
    }
    if (err.slackError === 'token_revoked') {
      return { ok: false, errorMessage: 'Bot token has been revoked. Reinstall the Slack app to your workspace.' }
    }
    return { ok: false, errorMessage: `Slack: ${err.slackError}` }
  }
  return { ok: false, errorMessage: err instanceof Error ? err.message : String(err) }
}

export const slackAdapter: IntegrationAdapter = {
  type: 'slack',

  async testConnection(credential: string): Promise<ConnectionTestResult> {
    try {
      const auth = await authTest(credential)
      return {
        ok: true,
        identity: `${auth.team} as @${auth.user}`,
      }
    } catch (err) {
      return errorToTestResult(err)
    }
  },

  async listScopes(_integration: Integration, credential: string): Promise<ScopeOption[]> {
    const { channels } = await listChannels(credential)
    // Only show channels the bot is already in OR public channels it can
    // be added to. The wizard's scope picker is "which channels do
    // notifications go to" — bot must be a member of private channels.
    return channels
      .filter((c) => !c.is_archived)
      .map((c) => ({
        id: c.id,
        label: `#${c.name}${c.is_private ? ' (private)' : ''}`,
        meta: {
          isPrivate: c.is_private,
          isMember: c.is_member,
        },
      }))
  },

  /**
   * Slack webhooks are configured on the Slack App side, not via API. The
   * route layer's `register-webhook` call still passes through this method;
   * we use it as the place to validate that the signing secret is stored.
   *
   * Returns a fake providerWebhookId because there isn't one — Slack's
   * subscription is keyed on the URL we tell them, not an id they tell us.
   */
  async registerWebhook(
    integration: Integration,
    _credential: string,
    deliveryUrl: string,
    scopeId: string,
  ): Promise<WebhookRegistration> {
    if (!integration.webhookSecretCiphertext) {
      throw new Error(
        'Slack signing secret not provided. Connect step must include the signing secret from your Slack app config.',
      )
    }
    // We surface scopeId as the providerWebhookId so the disconnect path
    // can iterate scopes consistently with GitHub. There is nothing to
    // delete on Slack's side.
    return {
      providerWebhookId: `slack-channel-${scopeId}`,
      deliveryUrl,
      // The "shared secret" is the user-provided signing secret already
      // encrypted on the Integration row; returning a placeholder keeps
      // the type system happy without leaking the real one.
      sharedSecret: '__already-stored__',
    }
  },

  async unregisterWebhook(): Promise<void> {
    // Nothing to call — the operator manually removes the URL from the
    // Slack app's Event Subscriptions when they disconnect.
  },

  async handleEvent(integration: Integration, event: InboundEvent): Promise<EventResult> {
    // Slack Events API wraps everything in `{ type, event, ... }` envelope.
    const body = event.body as { type?: string; event?: { type?: string; user?: string; text?: string } }
    const envelopeType = body.type

    // Slack uses url_verification once per delivery URL setup. The router
    // catches this BEFORE HMAC verify because at this point the operator
    // is in the middle of configuring it. The reply must be the raw
    // challenge — handled at the route layer; here we just no-op.
    if (envelopeType === 'url_verification') {
      return { result: 'processed' }
    }

    // Real events are wrapped in `event_callback`.
    if (envelopeType === 'event_callback') {
      const inner = body.event
      if (!inner) return { result: 'skipped' }
      switch (inner.type) {
        case 'app_mention':
          // Phase 3.2b: route the mention through the chat-tool loop so
          // the user can ask "what's the status of X" from Slack. For now,
          // log it and acknowledge.
          await prisma.auditEvent.create({
            data: {
              timestamp: new Date(),
              actor: `${inner.user ?? 'unknown'} (slack:${integration.displayName})`,
              action: 'slack_app_mention',
              objectType: 'change',
              objectId: 'slack',
              objectTitle: 'Slack mention',
              result: 'success',
              policyRule: null,
              details: inner.text?.slice(0, 500) ?? '',
            },
          })
          return { result: 'processed' }

        default:
          return { result: 'skipped' }
      }
    }

    // block_actions = interactive button click. Comes through a different
    // endpoint (interactivity URL) but Slack sometimes routes them here.
    // Phase 3.2b will route these into resolveCoApproval.
    if (envelopeType === 'block_actions') {
      return { result: 'skipped', errorMessage: 'interactive components not yet wired' }
    }

    return { result: 'skipped' }
  },
}

registerAdapter(slackAdapter)
