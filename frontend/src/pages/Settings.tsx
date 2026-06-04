import { useState } from 'react'
import { CheckCircle, XCircle, Server, Shield, Database, GitBranch, RefreshCw, Play, AlertTriangle, Clock, Settings2, Zap } from 'lucide-react'
import { useRole } from '@/lib/roles'
import { IntegrationsPanel } from '@/components/shared/IntegrationsPanel'

interface ConnectionCard {
  name: string
  status: 'connected' | 'disconnected' | 'degraded'
  icon: React.ElementType
  details: string
  lastChecked: string
}

const connections: ConnectionCard[] = [
  { name: 'ServiceNow', status: 'connected', icon: Server, details: 'Instance: prod-corp.service-now.com', lastChecked: '2 min ago' },
  { name: 'OPA Policy Engine', status: 'connected', icon: Shield, details: '8 active policy bundles · v2.4.1', lastChecked: '1 min ago' },
  { name: 'PostgreSQL', status: 'connected', icon: Database, details: 'sentinel-db:5432 · 99.99% uptime', lastChecked: '30 sec ago' },
  { name: 'GitHub', status: 'connected', icon: GitBranch, details: 'org/sentinel-managed-repos · 4 repos', lastChecked: '5 min ago' },
]

const statusColor = {
  connected: 'text-status-approved',
  disconnected: 'text-risk-critical',
  degraded: 'text-status-pending',
}

