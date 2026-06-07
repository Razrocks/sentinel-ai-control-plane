/**
 * IntegrationsPanel — real integration management UI.
 *
 * Renders two sections:
 *   - Connected: rows backed by /api/integrations
 *   - Available: known types whose adapter is registered but not yet
 *     connected; clicking [Connect] opens the wizard.
 *
 * Admin-only. Non-admins see a read-only summary (count by status).
 *
 * Phase 2.5 scope: minimal but functional. Wizard is a single modal — the
 * full multi-step wizard ASCII mockup from earlier ships in Phase 4 when
 * the design system lands.
 */
import { useState } from 'react'
import { Plug, CheckCircle2, AlertTriangle, XCircle, RefreshCw, Loader2 } from 'lucide-react'
import {
  useIntegrations,
  useIntegrationTypes,
  useConnectIntegration,
  useTestIntegration,
  useDisconnectIntegration,
  useIntegrationScopes,
  useRegisterWebhook,
} from '@/hooks/useSetup'
import { useRole } from '@/lib/roles'
import type { IntegrationRow, IntegrationStatus } from '@/lib/api'

const TYPE_LABELS: Record<string, string> = {
  github: 'GitHub',
  slack: 'Slack',
  linear: 'Linear',
  sentry: 'Sentry',
  pagerduty: 'PagerDuty',
}

const TYPE_DESCRIPTIONS: Record<string, string> = {
  github: 'PRs → Changes · CI status · merge gating',
  slack: 'Approval notifications · interactive decide',
  linear: 'Ticket ↔ Change correlation',
  sentry: 'Errors → Incidents auto-create',
  pagerduty: 'Pages → Incidents',
}

export function IntegrationsPanel() {
  const { role } = useRole()
  const isAdmin = role === 'admin'
  const { data: integrationsData, isLoading } = useIntegrations()
  const { data: typesData } = useIntegrationTypes()
  const [connecting, setConnecting] = useState<string | null>(null)

  if (!isAdmin) {
    const counts = integrationsData?.integrations.reduce<Record<string, number>>((acc, i) => {
      acc[i.status] = (acc[i.status] ?? 0) + 1
      return acc
    }, {}) ?? {}
    return (
      <div className="rounded-lg border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold text-text-primary mb-2 flex items-center gap-2">
          <Plug className="w-4 h-4" /> Integrations
        </h2>
        <div className="text-xs text-text-secondary">
          {counts.connected ?? 0} connected · {counts.degraded ?? 0} degraded · {counts.disconnected ?? 0} disconnected.
          Contact an admin to manage.
        </div>
      </div>
    )
  }

  if (isLoading) {
    return <div className="text-text-muted text-sm">Loading integrations...</div>
  }

  const allRows = integrationsData?.integrations ?? []
  // Only show in "Connected" section if the integration is actively live.
  // Disconnected rows fall through to the Available section so the
  // operator can re-connect with fresh credentials.
  const connected = allRows.filter((i) => i.status !== 'disconnected')
  const connectedTypes = new Set(connected.map((i) => i.type))
  const availableTypes = (typesData?.types ?? []).filter((t) => !connectedTypes.has(t.type as never))

  return (
    <div className="rounded-lg border border-border bg-surface p-5 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2">
          <Plug className="w-4 h-4" /> Integrations
        </h2>
        {typesData && !typesData.encryptionReady && (
          <div className="flex items-center gap-1.5 text-xs text-status-denied">
            <AlertTriangle className="w-3.5 h-3.5" />
            ENCRYPTION_KEY missing — connect blocked
          </div>
        )}
      </div>

      {/* Connected list */}
      {connected.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
            Connected ({connected.length})
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {connected.map((i) => (
              <ConnectedCard key={i.id} integration={i} />
            ))}
          </div>
        </div>
      )}

      {/* Available list */}
      {availableTypes.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
            Available ({availableTypes.length})
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {availableTypes.map((t) => (
              <AvailableCard
                key={t.type}
                type={t.type}
                adapterRegistered={t.adapterRegistered}
                onConnect={() => setConnecting(t.type)}
              />
            ))}
          </div>
        </div>
      )}

      {connecting && (
        <ConnectModal type={connecting} onClose={() => setConnecting(null)} />
      )}
    </div>
  )
}

