/**
 * Integrations routes — admin-only CRUD for connected external systems.
 *
 *   GET    /api/integrations                  — list (no secrets ever returned)
 *   GET    /api/integrations/types            — adapter catalog (what can be connected)
 *   POST   /api/integrations/:type/test       — verify credential before save
 *   POST   /api/integrations/:type/connect    — save credential + scope + webhook
 *   PATCH  /api/integrations/:type/scope      — update which repos/channels are watched
 *   DELETE /api/integrations/:id              — disconnect (irreversible)
 *
 * Hard rules:
 *   - Credentials are AES-GCM encrypted before the prisma write
 *   - Plaintext credential is never logged, never returned by any GET
 *   - The integration list returns identity + status + scope; never raw token
 *   - Admin-only (requireRole 'admin')
 */

import type { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import type { IntegrationType, IntegrationStatus, Prisma } from '@prisma/client'
import { requireAuth } from '../middleware/auth.js'
import { requireRole } from '../middleware/rbac.js'
import { NotFoundError, ValidationError } from '../lib/errors.js'
import {
  encrypt,
  decrypt,
  isEncryptionAvailable,
  maskCredential,
} from '../integrations/_base/encryption.js'
import { hasAdapter, getAdapter, listAdapters } from '../integrations/_base/adapter.js'

const VALID_TYPES: IntegrationType[] = ['github', 'slack', 'linear', 'sentry', 'pagerduty']

function isValidType(t: string): t is IntegrationType {
  return (VALID_TYPES as string[]).includes(t)
}

/** Strip every secret field before returning an integration to the client. */
function presentIntegration(i: {
  id: string
  type: IntegrationType
  displayName: string
  status: IntegrationStatus
  config: unknown
  lastCheckedAt: Date | null
  lastError: string | null
  createdBy: string
  createdAt: Date
  updatedAt: Date
  credentialsCiphertext: string | null
  webhookSecretCiphertext: string | null
}) {
  return {
    id: i.id,
    type: i.type,
    displayName: i.displayName,
    status: i.status,
    config: i.config,
    lastCheckedAt: i.lastCheckedAt?.toISOString() ?? null,
    lastError: i.lastError,
    createdBy: i.createdBy,
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
    /** True if a credential is stored. Never return the credential itself. */
    hasCredential: !!i.credentialsCiphertext,
    hasWebhookSecret: !!i.webhookSecretCiphertext,
  }
}

export async function integrationsRoutes(app: FastifyInstance) {
  /**
   * GET /api/integrations — list every configured integration. Safe to
   * surface to the admin UI; secrets are not in the payload.
   */
  app.get(
    '/api/integrations',
    { preHandler: [requireAuth, requireRole('admin')] },
    async () => {
      const rows = await prisma.integration.findMany({ orderBy: { type: 'asc' } })
      return { integrations: rows.map(presentIntegration) }
    },
  )

  /**
   * GET /api/integrations/types — catalog of supported integration types
   * with adapter availability. The wizard uses this to render the
   * "available to connect" grid.
   */
  app.get(
    '/api/integrations/types',
    { preHandler: [requireAuth, requireRole('admin')] },
    async () => {
      const adapters = new Set(listAdapters())
      return {
        types: VALID_TYPES.map((type) => ({
          type,
          adapterRegistered: adapters.has(type),
        })),
        encryptionReady: isEncryptionAvailable(),
      }
    },
  )

  /**
   * POST /api/integrations/:type/test — verify a credential by pinging the
   * provider. Body: { credential: string }. Credential is NOT persisted by
   * this route; it lives in memory only for the duration of the call.
   */
  app.post<{ Params: { type: string }; Body: { credential: string } }>(
    '/api/integrations/:type/test',
    { preHandler: [requireAuth, requireRole('admin')] },
    async (request) => {
      const { type } = request.params
      if (!isValidType(type)) throw new ValidationError(`Unknown integration type: ${type}`)
      if (!hasAdapter(type)) {
        return { ok: false, errorMessage: `Adapter not registered for ${type}. Phase 3 work.` }
      }
      const { credential } = request.body
      if (!credential || typeof credential !== 'string') {
        throw new ValidationError('credential field required (string)')
      }
      const adapter = getAdapter(type)
      const result = await adapter.testConnection(credential)
      return result
    },
  )

  /**
   * POST /api/integrations/:type/connect — save credential, run a final
   * test, persist to DB. The credential is encrypted before any DB write.
   *
   * Body: { credential, displayName, config? }
   *   displayName: human label ("GitHub: razeenmeera")
   *   config: non-secret scope (repos[], channels[], etc.)
   *
   * Refuses with 503 if ENCRYPTION_KEY isn't loaded — never silently
   * stores plaintext.
   */
  app.post<{
    Params: { type: string }
    Body: {
      credential: string
      displayName: string
      config?: Record<string, unknown>
      /**
       * Some providers (e.g. Slack) require a signing secret that's
       * separate from the API credential. When present, we encrypt + store
       * it on Integration.webhookSecretCiphertext so the router can verify
       * inbound HMAC signatures without us minting our own secret.
       */
      webhookSecret?: string
    }
  }>(
    '/api/integrations/:type/connect',
    { preHandler: [requireAuth, requireRole('admin')] },
    async (request, reply) => {
      const { type } = request.params
      if (!isValidType(type)) throw new ValidationError(`Unknown integration type: ${type}`)
      if (!isEncryptionAvailable()) {
        return reply.status(503).send({
          error: 'ENCRYPTION_UNAVAILABLE',
          message: 'ENCRYPTION_KEY is not configured. Cannot store credentials safely.',
        })
      }
      const { credential, displayName, config: cfg, webhookSecret } = request.body
      if (!credential) throw new ValidationError('credential required')
      if (!displayName) throw new ValidationError('displayName required')

      // Test the credential before we encrypt it. Refusing a bad token
      // before any DB write keeps the integrations table clean.
      if (hasAdapter(type)) {
        const test = await getAdapter(type).testConnection(credential)
        if (!test.ok) {
          return reply.status(400).send({
            error: 'CREDENTIAL_REJECTED',
            message: test.errorMessage ?? 'Provider rejected the credential.',
          })
        }
      }

      const ciphertext = encrypt(credential)
      const webhookSecretCiphertext = webhookSecret ? encrypt(webhookSecret) : undefined

      // Upsert — re-running the wizard for an existing integration
      // replaces the credential rather than 409'ing.
      const integration = await prisma.integration.upsert({
        where: { type },
        create: {
          type,
          displayName,
          status: 'connected',
          credentialsCiphertext: ciphertext,
          webhookSecretCiphertext,
          config: (cfg ?? {}) as Prisma.InputJsonValue,
          createdBy: request.user!.name,
          lastCheckedAt: new Date(),
        },
        update: {
          displayName,
          status: 'connected',
          credentialsCiphertext: ciphertext,
          ...(webhookSecretCiphertext ? { webhookSecretCiphertext } : {}),
          config: (cfg ?? {}) as Prisma.InputJsonValue,
          lastCheckedAt: new Date(),
          lastError: null,
        },
      })

      return { integration: presentIntegration(integration) }
    },
  )

  /**
   * PATCH /api/integrations/:type/scope — update the watched scope without
   * touching the credential.
   */
  app.patch<{ Params: { type: string }; Body: { config: Record<string, unknown> } }>(
    '/api/integrations/:type/scope',
    { preHandler: [requireAuth, requireRole('admin')] },
    async (request) => {
      const { type } = request.params
      if (!isValidType(type)) throw new ValidationError(`Unknown integration type: ${type}`)
      const integration = await prisma.integration.update({
        where: { type },
        data: { config: request.body.config as Prisma.InputJsonValue },
      })
      return { integration: presentIntegration(integration) }
    },
  )

  /**
   * POST /api/integrations/:type/peek — masked credential for admin display.
   * Returns last-4 only ("····wxyz"). Verifies the credential decrypts.
   */
  app.post<{ Params: { type: string } }>(
    '/api/integrations/:type/peek',
    { preHandler: [requireAuth, requireRole('admin')] },
    async (request) => {
      const { type } = request.params
      if (!isValidType(type)) throw new ValidationError(`Unknown integration type: ${type}`)
      const integration = await prisma.integration.findUnique({ where: { type } })
      if (!integration) throw new NotFoundError('Integration', type)
      if (!integration.credentialsCiphertext) {
        return { masked: '····', hasCredential: false }
      }
      try {
        const plaintext = decrypt(integration.credentialsCiphertext)
        return { masked: maskCredential(plaintext), hasCredential: true }
      } catch {
        return { masked: '····', hasCredential: true, decryptError: true }
      }
    },
  )

  /**
   * GET /api/integrations/:type/scopes — list installable scopes (repos,
   * channels, projects) using the stored credential. The wizard pulls
   * this after credential save to render the scope picker.
   */
  app.get<{ Params: { type: string } }>(
    '/api/integrations/:type/scopes',
    { preHandler: [requireAuth, requireRole('admin')] },
    async (request, reply) => {
      const { type } = request.params
      if (!isValidType(type)) throw new ValidationError(`Unknown integration type: ${type}`)
      const integration = await prisma.integration.findUnique({ where: { type } })
      if (!integration?.credentialsCiphertext) {
        throw new NotFoundError('Integration', type)
      }
      if (!hasAdapter(type)) {
        return reply.status(501).send({ error: 'NO_ADAPTER', message: 'Adapter not registered.' })
      }
      const adapter = getAdapter(type)
      if (!adapter.listScopes) {
        return { scopes: [] }
      }
      const credential = decrypt(integration.credentialsCiphertext)
      const scopes = await adapter.listScopes(integration, credential)
      return { scopes }
    },
  )

  /**
   * POST /api/integrations/:type/register-webhook — register a webhook
   * for each selected scope. Generates a shared secret (one per
   * integration, reused across scopes), encrypts it, stores
   * providerWebhookIds on config.
   *
   * Body: { scopeIds: string[], publicBaseUrl: string }
   *
   * publicBaseUrl is the externally-reachable Sentinel URL — providers
   * post to `<publicBaseUrl>/api/webhooks/<type>`. We never assume our
   * own request host because Sentinel may be behind a tunnel/proxy.
   */
  app.post<{
    Params: { type: string }
    Body: { scopeIds: string[]; publicBaseUrl: string }
  }>(
    '/api/integrations/:type/register-webhook',
    { preHandler: [requireAuth, requireRole('admin')] },
    async (request, reply) => {
      const { type } = request.params
      if (!isValidType(type)) throw new ValidationError(`Unknown integration type: ${type}`)
      const { scopeIds, publicBaseUrl } = request.body
      if (!Array.isArray(scopeIds) || scopeIds.length === 0) {
        throw new ValidationError('scopeIds array required (at least one)')
      }
      if (!publicBaseUrl) throw new ValidationError('publicBaseUrl required')

      const integration = await prisma.integration.findUnique({ where: { type } })
      if (!integration?.credentialsCiphertext) {
        throw new NotFoundError('Integration', type)
      }
      if (!hasAdapter(type)) {
        return reply.status(501).send({ error: 'NO_ADAPTER', message: 'Adapter not registered.' })
      }
      const adapter = getAdapter(type)
      if (!adapter.registerWebhook) {
        return reply.status(501).send({ error: 'INBOUND_NOT_SUPPORTED' })
      }

      const credential = decrypt(integration.credentialsCiphertext)
      const deliveryUrl = `${publicBaseUrl.replace(/\/$/, '')}/api/webhooks/${type}`

      // First scope's registration determines the shared secret — adapter
      // mints one per call. We reuse the same secret across subsequent
      // scopes so the webhook router only needs to track a single secret
      // per integration.
      const providerWebhookIds: string[] = []
      const failures: { scopeId: string; error: string }[] = []
      let sharedSecret: string | null = null

      for (const scopeId of scopeIds) {
        try {
          const registration = await adapter.registerWebhook(integration, credential, deliveryUrl, scopeId)
          // Compose `scopeId:hookId` so unregisterWebhook can parse owner/repo back out.
          providerWebhookIds.push(`${scopeId}:${registration.providerWebhookId}`)
          if (!sharedSecret) sharedSecret = registration.sharedSecret
        } catch (err) {
          failures.push({
            scopeId,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }

      if (!sharedSecret) {
        return reply.status(400).send({
          error: 'WEBHOOK_REGISTRATION_FAILED',
          message: 'No webhooks could be registered.',
          failures,
        })
      }

      // Some adapters (e.g. Slack) don't mint a new secret during webhook
      // registration — the operator already provided the signing secret on
      // the connect step. They signal this by returning the sentinel
      // `__already-stored__` placeholder. Skip the overwrite in that case
      // so we don't clobber the real secret.
      const shouldStoreSharedSecret = sharedSecret !== '__already-stored__'

      const updated = await prisma.integration.update({
        where: { id: integration.id },
        data: {
          status: 'connected',
          ...(shouldStoreSharedSecret
            ? { webhookSecretCiphertext: encrypt(sharedSecret) }
            : {}),
          config: {
            ...(integration.config as object),
            scopes: scopeIds,
            providerWebhookIds,
          } as Prisma.InputJsonValue,
          lastCheckedAt: new Date(),
          lastError: failures.length > 0 ? `Partial: ${failures.length} of ${scopeIds.length} failed` : null,
        },
      })

      return {
        integration: presentIntegration(updated),
        registered: providerWebhookIds.length,
        failures,
      }
    },
  )

  /**
   * DELETE /api/integrations/:id — disconnect. Wipes the encrypted
   * credential, marks status=disconnected. Keeps webhook_events for audit.
   * Adapter's unregisterWebhook is best-effort; we log if it fails but
   * still complete the local disconnect.
   */
  app.delete<{ Params: { id: string } }>(
    '/api/integrations/:id',
    { preHandler: [requireAuth, requireRole('admin')] },
    async (request) => {
      const integration = await prisma.integration.findUnique({ where: { id: request.params.id } })
      if (!integration) throw new NotFoundError('Integration', request.params.id)

      // Best-effort webhook deregistration.
      if (hasAdapter(integration.type) && integration.credentialsCiphertext) {
        const adapter = getAdapter(integration.type)
        if (adapter.unregisterWebhook) {
          try {
            const credential = decrypt(integration.credentialsCiphertext)
            // config may carry providerWebhookId per scope — adapter knows the shape
            const cfg = integration.config as { providerWebhookIds?: string[] } | null
            for (const id of cfg?.providerWebhookIds ?? []) {
              await adapter.unregisterWebhook(integration, credential, id)
            }
          } catch (err) {
            request.log.warn(
              { err: err instanceof Error ? err.message : String(err) },
              'webhook deregistration failed on disconnect',
            )
          }
        }
      }

      const updated = await prisma.integration.update({
        where: { id: integration.id },
        data: {
          status: 'disconnected',
          credentialsCiphertext: null,
          webhookSecretCiphertext: null,
        },
      })
      return { integration: presentIntegration(updated) }
    },
  )
}