export default function Settings() {
  const { role } = useRole()
  const isAdmin = role === 'admin'
  const [testingConnection, setTestingConnection] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, 'success' | 'failed'>>({})

  const handleTestConnection = (name: string) => {
    setTestingConnection(name)
    // Simulate a connection test
    setTimeout(() => {
      setTestResults(prev => ({ ...prev, [name]: 'success' }))
      setTestingConnection(null)
    }, 1500)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-text-primary">Settings</h1>
        <p className="text-text-secondary mt-1">
          {isAdmin ? 'System configuration, integration management, and control-plane settings' : 'Integration status and configuration'}
        </p>
      </div>

      {/* Phase 2: real integration management (encryption, adapters, webhooks) */}
      <IntegrationsPanel />

      {/* Legacy system connections — kept for visibility, will fold into the
          IntegrationsPanel once each provider has a real adapter (Phase 3). */}
      <div>
        <h2 className="text-sm font-medium text-text-muted uppercase tracking-wider mb-3">Integrations</h2>
        <div className="grid grid-cols-2 gap-4">
          {connections.map(conn => (
            <div key={conn.name} className="bg-surface rounded-lg border border-border p-4">
              <div className="flex items-center gap-4">
                <div className="p-2.5 rounded-lg bg-surface-raised">
                  <conn.icon className="w-5 h-5 text-text-secondary" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text-primary">{conn.name}</span>
                    {conn.status === 'connected' ? (
                      <CheckCircle className={`w-4 h-4 ${statusColor[conn.status]}`} />
                    ) : (
                      <XCircle className={`w-4 h-4 ${statusColor[conn.status]}`} />
                    )}
                  </div>
                  <div className="text-xs text-text-muted">{conn.details}</div>
                </div>
                <span className={`text-xs font-medium capitalize ${statusColor[conn.status]}`}>{conn.status}</span>
              </div>
              {/* Admin: test + last checked */}
              {isAdmin && (
                <div className="mt-3 pt-3 border-t border-border flex items-center justify-between">
                  <span className="text-[10px] text-text-muted flex items-center gap-1">
                    <Clock className="w-3 h-3" /> Last checked: {conn.lastChecked}
                  </span>
                  <button
                    onClick={() => handleTestConnection(conn.name)}
                    disabled={testingConnection === conn.name}
                    className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-surface-raised text-text-secondary hover:text-text-primary hover:bg-border transition-colors disabled:opacity-50"
                  >
                    {testingConnection === conn.name ? (
                      <><RefreshCw className="w-3 h-3 animate-spin" /> Testing...</>
                    ) : testResults[conn.name] === 'success' ? (
                      <><CheckCircle className="w-3 h-3 text-status-approved" /> Passed</>
                    ) : (
                      <><Play className="w-3 h-3" /> Test Connection</>
                    )}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Active MCPs */}
      <div>
        <h2 className="text-sm font-medium text-text-muted uppercase tracking-wider mb-3">Active MCP Surfaces</h2>
        <div className="bg-surface rounded-lg border border-border overflow-hidden">
          {[
            { name: 'ServiceNow MCP', desc: 'Incident sync, change ticket creation, KB article fetch', version: 'v1.3.0' },
            { name: 'Execution MCP', desc: 'Controlled apply, simulation, rollback orchestration', version: 'v2.1.0' },
            { name: 'Policy & Access MCP', desc: 'Policy evaluation, entitlement checks, access grant/revoke', version: 'v1.8.0' },
          ].map(mcp => (
            <div key={mcp.name} className="flex items-center justify-between px-4 py-3 border-b border-border last:border-b-0">
              <div>
                <span className="text-sm text-text-primary">{mcp.name}</span>
                {isAdmin && <div className="text-[10px] text-text-muted mt-0.5">{mcp.desc}</div>}
              </div>
              <div className="flex items-center gap-3">
                {isAdmin && <span className="text-[10px] text-text-muted font-mono">{mcp.version}</span>}
                <span className="text-xs text-status-approved font-medium flex items-center gap-1.5">
                  <CheckCircle className="w-3.5 h-3.5" /> Active
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Configuration */}
      <div className="grid grid-cols-2 gap-6">
        <div>
          <h2 className="text-sm font-medium text-text-muted uppercase tracking-wider mb-3">Environment</h2>
          <div className="bg-surface rounded-lg border border-border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-text-secondary">Active Environment</span>
              <div className="flex items-center gap-2">
                <span className="text-sm text-text-primary font-medium">Production</span>
                {isAdmin && <span className="text-[10px] px-1.5 py-0.5 rounded bg-risk-high/10 text-risk-high font-medium">LIVE</span>}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-text-secondary">Default Execution Mode</span>
              <div className="flex items-center gap-2">
                <span className="text-sm text-status-simulated font-medium">Simulate Only</span>
                {isAdmin && (
                  <span className="text-[10px] text-text-muted">(policy-enforced)</span>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-text-secondary">Freeze Window</span>
              <span className="text-sm text-text-primary">None active</span>
            </div>
            {isAdmin && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text-secondary">Policy Bundle Version</span>
                  <span className="text-sm text-text-primary font-mono">v2.4.1</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text-secondary">Last Policy Sync</span>
                  <span className="text-sm text-text-muted">2 minutes ago</span>
                </div>
                <div className="border-t border-border pt-3 space-y-2">
                  <div className="text-[10px] text-text-muted uppercase tracking-wider">Admin Actions</div>
                  <div className="flex gap-2">
                    <button className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium bg-surface-raised text-text-secondary hover:text-text-primary hover:bg-border transition-colors">
                      <Settings2 className="w-3 h-3" /> Configure Freeze Window
                    </button>
                    <button className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium bg-surface-raised text-text-secondary hover:text-text-primary hover:bg-border transition-colors">
                      <RefreshCw className="w-3 h-3" /> Force Policy Sync
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        <div>
          <h2 className="text-sm font-medium text-text-muted uppercase tracking-wider mb-3">Role Mapping</h2>
          <div className="bg-surface rounded-lg border border-border overflow-hidden">
            {[
              { role: 'Operator', count: 4 },
              { role: 'Approver', count: 6 },
              { role: 'Engineer', count: 12 },
              { role: 'IT Support', count: 8 },
              { role: 'Access Approver', count: 3 },
              { role: 'Admin', count: 2 },
            ].map(r => (
              <div key={r.role} className="flex items-center justify-between px-4 py-2.5 border-b border-border last:border-b-0">
                <span className="text-sm text-text-primary">{r.role}</span>
                <span className="text-xs text-text-muted">{r.count} users</span>
              </div>
            ))}
          </div>
          {isAdmin && (
            <div className="mt-3 flex gap-2">
              <button className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium bg-surface-raised text-text-secondary hover:text-text-primary hover:bg-border transition-colors border border-border">
                <Zap className="w-3 h-3" /> Edit Role Mappings
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Admin: Guardrails note */}
      {isAdmin && (
        <div className="bg-surface-raised rounded-lg border border-border px-4 py-3 flex items-center gap-3">
          <AlertTriangle className="w-4 h-4 text-status-pending flex-shrink-0" />
          <p className="text-xs text-text-muted">
            Configuration changes are logged in the audit trail. Hard policy blocks and immutable guardrails cannot be modified from this interface — they require policy bundle updates through the OPA engine.
          </p>
        </div>
      )}
    </div>
  )
}
