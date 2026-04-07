import Fastify from 'fastify'
import cors from '@fastify/cors'
import { config } from './config.js'
import { prisma } from './lib/prisma.js'
import { AppError } from './lib/errors.js'

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
    message: config.nodeEnv === 'development' ? error.message : 'Internal server error',
  })
})

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
