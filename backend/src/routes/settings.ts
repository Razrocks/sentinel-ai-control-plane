import { FastifyInstance } from 'fastify'

// Integration health status — will be replaced with real MCP connections in Phase 8
const integrations = [
  {
    name: 'ServiceNow',
    type: 'mcp',
    status: 'connected' as const,
    version: 'v2.1.0',
    description: 'Incident and change management',
    lastChecked: new Date().toISOString(),
  },
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
