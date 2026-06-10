import { FastifyInstance } from 'fastify'

// Integration health status — stub for /api/settings/health. Real
// integration rows live in /api/integrations (see integrations.ts) and
// are sourced from the encrypted Integration table.
const integrations = [
  {
    name: 'GitHub Enterprise',
    type: 'mcp',
    status: 'connected' as const,
    version: 'v1.8.3',
    description: 'Repository and PR management',
    lastChecked: new Date().toISOString(),
  },
  {
    name: 'OPA Policy Engine',
    type: 'mcp',
    status: 'connected' as const,
    version: 'v0.58.0',
    description: 'Policy evaluation and enforcement',
    lastChecked: new Date().toISOString(),
  },
  {
    name: 'Entitlement Service',
    type: 'api',
    status: 'degraded' as const,
    version: 'v3.2.1',
    description: 'User entitlement and role checking',
    lastChecked: new Date().toISOString(),
  },
]

export async function settingsRoutes(app: FastifyInstance) {
  // GET /api/settings/integrations
  app.get('/api/settings/integrations', async () => {
    return { integrations }
  })

  // GET /api/settings/health
  app.get('/api/settings/health', async () => {
    const connected = integrations.filter((i) => i.status === 'connected').length
    const total = integrations.length
    return {
      overall: connected === total ? 'healthy' : 'degraded',
      connected,
      total,
      policyBundleVersion: 'v2026.03.15-001',
      defaultExecutionMode: 'simulate_only',
      freezeWindow: null,
    }
  })
}
