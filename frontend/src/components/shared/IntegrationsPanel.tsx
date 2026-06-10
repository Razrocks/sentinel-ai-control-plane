/**
 * IntegrationsPanel — real integration management UI (Phase 4 rebuild).
 *
 * Connected + Available sections as a grid of Cards. Each connect flow
 * opens a multi-step Dialog wizard. Built entirely on shadcn primitives:
 *   - Card / Button / Badge / Input / Label / Checkbox / Dialog / Alert
 *   - Wizard steps tracked via local state, stepper rendered as bullets
 *   - All buttons h-10 (size="default") for readability
 *
 * Admin-only. Non-admin role sees a read-only summary card.
 */
import { useState } from 'react'
import {
  Plug,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  ArrowRight,
  ArrowLeft,
} from 'lucide-react'
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

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
    const counts =
      integrationsData?.integrations.reduce<Record<string, number>>((acc, i) => {
        acc[i.status] = (acc[i.status] ?? 0) + 1
        return acc
      }, {}) ?? {}
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Plug className="h-4 w-4" /> Integrations
          </CardTitle>
          <CardDescription>
            {counts.connected ?? 0} connected · {counts.degraded ?? 0} degraded ·{' '}
            {counts.disconnected ?? 0} disconnected. Contact an admin to manage.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const allRows = integrationsData?.integrations ?? []
  const connected = allRows.filter((i) => i.status !== 'disconnected')
  const connectedTypes = new Set(connected.map((i) => i.type))
  const availableTypes = (typesData?.types ?? []).filter(
    (t) => !connectedTypes.has(t.type as never),
  )

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Plug className="h-4 w-4" /> Integrations
          </CardTitle>
          <CardDescription>
            Connect external systems to Sentinel's workflow. Credentials are encrypted at rest.
          </CardDescription>
        </div>
        {typesData && !typesData.encryptionReady && (
          <Badge variant="danger" className="gap-1">
            <AlertTriangle className="h-3 w-3" />
            ENCRYPTION_KEY missing
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
        )}

        {!isLoading && connected.length > 0 && (
          <div className="space-y-3">
            <SectionLabel count={connected.length}>Connected</SectionLabel>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {connected.map((i) => (
                <ConnectedCard key={i.id} integration={i} />
              ))}
            </div>
          </div>
        )}

        {!isLoading && availableTypes.length > 0 && (
          <div className="space-y-3">
            <SectionLabel count={availableTypes.length}>Available</SectionLabel>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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

        {!isLoading && connected.length === 0 && availableTypes.length === 0 && (
          <div className="text-sm text-muted-foreground text-center py-6">
            No integration types available.
          </div>
        )}
      </CardContent>

      {connecting && (
        <ConnectWizard type={connecting} onClose={() => setConnecting(null)} />
      )}
    </Card>
  )
}

