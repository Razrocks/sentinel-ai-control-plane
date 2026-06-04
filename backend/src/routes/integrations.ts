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
    Body: { credential: string; displayName: string; config?: Record<string, unknown> }
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
      const { credential, displayName, config: cfg } = request.body
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

      // Upsert — re-running the wizard for an existing integration
      // replaces the credential rather than 409'ing.
      const integration = await prisma.integration.upsert({
        where: { type },
        create: {
          type,
          displayName,
          status: 'connected',
          credentialsCiphertext: ciphertext,
          config: (cfg ?? {}) as Prisma.InputJsonValue,
          createdBy: request.user!.name,
          lastCheckedAt: new Date(),
        },
        update: {
          displayName,
          status: 'connected',
          credentialsCiphertext: ciphertext,
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