// ─── Connected card ─────────────────────────────────────

function ConnectedCard({ integration }: { integration: IntegrationRow }) {
  const disconnect = useDisconnectIntegration()
  const [confirming, setConfirming] = useState(false)
  const handleDisconnect = async () => {
    await disconnect.mutateAsync(integration.id)
    setConfirming(false)
  }

  return (
    <div className="rounded-md border border-border-subtle bg-surface-raised p-3">
      <div className="flex items-start justify-between mb-1">
        <div className="flex items-center gap-2 min-w-0">
          <StatusDot status={integration.status} />
          <span className="font-medium text-sm text-text-primary">{TYPE_LABELS[integration.type] ?? integration.type}</span>
        </div>
        <span className="text-[10px] uppercase text-text-muted">{integration.status}</span>
      </div>
      <div className="text-xs text-text-secondary truncate">{integration.displayName}</div>
      {integration.lastError && (
        <div className="text-xs text-status-denied mt-1 truncate" title={integration.lastError}>
          {integration.lastError}
        </div>
      )}
      <div className="flex justify-end gap-2 mt-3">
        {confirming ? (
          <>
            <button
              onClick={() => setConfirming(false)}
              className="text-xs text-text-secondary px-2 py-1 hover:text-text-primary"
            >
              Cancel
            </button>
            <button
              onClick={handleDisconnect}
              disabled={disconnect.isPending}
              className="text-xs text-status-denied px-2 py-1 hover:bg-status-denied/10 rounded"
            >
              {disconnect.isPending ? 'Disconnecting...' : 'Confirm disconnect'}
            </button>
          </>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="text-xs text-text-secondary px-2 py-1 hover:bg-surface-overlay rounded"
          >
            Disconnect
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Available card ─────────────────────────────────────

function AvailableCard({
  type,
  adapterRegistered,
  onConnect,
}: {
  type: string
  adapterRegistered: boolean
  onConnect: () => void
}) {
  return (
    <div className="rounded-md border border-border-subtle bg-surface-raised p-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="w-2 h-2 rounded-full bg-text-muted/40" />
        <span className="font-medium text-sm text-text-primary">{TYPE_LABELS[type] ?? type}</span>
      </div>
      <div className="text-xs text-text-secondary mb-3">{TYPE_DESCRIPTIONS[type] ?? '—'}</div>
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-text-muted">
          {adapterRegistered ? 'Adapter ready' : 'Adapter pending (Phase 3)'}
        </span>
        <button
          onClick={onConnect}
          className="text-xs font-medium text-accent hover:bg-accent/10 px-2 py-1 rounded"
        >
          Connect →
        </button>
      </div>
    </div>
  )
}

function StatusDot({ status }: { status: IntegrationStatus }) {
  if (status === 'connected') return <CheckCircle2 className="w-3.5 h-3.5 text-status-approved" />
  if (status === 'degraded') return <AlertTriangle className="w-3.5 h-3.5 text-status-pending" />
  if (status === 'disconnected') return <XCircle className="w-3.5 h-3.5 text-text-muted" />
  return <RefreshCw className="w-3.5 h-3.5 text-text-muted" />
}

// ─── Connect wizard (3 steps) ───────────────────────────

type WizardStep = 'creds' | 'scopes' | 'webhooks' | 'done'

function ConnectModal({ type, onClose }: { type: string; onClose: () => void }) {
  const [step, setStep] = useState<WizardStep>('creds')
  const [credential, setCredential] = useState('')
  const [webhookSecret, setWebhookSecret] = useState('')
  const [displayName, setDisplayName] = useState(`${TYPE_LABELS[type] ?? type}`)
  // Providers that ship a separate signing secret (distinct from the API
  // credential) and need a second input on the credentials step.
  const needsWebhookSecret = type === 'slack'
  const [testResult, setTestResult] = useState<{ ok: boolean; identity?: string; errorMessage?: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedScopes, setSelectedScopes] = useState<Set<string>>(new Set())
  const [publicBaseUrl, setPublicBaseUrl] = useState(() =>
    window.location.origin.replace(':5173', ':3001'),
  )
  const [webhookResult, setWebhookResult] = useState<{
    registered: number
    failures: { scopeId: string; error: string }[]
  } | null>(null)

  const test = useTestIntegration()
  const connect = useConnectIntegration()
  const scopesQuery = useIntegrationScopes(step === 'scopes' ? type : null)
  const registerWebhook = useRegisterWebhook()

  // ── Step: creds ────────────────────────────────────
  const handleTest = async () => {
    setError(null)
    try {
      const r = await test.mutateAsync({ type, credential })
      setTestResult(r)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test failed')
    }
  }

  const handleSaveCreds = async () => {
    setError(null)
    try {
      await connect.mutateAsync({
        type,
        payload: {
          credential,
          displayName,
          ...(needsWebhookSecret && webhookSecret ? { webhookSecret } : {}),
        },
      })
      setStep('scopes')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connect failed')
    }
  }

  // ── Step: scopes ───────────────────────────────────
  const toggleScope = (id: string) => {
    setSelectedScopes((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // ── Step: webhooks ─────────────────────────────────
  const handleRegisterWebhooks = async () => {
    setError(null)
    try {
      const result = await registerWebhook.mutateAsync({
        type,
        scopeIds: Array.from(selectedScopes),
        publicBaseUrl,
      })
      setWebhookResult({ registered: result.registered, failures: result.failures })
      setStep('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Webhook registration failed')
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="w-full max-w-xl rounded-lg border border-border bg-surface shadow-xl">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">
              Connect {TYPE_LABELS[type] ?? type}
            </h3>
            <p className="text-xs text-text-muted mt-0.5">
              Step {step === 'creds' ? 1 : step === 'scopes' ? 2 : step === 'webhooks' ? 3 : 4} of 3
              · {stepLabel(step)}
            </p>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary text-lg">
            ×
          </button>
        </div>

        {/* Step 1: credentials */}
        {step === 'creds' && (
          <>
            <div className="p-4 space-y-3">
              <div>
                <label className="text-xs text-text-muted">Display name</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="mt-1 w-full bg-surface-raised border border-border rounded px-3 py-2 text-sm text-text-primary"
                />
              </div>
              <div>
                <label className="text-xs text-text-muted">
                  {type === 'github' ? 'Personal Access Token (PAT)' : 'Credential / token'}
                </label>
                <input
                  type="password"
                  value={credential}
                  onChange={(e) => setCredential(e.target.value)}
                  placeholder="paste here · encrypted at rest · never logged"
                  className="mt-1 w-full bg-surface-raised border border-border rounded px-3 py-2 text-sm text-text-primary font-mono"
                  autoComplete="off"
                />
                {type === 'github' && (
                  <p className="text-[10px] text-text-muted mt-1">
                    Required scopes: <code>repo</code>, <code>admin:repo_hook</code>.
                  </p>
                )}
                {type === 'slack' && (
                  <p className="text-[10px] text-text-muted mt-1">
                    Bot User OAuth Token from your Slack app (starts with <code>xoxb-</code>).
                  </p>
                )}
              </div>
              {needsWebhookSecret && (
                <div>
                  <label className="text-xs text-text-muted">Signing secret</label>
                  <input
                    type="password"
                    value={webhookSecret}
                    onChange={(e) => setWebhookSecret(e.target.value)}
                    placeholder="signing secret · encrypted at rest"
                    className="mt-1 w-full bg-surface-raised border border-border rounded px-3 py-2 text-sm text-text-primary font-mono"
                    autoComplete="off"
                  />
                  <p className="text-[10px] text-text-muted mt-1">
                    Slack app config → Basic Information → App Credentials → Signing Secret.
                    Used to verify inbound webhook HMAC.
                  </p>
                </div>
              )}
              {testResult && (
                <div
                  className={`text-xs rounded p-2 ${
                    testResult.ok
                      ? 'bg-status-approved/10 text-status-approved'
                      : 'bg-status-denied/10 text-status-denied'
                  }`}
                >
                  {testResult.ok
                    ? `✓ Authenticated as ${testResult.identity ?? 'unknown'}`
                    : `✗ ${testResult.errorMessage ?? 'Connection failed'}`}
                </div>
              )}
              {error && (
                <div className="text-xs text-status-denied bg-status-denied/10 rounded p-2">
                  {error}
                </div>
              )}
            </div>
            <div className="p-4 border-t border-border flex justify-between gap-2">
              <button
                onClick={onClose}
                className="text-xs px-3 py-1.5 text-text-secondary hover:text-text-primary rounded"
              >
                Cancel
              </button>
              <div className="flex gap-2">
                <button
                  onClick={handleTest}
                  disabled={!credential || test.isPending}
                  className="text-xs px-3 py-1.5 rounded bg-surface-raised border border-border-subtle text-text-secondary disabled:opacity-40"
                >
                  {test.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Test'}
                </button>
                <button
                  onClick={handleSaveCreds}
                  disabled={
                    !credential ||
                    !displayName ||
                    connect.isPending ||
                    !testResult?.ok ||
                    (needsWebhookSecret && !webhookSecret)
                  }
                  className="text-xs font-medium px-3 py-1.5 rounded bg-accent text-white disabled:opacity-40"
                >
                  {connect.isPending ? 'Saving...' : 'Save & continue →'}
                </button>
              </div>
            </div>
          </>
        )}

        {/* Step 2: scopes */}
        {step === 'scopes' && (
          <>
            <div className="p-4 space-y-3">
              <p className="text-xs text-text-secondary">
                Select the {type === 'github' ? 'repositories' : 'scopes'} Sentinel should watch.
              </p>
              {scopesQuery.isLoading && (
                <div className="flex items-center gap-2 text-xs text-text-muted">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading scopes...
                </div>
              )}
              {scopesQuery.error && (
                <div className="text-xs text-status-denied bg-status-denied/10 rounded p-2">
                  {(scopesQuery.error as Error).message}
                </div>
              )}
              {scopesQuery.data && (
                <div className="max-h-64 overflow-y-auto border border-border-subtle rounded">
                  {scopesQuery.data.scopes.length === 0 ? (
                    <div className="p-3 text-xs text-text-muted">No scopes available.</div>
                  ) : (
                    scopesQuery.data.scopes.map((s) => (
                      <label
                        key={s.id}
                        className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-surface-raised cursor-pointer border-b border-border-subtle last:border-b-0"
                      >
                        <input
                          type="checkbox"
                          checked={selectedScopes.has(s.id)}
                          onChange={() => toggleScope(s.id)}
                          className="accent-accent"
                        />
                        <span className="text-text-primary truncate">{s.label}</span>
                      </label>
                    ))
                  )}
                </div>
              )}
              <p className="text-[10px] text-text-muted">
                {selectedScopes.size} selected
              </p>
            </div>
            <div className="p-4 border-t border-border flex justify-between gap-2">
              <button
                onClick={() => setStep('creds')}
                className="text-xs px-3 py-1.5 text-text-secondary hover:text-text-primary rounded"
              >
                ← Back
              </button>
              <button
                onClick={() => setStep('webhooks')}
                disabled={selectedScopes.size === 0}
                className="text-xs font-medium px-3 py-1.5 rounded bg-accent text-white disabled:opacity-40"
              >
                Continue →
              </button>
            </div>
          </>
        )}

        {/* Step 3: webhooks */}
        {step === 'webhooks' && (
          <>
            <div className="p-4 space-y-3">
              <p className="text-xs text-text-secondary">
                {type === 'slack'
                  ? 'Slack does not support API-side webhook registration. Paste the delivery URL below into your Slack app config — Sentinel just records the channels you picked.'
                  : 'Sentinel will register a webhook on each selected scope pointing to its public URL.'}
              </p>
              <div>
                <label className="text-xs text-text-muted">Public base URL (Sentinel backend)</label>
                <input
                  type="text"
                  value={publicBaseUrl}
                  onChange={(e) => setPublicBaseUrl(e.target.value)}
                  className="mt-1 w-full bg-surface-raised border border-border rounded px-3 py-2 text-sm text-text-primary font-mono"
                />
                <p className="text-[10px] text-text-muted mt-1">
                  Webhook delivery URL: <code>{publicBaseUrl}/api/webhooks/{type}</code>
                </p>
                {type === 'slack' ? (
                  <p className="text-[10px] text-text-muted">
                    Slack app config → <strong>Event Subscriptions</strong> → enable → paste the
                    delivery URL → subscribe to bot events: <code>app_mention</code>.
                    Slack must be able to reach this URL — local dev needs a tunnel
                    (cloudflared, ngrok).
                  </p>
                ) : (
                  <p className="text-[10px] text-text-muted">
                    Provider must be able to reach this URL. For local dev use a tunnel (ngrok,
                    cloudflared) and paste its HTTPS URL here.
                  </p>
                )}
              </div>
              <div className="text-xs text-text-secondary">
                Will register webhooks on {selectedScopes.size}{' '}
                {selectedScopes.size === 1 ? 'scope' : 'scopes'}:
                <ul className="list-disc pl-5 mt-1 text-text-muted">
                  {Array.from(selectedScopes).slice(0, 5).map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                  {selectedScopes.size > 5 && <li>… and {selectedScopes.size - 5} more</li>}
                </ul>
              </div>
              {error && (
                <div className="text-xs text-status-denied bg-status-denied/10 rounded p-2">
                  {error}
                </div>
              )}
            </div>
            <div className="p-4 border-t border-border flex justify-between gap-2">
              <button
                onClick={() => setStep('scopes')}
                className="text-xs px-3 py-1.5 text-text-secondary hover:text-text-primary rounded"
              >
                ← Back
              </button>
              <button
                onClick={handleRegisterWebhooks}
                disabled={registerWebhook.isPending || !publicBaseUrl}
                className="text-xs font-medium px-3 py-1.5 rounded bg-accent text-white disabled:opacity-40"
              >
                {registerWebhook.isPending ? 'Registering...' : 'Register webhooks'}
              </button>
            </div>
          </>
        )}

        {/* Step 4: done */}
        {step === 'done' && (
          <>
            <div className="p-4 space-y-3">
              <div className="flex items-center gap-2 text-status-approved">
                <CheckCircle2 className="w-5 h-5" />
                <span className="text-sm font-medium">
                  {webhookResult?.registered ?? 0} webhook{webhookResult?.registered === 1 ? '' : 's'} registered
                </span>
              </div>
              {webhookResult && webhookResult.failures.length > 0 && (
                <div className="text-xs">
                  <p className="text-status-pending mb-1">
                    {webhookResult.failures.length} failed:
                  </p>
                  <ul className="list-disc pl-5 text-text-muted space-y-1">
                    {webhookResult.failures.map((f) => (
                      <li key={f.scopeId}>
                        <code>{f.scopeId}</code> — {f.error}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-xs text-text-muted">
                {TYPE_LABELS[type] ?? type} is now connected. Trigger a test event from the provider
                to confirm end-to-end delivery.
              </p>
            </div>
            <div className="p-4 border-t border-border flex justify-end">
              <button
                onClick={onClose}
                className="text-xs font-medium px-3 py-1.5 rounded bg-accent text-white"
              >
                Finish
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function stepLabel(step: WizardStep): string {
  if (step === 'creds') return 'Credentials'
  if (step === 'scopes') return 'Select scopes'
  if (step === 'webhooks') return 'Register webhooks'
  return 'Done'
}