function SectionLabel({ count, children }: { count: number; children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children} <span className="text-muted-foreground/70">({count})</span>
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
    <Card className="bg-secondary/40 border-border">
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <StatusDot status={integration.status} />
            <div className="min-w-0">
              <div className="font-medium text-sm text-foreground">
                {TYPE_LABELS[integration.type] ?? integration.type}
              </div>
              <div className="text-xs text-muted-foreground truncate">
                {integration.displayName}
              </div>
            </div>
          </div>
          <Badge
            variant={
              integration.status === 'connected'
                ? 'success'
                : integration.status === 'degraded'
                  ? 'warning'
                  : 'secondary'
            }
            className="text-[10px]"
          >
            {integration.status}
          </Badge>
        </div>

        {integration.lastError && (
          <div
            className="text-xs text-destructive bg-destructive/10 rounded-md px-2.5 py-1.5 truncate mb-3"
            title={integration.lastError}
          >
            {integration.lastError}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          {confirming ? (
            <>
              <span className="text-xs text-muted-foreground mr-auto">Sure?</span>
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDisconnect}
                disabled={disconnect.isPending}
              >
                {disconnect.isPending ? 'Disconnecting...' : 'Disconnect'}
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
              Disconnect
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
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
    <Card className="border-dashed">
      <CardContent className="p-4">
        <div className="flex items-center gap-2.5 mb-1">
          <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
          <div className="font-medium text-sm text-foreground">
            {TYPE_LABELS[type] ?? type}
          </div>
        </div>
        <div className="text-xs text-muted-foreground mb-4 ml-5">
          {TYPE_DESCRIPTIONS[type] ?? '—'}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">
            {adapterRegistered ? 'Adapter ready' : 'Adapter pending (Phase 3)'}
          </span>
          <Button size="sm" onClick={onConnect} disabled={!adapterRegistered}>
            Connect
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function StatusDot({ status }: { status: IntegrationStatus }) {
  if (status === 'connected')
    return <CheckCircle2 className="h-4 w-4 text-status-approved flex-shrink-0" />
  if (status === 'degraded')
    return <AlertTriangle className="h-4 w-4 text-status-pending flex-shrink-0" />
  return <XCircle className="h-4 w-4 text-muted-foreground flex-shrink-0" />
}

// ─── Connect wizard (Dialog-based) ───────────────────────

type WizardStep = 'creds' | 'scopes' | 'webhooks' | 'done'

const STEP_LABELS: Record<WizardStep, string> = {
  creds: 'Credentials',
  scopes: 'Select scopes',
  webhooks: 'Register webhooks',
  done: 'Done',
}

function ConnectWizard({ type, onClose }: { type: string; onClose: () => void }) {
  const [step, setStep] = useState<WizardStep>('creds')
  const [credential, setCredential] = useState('')
  const [webhookSecret, setWebhookSecret] = useState('')
  const [displayName, setDisplayName] = useState(TYPE_LABELS[type] ?? type)
  const [testResult, setTestResult] = useState<{
    ok: boolean
    identity?: string
    errorMessage?: string
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedScopes, setSelectedScopes] = useState<Set<string>>(new Set())
  const [publicBaseUrl, setPublicBaseUrl] = useState(() =>
    window.location.origin.replace(':5173', ':3001'),
  )
  const [webhookResult, setWebhookResult] = useState<{
    registered: number
    failures: { scopeId: string; error: string }[]
  } | null>(null)

  const needsWebhookSecret = type === 'slack' || type === 'sentry'

  const test = useTestIntegration()
  const connect = useConnectIntegration()
  const scopesQuery = useIntegrationScopes(step === 'scopes' ? type : null)
  const registerWebhook = useRegisterWebhook()

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

  const toggleScope = (id: string) => {
    setSelectedScopes((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

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
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-lg">Connect {TYPE_LABELS[type] ?? type}</DialogTitle>
          <DialogDescription>
            Finish setup in three quick steps.
          </DialogDescription>
          <Stepper current={step} />
        </DialogHeader>
        <Separator className="my-2" />

        {step === 'creds' && (
          <CredsStep
            type={type}
            displayName={displayName}
            setDisplayName={setDisplayName}
            credential={credential}
            setCredential={setCredential}
            needsWebhookSecret={needsWebhookSecret}
            webhookSecret={webhookSecret}
            setWebhookSecret={setWebhookSecret}
            testResult={testResult}
            onTest={handleTest}
            isTesting={test.isPending}
            error={error}
          />
        )}

        {step === 'scopes' && (
          <ScopesStep
            scopesQuery={scopesQuery}
            selectedScopes={selectedScopes}
            toggleScope={toggleScope}
            type={type}
          />
        )}

        {step === 'webhooks' && (
          <WebhooksStep
            type={type}
            publicBaseUrl={publicBaseUrl}
            setPublicBaseUrl={setPublicBaseUrl}
            selectedScopes={selectedScopes}
            error={error}
          />
        )}

        {step === 'done' && webhookResult && <DoneStep type={type} result={webhookResult} />}

        <DialogFooter className="flex sm:justify-between gap-2">
          {step !== 'done' && (
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          )}
          <div className="flex gap-2 ml-auto">
            {step === 'creds' && (
              <>
                <Button
                  variant="outline"
                  onClick={handleTest}
                  disabled={!credential || test.isPending}
                >
                  {test.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Test'}
                </Button>
                <Button
                  onClick={handleSaveCreds}
                  disabled={
                    !credential ||
                    !displayName ||
                    connect.isPending ||
                    !testResult?.ok ||
                    (needsWebhookSecret && !webhookSecret)
                  }
                >
                  {connect.isPending ? 'Saving...' : 'Save & continue'}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </>
            )}

            {step === 'scopes' && (
              <>
                <Button variant="ghost" onClick={() => setStep('creds')}>
                  <ArrowLeft className="h-4 w-4" /> Back
                </Button>
                <Button
                  onClick={() => setStep('webhooks')}
                  disabled={selectedScopes.size === 0}
                >
                  Continue
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </>
            )}

            {step === 'webhooks' && (
              <>
                <Button variant="ghost" onClick={() => setStep('scopes')}>
                  <ArrowLeft className="h-4 w-4" /> Back
                </Button>
                <Button
                  onClick={handleRegisterWebhooks}
                  disabled={registerWebhook.isPending || !publicBaseUrl}
                >
                  {registerWebhook.isPending ? 'Registering...' : 'Register webhooks'}
                </Button>
              </>
            )}

            {step === 'done' && <Button onClick={onClose}>Finish</Button>}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Stepper ─────────────────────────────────────────────

function Stepper({ current }: { current: WizardStep }) {
  const order: WizardStep[] = ['creds', 'scopes', 'webhooks']
  const currentIdx = current === 'done' ? order.length : order.indexOf(current)
  return (
    <div className="mt-3 flex items-center gap-2">
      {order.map((s, idx) => {
        const isDone = idx < currentIdx
        const isCurrent = idx === currentIdx
        return (
          <div key={s} className="flex items-center gap-2 flex-1 last:flex-none">
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ring-2 transition-colors flex-shrink-0',
                  isDone && 'bg-status-approved text-white ring-status-approved/30',
                  isCurrent && 'bg-primary text-primary-foreground ring-primary/30',
                  !isDone && !isCurrent && 'bg-secondary text-muted-foreground ring-border',
                )}
              >
                {isDone ? <CheckCircle2 className="h-3.5 w-3.5" /> : idx + 1}
              </div>
              <span
                className={cn(
                  'text-sm whitespace-nowrap',
                  isCurrent ? 'text-foreground font-semibold' : 'text-muted-foreground',
                )}
              >
                {STEP_LABELS[s]}
              </span>
            </div>
            {idx < order.length - 1 && (
              <div className={cn('h-px flex-1 min-w-[1.5rem]', isDone ? 'bg-status-approved/40' : 'bg-border')} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Step: credentials ──────────────────────────────────

function CredsStep({
  type,
  displayName,
  setDisplayName,
  credential,
  setCredential,
  needsWebhookSecret,
  webhookSecret,
  setWebhookSecret,
  testResult,
  onTest,
  isTesting,
  error,
}: {
  type: string
  displayName: string
  setDisplayName: (v: string) => void
  credential: string
  setCredential: (v: string) => void
  needsWebhookSecret: boolean
  webhookSecret: string
  setWebhookSecret: (v: string) => void
  testResult: { ok: boolean; identity?: string; errorMessage?: string } | null
  onTest: () => void
  isTesting: boolean
  error: string | null
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor="display-name">Display name</Label>
        <Input
          id="display-name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="credential">
          {type === 'github' && 'Personal Access Token (PAT)'}
          {type === 'slack' && 'Bot User OAuth Token'}
          {type === 'linear' && 'API key'}
          {type === 'sentry' && 'Internal Integration Auth Token'}
          {!['github', 'slack', 'linear', 'sentry'].includes(type) && 'Credential / token'}
        </Label>
        <Input
          id="credential"
          type="password"
          value={credential}
          onChange={(e) => setCredential(e.target.value)}
          placeholder="paste here · encrypted at rest · never logged"
          className="font-mono"
          autoComplete="off"
        />
        {type === 'github' && (
          <p className="text-xs text-muted-foreground">
            Required scopes: <code>repo</code>, <code>admin:repo_hook</code>.
          </p>
        )}
        {type === 'slack' && (
          <p className="text-xs text-muted-foreground">
            From your Slack app → OAuth & Permissions (starts with <code>xoxb-</code>).
          </p>
        )}
        {type === 'sentry' && (
          <p className="text-xs text-muted-foreground">
            From your Internal Integration (starts with <code>sntrys_</code>).
          </p>
        )}
        {type === 'linear' && (
          <p className="text-xs text-muted-foreground">
            Personal API key (starts with <code>lin_api_</code>) or OAuth token.
          </p>
        )}
      </div>

      {needsWebhookSecret && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="webhook-secret">
            {type === 'sentry' ? 'Client Secret' : 'Signing secret'}
          </Label>
          <Input
            id="webhook-secret"
            type="password"
            value={webhookSecret}
            onChange={(e) => setWebhookSecret(e.target.value)}
            placeholder="encrypted at rest · never logged"
            className="font-mono"
            autoComplete="off"
          />
          {type === 'slack' && (
            <p className="text-xs text-muted-foreground">
              Slack app config → Basic Information → App Credentials → Signing Secret. Used to verify
              inbound webhook HMAC.
            </p>
          )}
          {type === 'sentry' && (
            <p className="text-xs text-muted-foreground">
              Sentry Internal Integration → Credentials → Client Secret. Used to verify the
              Sentry-Hook-Signature on inbound events.
            </p>
          )}
        </div>
      )}

      {testResult && (
        <Alert variant={testResult.ok ? 'success' : 'destructive'}>
          {testResult.ok ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <XCircle className="h-4 w-4" />
          )}
          <AlertDescription>
            {testResult.ok
              ? `Authenticated as ${testResult.identity ?? 'unknown'}`
              : (testResult.errorMessage ?? 'Connection failed')}
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={onTest} disabled={!credential || isTesting}>
          {isTesting ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Testing...
            </>
          ) : (
            'Test connection'
          )}
        </Button>
      </div>
    </div>
  )
}

// ─── Step: scopes ───────────────────────────────────────

function ScopesStep({
  scopesQuery,
  selectedScopes,
  toggleScope,
  type,
}: {
  scopesQuery: ReturnType<typeof useIntegrationScopes>
  selectedScopes: Set<string>
  toggleScope: (id: string) => void
  type: string
}) {
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">
        Select the {type === 'github' ? 'repositories' : type === 'slack' ? 'channels' : 'scopes'}{' '}
        Sentinel should watch.
      </p>

      {scopesQuery.isLoading && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      )}

      {scopesQuery.error && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertDescription>{(scopesQuery.error as Error).message}</AlertDescription>
        </Alert>
      )}

      {scopesQuery.data && (
        <div className="max-h-72 overflow-y-auto rounded-md border border-border divide-y divide-border bg-secondary/30">
          {scopesQuery.data.scopes.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground text-center">No scopes available.</div>
          ) : (
            scopesQuery.data.scopes.map((s) => (
              <label
                key={s.id}
                className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-secondary/60 transition-colors"
              >
                <Checkbox
                  checked={selectedScopes.has(s.id)}
                  onCheckedChange={() => toggleScope(s.id)}
                />
                <span className="text-sm text-foreground truncate">{s.label}</span>
              </label>
            ))
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {selectedScopes.size} selected
      </p>
    </div>
  )
}

// ─── Step: webhooks ─────────────────────────────────────

function WebhooksStep({
  type,
  publicBaseUrl,
  setPublicBaseUrl,
  selectedScopes,
  error,
}: {
  type: string
  publicBaseUrl: string
  setPublicBaseUrl: (v: string) => void
  selectedScopes: Set<string>
  error: string | null
}) {
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">
        {type === 'slack' &&
          'Slack does not support API-side webhook registration. Paste the delivery URL below into your Slack app config — Sentinel just records the channels you picked.'}
        {type === 'sentry' &&
          "Sentry Internal Integrations are configured manually. Paste the delivery URL into your Sentry integration's Webhook URL field — Sentinel just records the projects you picked."}
        {!['slack', 'sentry'].includes(type) &&
          'Sentinel will register a webhook on each selected scope pointing to its public URL.'}
      </p>

      <div className="flex flex-col gap-2">
        <Label htmlFor="public-url">Public base URL (Sentinel backend)</Label>
        <Input
          id="public-url"
          value={publicBaseUrl}
          onChange={(e) => setPublicBaseUrl(e.target.value)}
          className="font-mono text-xs"
        />
        <p className="text-xs text-muted-foreground">
          Webhook delivery URL:{' '}
          <code className="text-foreground">
            {publicBaseUrl}/api/webhooks/{type}
          </code>
        </p>
        {type === 'slack' && (
          <p className="text-xs text-muted-foreground">
            Slack app config → <strong>Event Subscriptions</strong> → enable → paste delivery URL →
            subscribe to bot events: <code>app_mention</code>. Tunnel needed for local dev
            (cloudflared, ngrok).
          </p>
        )}
        {type === 'sentry' && (
          <p className="text-xs text-muted-foreground">
            Sentry Internal Integration config → <strong>Webhook URL</strong> → paste delivery URL.
            Enable resource: <code>Issue</code>.
          </p>
        )}
        {!['slack', 'sentry'].includes(type) && (
          <p className="text-xs text-muted-foreground">
            Provider must reach this URL. Local dev needs a tunnel (ngrok, cloudflared).
          </p>
        )}
      </div>

      <Separator />

      <div className="text-sm text-foreground">
        Registering on {selectedScopes.size}{' '}
        {selectedScopes.size === 1 ? 'scope' : 'scopes'}:
      </div>
      <ul className="text-xs text-muted-foreground space-y-0.5 list-disc pl-5">
        {Array.from(selectedScopes)
          .slice(0, 5)
          .map((s) => (
            <li key={s}>
              <code className="text-foreground">{s}</code>
            </li>
          ))}
        {selectedScopes.size > 5 && <li>… and {selectedScopes.size - 5} more</li>}
      </ul>

      {error && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}

// ─── Step: done ─────────────────────────────────────────

function DoneStep({
  type,
  result,
}: {
  type: string
  result: { registered: number; failures: { scopeId: string; error: string }[] }
}) {
  return (
    <div className="flex flex-col gap-5">
      <Alert variant="success">
        <CheckCircle2 className="h-4 w-4" />
        <AlertTitle>
          {result.registered} webhook{result.registered === 1 ? '' : 's'} registered
        </AlertTitle>
        <AlertDescription>
          {TYPE_LABELS[type] ?? type} is now connected. Trigger a test event from the provider to
          confirm end-to-end delivery.
        </AlertDescription>
      </Alert>

      {result.failures.length > 0 && (
        <Alert variant="warning">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{result.failures.length} failed</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              {result.failures.map((f) => (
                <li key={f.scopeId} className="text-xs">
                  <code className="text-foreground">{f.scopeId}</code> — {f.error}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}
