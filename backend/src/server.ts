import Fastify from 'fastify'
import cors from '@fastify/cors'
import { config } from './config.js'
import { prisma } from './lib/prisma.js'
import { AppError } from './lib/errors.js'
import { changesRoutes } from './routes/changes.js'
import { incidentsRoutes } from './routes/incidents.js'
import { accessRequestsRoutes } from './routes/access-requests.js'
import { approvalsRoutes } from './routes/approvals.js'
import { auditRoutes } from './routes/audit.js'
import { policiesRoutes } from './routes/policies.js'
import { settingsRoutes } from './routes/settings.js'
import { authRoutes } from './routes/auth.js'
import { actionsRoutes } from './routes/actions.js'

const app = Fastify({
  logger: {
    level: config.nodeEnv === 'development' ? 'info' : 'warn',
    transport:
      config.nodeEnv === 'development'
        ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
        : undefined,
  },
})

// ─── Plugins ─────────────────────────────────────────────
await app.register(cors, {
  origin: config.corsOrigin,
  credentials: true,
})

// ─── Error handler ───────────────────────────────────────
app.setErrorHandler((error, _request, reply) => {
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({
      error: error.code,
      message: error.message,
    })
  }

  app.log.error(error)
  return reply.status(500).send({
    error: 'INTERNAL_SERVER_ERROR',
    message: config.nodeEnv === 'development' ? (error as Error).message : 'Internal server error',
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
