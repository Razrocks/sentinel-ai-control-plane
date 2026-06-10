/**
 * Settings — integration management + environment overview.
 *
 * Real integrations come from IntegrationsPanel (Phase 2 / 3).
 * Removed hand-crafted fake "connections" + fake MCP list — they were
 * static stubs that misrepresented real wiring.
 */
import { AlertTriangle, RefreshCw, Settings2, Zap } from 'lucide-react'
import { useRole } from '@/lib/roles'
import { IntegrationsPanel } from '@/components/shared/IntegrationsPanel'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export default function Settings() {
  const { role } = useRole()
  const isAdmin = role === 'admin'

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-3">
        <h1 className="font-heading text-3xl font-medium tracking-tight text-foreground">
          Settings
        </h1>
        <p className="text-sm text-muted-foreground">
          {isAdmin
            ? 'System configuration, integration management, and control-plane settings.'
            : 'Integration status and configuration.'}
        </p>
      </div>

      {/* Real integration manager — encryption, adapter scopes, webhooks. */}
      <IntegrationsPanel />

      {/* Environment + role map — preserved data, polished layout. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Environment
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 py-4">
            <Row label="Active Environment">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">Production</span>
                {isAdmin && (
                  <span className="rounded-md bg-risk-high/15 px-2 py-0.5 text-xs font-medium text-risk-high">
                    LIVE
                  </span>
                )}
              </div>
            </Row>
            <Row label="Default Execution Mode">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-status-simulated">Simulate Only</span>
                {isAdmin && <span className="text-xs text-muted-foreground">(policy-enforced)</span>}
              </div>
            </Row>
            <Row label="Freeze Window">
              <span className="text-sm text-foreground">None active</span>
            </Row>
            {isAdmin && (
              <>
                <Row label="Policy Bundle Version">
                  <span className="text-sm font-mono text-foreground">v2.4.1</span>
                </Row>
                <Row label="Last Policy Sync">
                  <span className="text-sm text-muted-foreground">2 minutes ago</span>
                </Row>
                <div className="border-t border-border pt-3 flex flex-col gap-2">
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Admin Actions
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <Button variant="outline" size="sm">
                      <Settings2 className="h-3.5 w-3.5" /> Configure Freeze Window
                    </Button>
                    <Button variant="outline" size="sm">
                      <RefreshCw className="h-3.5 w-3.5" /> Force Policy Sync
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Role Mapping
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 py-2">
            {[
              { role: 'Operator', count: 4 },
              { role: 'Approver', count: 6 },
              { role: 'Engineer', count: 12 },
              { role: 'IT Support', count: 8 },
              { role: 'Access Approver', count: 3 },
              { role: 'Admin', count: 2 },
            ].map(r => (
              <div
                key={r.role}
                className="flex items-center justify-between border-b border-border/60 py-2.5 last:border-b-0"
              >
                <span className="text-sm text-foreground">{r.role}</span>
                <span className="text-xs text-muted-foreground">{r.count} users</span>
              </div>
            ))}
            {isAdmin && (
              <div className="pt-3">
                <Button variant="outline" size="sm">
                  <Zap className="h-3.5 w-3.5" /> Edit Role Mappings
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {isAdmin && (
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 text-status-pending" />
            <p className="text-xs text-muted-foreground">
              Configuration changes are logged in the audit trail. Hard policy blocks and immutable
              guardrails cannot be modified from this interface — they require policy bundle updates
              through the OPA engine.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}
