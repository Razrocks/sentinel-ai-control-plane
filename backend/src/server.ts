import Fastify from 'fastify'
import cors from '@fastify/cors'
import { config } from './config.js'
import { prisma } from './lib/prisma.js'
import { AppError } from './lib/errors.js'
import { captureException } from './lib/self-monitor.js'
import { changesRoutes } from './routes/changes.js'
import { incidentsRoutes } from './routes/incidents.js'
import { accessRequestsRoutes } from './routes/access-requests.js'
import { approvalsRoutes } from './routes/approvals.js'
import { auditRoutes } from './routes/audit.js'
import { policiesRoutes } from './routes/policies.js'
import { settingsRoutes } from './routes/settings.js'
import { authRoutes } from './routes/auth.js'
import { actionsRoutes } from './routes/actions.js'
import { chatRoutes } from './routes/chat.js'
import { agentsRoutes } from './routes/agents.js'
import { metricsRoutes } from './routes/metrics.js'
import { webhookRoutes } from './routes/webhooks.js'
import { setupRoutes } from './routes/setup.js'
import { integrationsRoutes } from './routes/integrations.js'
// Side-effect import: registers every provider's adapter on boot so the
// webhook router + integrations CRUD can dispatch by type.
import './integrations/index.js'
import { randomUUID } from 'node:crypto'

// ─── Secret redaction ────────────────────────────────────
// Hard lock: never log auth headers, cookies, API keys, JWTs, or env values.
// Applies to every log line emitted by Fastify or pino.
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["anthropic-api-key"]',
  'res.headers["set-cookie"]',
  // Defensive: if env or config ever logged, redact known secret fields
  '*.ANTHROPIC_API_KEY',
  '*.anthropicApiKey',
  '*.JWT_SECRET',
  '*.jwtSecret',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.apiKey',
]

const app = Fastify({
  // D1: every request gets a stable traceId. Echoed back in response header
  // so the client can include it in bug reports; logged on every log line via
  // request-bound logger so log analysis can follow one request end-to-end.
  genReqId: (req) => {
    const inbound = req.headers['x-request-id']
    return typeof inbound === 'string' && inbound.length > 0 ? inbound : randomUUID()
  },
  logger: {
    level: config.nodeEnv === 'development' ? 'info' : 'warn',
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    transport:
      config.nodeEnv === 'development'
        ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
        : undefined,
  },
})

// Echo traceId back to client + bind to request logger automatically (Fastify default).
app.addHook('onRequest', (request, reply, done) => {
  reply.header('x-request-id', request.id)
  done()
})

// ─── Defensive: strip any sk-ant-* keys from strings before they reach logs / clients
function scrubSecrets(text: string): string {
  return text
    .replace(/sk-ant-[A-Za-z0-9_-]{20,}/g, '[REDACTED_ANTHROPIC_KEY]')
    .replace(/Bearer\s+[A-Za-z0-9._-]{20,}/gi, 'Bearer [REDACTED_JWT]')
    .replace(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, '[REDACTED_JWT]')
}

// ─── Plugins ─────────────────────────────────────────────
await app.register(cors, {
  origin: config.corsOrigin,
  credentials: true,
})

// ─── Error handler ───────────────────────────────────────
// All error messages run through scrubSecrets before reaching the client OR logs.
// Anthropic SDK and other libs sometimes embed credentials in error messages —
// we never want those to escape this boundary.
app.setErrorHandler((error, request, reply) => {
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({
      error: error.code,
      message: scrubSecrets(error.message),
    })
  }

  // Log a scrubbed copy; never log the raw error object that may contain secrets
  const err = error as Error
  app.log.error({ msg: scrubSecrets(err.message ?? String(error)), name: err.name })

  // Phase 5.5: forward unexpected 5xx errors to self-monitoring. No-op
  // when SENTRY_DSN isn't configured — see lib/self-monitor.ts.
  captureException(err, {
    route: request.url,
    method: request.method,
    userId: request.user?.userId,
  })

  return reply.status(500).send({
    error: 'INTERNAL_SERVER_ERROR',
    message:
      config.nodeEnv === 'development'
        ? scrubSecrets(err.message ?? 'Internal server error')
        : 'Internal server error',
  })
})

// ─── Routes ──────────────────────────────────────────────
await app.register(authRoutes)
await app.register(changesRoutes)
await app.register(incidentsRoutes)
await app.register(accessRequestsRoutes)
await app.register(approvalsRoutes)
await app.register(auditRoutes)
await app.register(policiesRoutes)
await app.register(settingsRoutes)
await app.register(actionsRoutes)
await app.register(chatRoutes)
await app.register(agentsRoutes)
await app.register(metricsRoutes)
await app.register(webhookRoutes)
await app.register(setupRoutes)
await app.register(integrationsRoutes)

// ─── Health check ────────────────────────────────────────
app.get('/api/health', async () => {
  // Verify DB connection
  await prisma.$queryRaw`SELECT 1`
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  }
})

// ─── Start ───────────────────────────────────────────────
try {
  await app.listen({ port: config.port, host: config.host })
  app.log.info(`Sentinel backend running at http://${config.host}:${config.port}`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}

export { app }
