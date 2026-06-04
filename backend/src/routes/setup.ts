/**
 * Setup routes — first-run bootstrap wizard.
 *
 * Drives the multi-step setup flow that a fresh Sentinel instance walks
 * through before the main app is reachable:
 *
 *   GET  /api/setup/status      — what's done, what's next, env health
 *   POST /api/setup/env-check   — re-evaluate env vars (called on Recheck)
 *   POST /api/setup/seed        — load demo data (optional step)
 *   POST /api/setup/complete    — mark onboarding done
 *
 * The `setup_state` table is a single-row singleton; `onboardingComplete=true`
 * gates everything else. The wizard frontend checks /status on every page
 * load and redirects to /setup when the flag is false.
 *
 * Auth model: these routes are intentionally NOT gated by auth — they exist
 * precisely for the case where no user exists yet. Once the first admin is
 * created (via the existing auth routes), this route stops mattering and
 * the wizard hides itself.
 */

import type { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { config } from '../config.js'
import { isEncryptionAvailable } from '../integrations/_base/encryption.js'

interface EnvCheckItem {
  key: string
  required: boolean
  present: boolean
  /** Human label for the wizard. */
  label: string
  /** Hint shown when present=false. */
  fixHint?: string
}

function checkEnv(): EnvCheckItem[] {
  return [
    {
      key: 'DATABASE_URL',
      required: true,
      present: !!config.databaseUrl,
      label: 'Database connection',
      fixHint: 'Set in backend/.env or docker-compose environment.',
    },
    {
      key: 'JWT_SECRET',
      required: true,
      present: !!config.jwtSecret && config.jwtSecret.length >= 16,
      label:
        config.jwtSecret === 'dev-secret-change-in-production'
          ? 'JWT signing secret (dev default — rotate before production)'
          : 'JWT signing secret',
      fixHint: 'Set JWT_SECRET in backend/.env (16+ chars). Default dev value works for local but should rotate before production.',
    },
    {
      key: 'ANTHROPIC_API_KEY',
      required: true,
      present: !!config.anthropicApiKey,
      label: 'Anthropic API key',
      fixHint: 'Required for agentic skills (Re-analyze, chat). Set in backend/.env.',
    },
    {
      key: 'ENCRYPTION_KEY',
      required: true,
      present: isEncryptionAvailable(),
      label: 'Encryption key (AES-256-GCM)',
      fixHint: 'Generate: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    },
  ]
}

/** Load or create the singleton SetupState row. */
async function getOrCreateState() {
  const existing = await prisma.setupState.findFirst({ where: { singleton: true } })
  if (existing) return existing
  return prisma.setupState.create({ data: { singleton: true } })
}

export async function setupRoutes(app: FastifyInstance) {
  /**
   * GET /api/setup/status — top-level wizard state.
   *
   * Returns:
   *   - onboardingComplete: skip the wizard entirely
   *   - envChecks: red/green per required env var
   *   - migrationsPending: from prisma migration_lock (best-effort)
   *   - hasFirstAdmin: at least one admin user exists
   *   - completedSteps: which wizard steps have been ticked off
   */
  app.get('/api/setup/status', async () => {
    const [state, adminCount] = await Promise.all([
      getOrCreateState(),
      prisma.user.count({ where: { role: 'admin' } }),
    ])
    const envChecks = checkEnv()
    const allEnvOk = envChecks.every((c) => !c.required || c.present)

    return {
      onboardingComplete: state.onboardingComplete,
      completedSteps: state.completedSteps,
      envChecks,
      allEnvOk,
      hasFirstAdmin: adminCount > 0,
      adminCount,
    }
  })

  /**
   * POST /api/setup/env-check — re-run the env check after the user has
   * edited .env and restarted the backend. The wizard polls this on
   * "Recheck environment" so the operator gets immediate feedback.
   */
  app.post('/api/setup/env-check', async () => {
    const envChecks = checkEnv()
    return { envChecks, allEnvOk: envChecks.every((c) => !c.required || c.present) }
  })

  /**
   * POST /api/setup/step/:name — record that a wizard step finished. The
   * frontend posts this after each successful step (env_check, first_admin,
   * seed_data) so a refresh during setup resumes at the right place.
   */
  app.post<{ Params: { name: string } }>('/api/setup/step/:name', async (request) => {
    const name = request.params.name
    const state = await getOrCreateState()
    if (state.completedSteps.includes(name)) {
      return { state, alreadyDone: true }
    }
    const updated = await prisma.setupState.update({
      where: { id: state.id },
      data: { completedSteps: [...state.completedSteps, name] },
    })
    return { state: updated }
  })

  /**
   * POST /api/setup/complete — mark onboarding done. Refuses if any
   * required env var is still missing, or if no admin user exists. After
   * this, the wizard hides itself and /setup redirects to /.
   */
  app.post('/api/setup/complete', async () => {
    const envChecks = checkEnv()
    const allEnvOk = envChecks.every((c) => !c.required || c.present)
    const adminCount = await prisma.user.count({ where: { role: 'admin' } })

    if (!allEnvOk) {
      return {
        ok: false,
        error: 'ENV_INCOMPLETE',
        message: 'Required env vars missing. Re-check before completing.',
        envChecks,
      }
    }
    if (adminCount === 0) {
      return {
        ok: false,
        error: 'NO_ADMIN',
        message: 'Create the first admin user before completing.',
      }
    }

    const state = await getOrCreateState()
    const updated = await prisma.setupState.update({
      where: { id: state.id },
      data: {
        onboardingComplete: true,
        completedAt: new Date(),
        firstAdminUserId:
          state.firstAdminUserId ??
          (await prisma.user.findFirst({ where: { role: 'admin' }, select: { id: true } }))?.id ??
          null,
      },
    })
    return { ok: true, state: updated }
  })
}
