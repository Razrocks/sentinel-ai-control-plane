/**
 * IntegrationAdapter — the interface every integration implements.
 *
 * One adapter per provider (github, slack, linear, sentry, pagerduty).
 * The adapter knows nothing about HTTP routing or DB persistence; it
 * exposes pure operations that the route layer + setup wizard call.
 *
 * Lifecycle:
 *   1. testConnection — verify credentials work before we save them.
 *   2. listScopes      — return repos/channels/projects the operator picks from.
 *   3. registerWebhook — optionally have the provider POST events back to us.
 *   4. handleEvent     — invoked by the webhook router for inbound events.
 *
 * Methods that aren't relevant for an adapter return `null` rather than
 * throw. The setup wizard reads the returned value to decide whether to
 * render that step.
 */

import type { IntegrationType, Integration } from '@prisma/client'

export interface ConnectionTestResult {
  ok: boolean
  /** Account name/handle the credential authenticates as. e.g. "@razeenmeera". */
  identity?: string
  /** Provider-side rate-limit headroom (calls remaining / window). Optional. */
  rateLimit?: { remaining: number; resetAt: string }
  errorMessage?: string
}

export interface ScopeOption {
  /** Stable id used by the wizard's checkbox state and webhook registration. */
  id: string
  /** Display label — `"my-org/my-repo"`, `"#deploys"`, `"ENG"`. */
  label: string
  /** Provider-specific context. Stored on Integration.config under `scopes[]`. */
  meta?: Record<string, unknown>
}

export interface WebhookRegistration {
  /** Provider-side webhook id, so we can delete it on disconnect. */
  providerWebhookId: string
  /** The URL we asked the provider to POST to. */
  deliveryUrl: string
  /** Shared secret we'll use to HMAC-verify incoming events. */
  sharedSecret: string
}

/**
 * One inbound event the router dispatches to `handleEvent`. The router does
 * the HMAC check + dedup BEFORE we get here; the adapter just decides what
 * to do with a verified event.
 */
export interface InboundEvent {
  providerEventId: string
  eventType: string
  /** Parsed JSON body. Adapters may also access raw via `rawBody` for re-verify. */
  body: unknown
  rawBody: string
  /** Headers the provider sent (delivery id, signature, etc.). Lower-cased keys. */
  headers: Record<string, string>
}

export interface EventResult {
  /** 'processed' triggered side effects; 'skipped' was deliberately ignored. */
  result: 'processed' | 'skipped' | 'failed'
  errorMessage?: string
  /** Optional id of any Sentinel object created/updated (for cross-linking). */
  sentinelObjectId?: string
  sentinelObjectType?: string
}

/**
 * The contract. Optional members return `null` when unsupported, never
 * throw — keeps the route layer's branching simple.
 */
export interface IntegrationAdapter {
  readonly type: IntegrationType

  /** Verify the credential works. Called by setup wizard step 4. */
  testConnection(credential: string): Promise<ConnectionTestResult>

  /** List installable scopes after credentials are saved. `null` = no scope step. */
  listScopes?(integration: Integration, credential: string): Promise<ScopeOption[]>

  /** Tell the provider to POST events to our URL. `null` = inbound not supported. */
  registerWebhook?(
    integration: Integration,
    credential: string,
    deliveryUrl: string,
    scopeId: string,
  ): Promise<WebhookRegistration>

  /** Clean up the registered webhook on disconnect. Idempotent. */
  unregisterWebhook?(integration: Integration, credential: string, providerWebhookId: string): Promise<void>

  /** Dispatch a verified inbound event. */
  handleEvent(integration: Integration, event: InboundEvent): Promise<EventResult>
}

/**
 * Registry of adapters, keyed by IntegrationType. Each integration's
 * `index.ts` calls `registerAdapter(adapter)` at module load.
 */
const _adapters: Partial<Record<IntegrationType, IntegrationAdapter>> = {}

export function registerAdapter(adapter: IntegrationAdapter): void {
  if (_adapters[adapter.type]) {
    throw new Error(`adapter already registered for ${adapter.type}`)
  }
  _adapters[adapter.type] = adapter
}

export function getAdapter(type: IntegrationType): IntegrationAdapter {
  const adapter = _adapters[type]
  if (!adapter) {
    throw new Error(`no adapter registered for ${type} — was the module imported?`)
  }
  return adapter
}

export function hasAdapter(type: IntegrationType): boolean {
  return !!_adapters[type]
}

export function listAdapters(): IntegrationType[] {
  return Object.keys(_adapters) as IntegrationType[]
}
