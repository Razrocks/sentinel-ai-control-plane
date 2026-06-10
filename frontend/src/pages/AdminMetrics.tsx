/**
 * Admin metrics dashboard — D MVP visualization without Grafana.
 *
 * Reads /api/admin/metrics/{health,skills,cost,audit} (admin-only).
 * Auto-refreshes every 30s via React Query.
 *
 * Pure CSS visualization — no chart lib. Tables + inline bars.
 */
import { useState } from 'react'
import { Activity, Cpu, DollarSign, Layers, AlertTriangle, RefreshCw } from 'lucide-react'
import {
  useAdminMetricsHealth,
  useAdminMetricsSkills,
  useAdminMetricsCost,
  useAdminMetricsAudit,
} from '@/hooks/useData'
import { useRole } from '@/lib/roles'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

type Tab = 'health' | 'skills' | 'cost' | 'audit'

const TABS: Array<{ id: Tab; label: string; icon: typeof Activity }> = [
  { id: 'health', label: 'Health', icon: Activity },
  { id: 'skills', label: 'Skills', icon: Cpu },
  { id: 'cost', label: 'Cost', icon: DollarSign },
  { id: 'audit', label: 'Audit', icon: Layers },
]

export default function AdminMetrics() {
  const { role } = useRole()
  const [tab, setTab] = useState<Tab>('health')
  const [days, setDays] = useState<number>(7)

  if (role !== 'admin') {
    return (
      <div className="flex flex-col gap-10">
        <div className="flex flex-col gap-3">
          <h1 className="font-heading text-3xl font-medium tracking-tight text-foreground">
            System Metrics
          </h1>
        </div>
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Admin only</AlertTitle>
          <AlertDescription>
            The metrics dashboard requires the <code>admin</code> role.
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-3">
          <h1 className="font-heading text-3xl font-medium tracking-tight text-foreground">
            System Metrics
          </h1>
          <p className="text-sm text-muted-foreground">
            Live operational view. Refreshes every 30 seconds.
          </p>
        </div>
        {(tab === 'skills' || tab === 'cost' || tab === 'audit') && (
          <Select value={String(days)} onValueChange={(v) => setDays(parseInt(v, 10))}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Range" />
            </SelectTrigger>
            <SelectContent>
              {[1, 7, 14, 30, 90].map((d) => (
                <SelectItem key={d} value={String(d)}>
                  Last {d} {d === 1 ? 'day' : 'days'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList className="h-11 gap-1 p-1">
          {TABS.map((t) => {
            const Icon = t.icon
            return (
              <TabsTrigger
                key={t.id}
                value={t.id}
                className="h-9 gap-2 px-4 text-sm font-medium flex-none"
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </TabsTrigger>
            )
          })}
        </TabsList>
      </Tabs>

      {tab === 'health' && <HealthTab />}
      {tab === 'skills' && <SkillsTab days={days} />}
      {tab === 'cost' && <CostTab days={days} />}
      {tab === 'audit' && <AuditTab days={days} />}
    </div>
  )
}

// ─── Health tab ─────────────────────────────────────────

function HealthTab() {
  const { data, isLoading, isError, error } = useAdminMetricsHealth()
  if (isLoading) return <Loading />
  if (isError) return <ErrorBox error={error} />
  if (!data) return null

  const totalsList = Object.entries(data.totals)
  const last24h = Object.entries(data.last24h)

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <StatCard label="Uptime" value={`${Math.floor(data.uptime / 60)}m`} sub={`${data.uptime.toFixed(0)}s total`} />
      <StatCard label="Memory" value={`${data.memoryMb} MB`} sub="RSS" />
      <StatCard label="Snapshot" value={new Date(data.timestamp).toLocaleTimeString()} sub="last refresh" />

      <Section title="Totals" className="md:col-span-2">
        <KeyValueTable rows={totalsList.map(([k, v]) => [formatLabel(k), v.toLocaleString()])} />
      </Section>
      <Section title="Last 24h Activity">
        <KeyValueTable rows={last24h.map(([k, v]) => [formatLabel(k), v.toLocaleString()])} />
      </Section>
    </div>
  )
}

// ─── Skills tab ─────────────────────────────────────────

function SkillsTab({ days }: { days: number }) {
  const { data, isLoading, isError, error } = useAdminMetricsSkills(days)
  if (isLoading) return <Loading />
  if (isError) return <ErrorBox error={error} />
  if (!data) return null

  if (data.skills.length === 0) {
    return <Empty msg={`No skill invocations in the last ${days} ${days === 1 ? 'day' : 'days'}.`} />
  }

  const maxCalls = Math.max(...data.skills.map((s) => s.totalCalls))

  return (
    <Section title={`Per-Skill Stats (last ${days} ${days === 1 ? 'day' : 'days'})`}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground uppercase tracking-wider border-b border-border">
            <tr>
              <Th>Skill</Th>
              <Th align="right">Calls</Th>
              <Th align="right">Success%</Th>
              <Th align="right">Cache hit%</Th>
              <Th align="right">p50</Th>
              <Th align="right">p95</Th>
              <Th align="right">Cost</Th>
              <Th align="right">Avg conf</Th>
            </tr>
          </thead>
          <tbody>
            {data.skills.map((s) => {
              const successPct = s.totalCalls === 0 ? 0 : (s.successCount / s.totalCalls) * 100
              return (
                <tr key={s.skill} className="border-b border-border/50 hover:bg-muted/40">
                  <td className="py-2 px-2">
                    <code className="text-foreground">{s.skill}</code>
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums">
                    <Bar value={s.totalCalls} max={maxCalls} />
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums">
                    <span className={successPct === 100 ? 'text-green-400' : successPct >= 90 ? 'text-amber-400' : 'text-red-400'}>
                      {successPct.toFixed(0)}%
                    </span>
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums">{(s.cacheHitRate * 100).toFixed(0)}%</td>
                  <td className="py-2 px-2 text-right tabular-nums">{formatMs(s.latencyMsP50)}</td>
                  <td className="py-2 px-2 text-right tabular-nums">{formatMs(s.latencyMsP95)}</td>
                  <td className="py-2 px-2 text-right tabular-nums">${s.costUsd.toFixed(3)}</td>
                  <td className="py-2 px-2 text-right tabular-nums">
                    {s.avgConfidence !== null ? s.avgConfidence.toFixed(2) : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Section>
  )
}

// ─── Cost tab ───────────────────────────────────────────

function CostTab({ days }: { days: number }) {
  const { data, isLoading, isError, error } = useAdminMetricsCost(days)
  if (isLoading) return <Loading />
  if (isError) return <ErrorBox error={error} />
  if (!data) return null

  const maxActor = data.byActor[0]?.costUsd ?? 0
  const maxModel = data.byModel[0]?.costUsd ?? 0

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard label="Total cost" value={`$${data.totalCostUsd.toFixed(4)}`} sub={`last ${days}d`} />
        <StatCard label="Total calls" value={data.totalCalls.toLocaleString()} />
        <StatCard
          label="Tokens"
          value={`${(data.totalTokensIn / 1000).toFixed(1)}K in`}
          sub={`${(data.totalTokensOut / 1000).toFixed(1)}K out`}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Section title="Cost by actor">
          {data.byActor.length === 0 ? (
            <Empty msg="No actor activity." />
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground uppercase border-b border-border">
                <tr>
                  <Th>Actor</Th>
                  <Th align="right">Calls</Th>
                  <Th align="right">Cost</Th>
                </tr>
              </thead>
              <tbody>
                {data.byActor.map((a) => (
                  <tr key={a.actor} className="border-b border-border/50">
                    <td className="py-2 px-2">{a.actor}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{a.calls}</td>
                    <td className="py-2 px-2 text-right tabular-nums">
                      <Bar value={a.costUsd} max={maxActor} suffix={`$${a.costUsd.toFixed(3)}`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section title="Cost by model">
          {data.byModel.length === 0 ? (
            <Empty msg="No model usage." />
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground uppercase border-b border-border">
                <tr>
                  <Th>Model</Th>
                  <Th align="right">Calls</Th>
                  <Th align="right">Cost</Th>
                </tr>
              </thead>
              <tbody>
                {data.byModel.map((m) => (
                  <tr key={m.model} className="border-b border-border/50">
                    <td className="py-2 px-2">
                      <code className="text-xs text-muted-foreground">{m.model}</code>
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums">{m.calls}</td>
                    <td className="py-2 px-2 text-right tabular-nums">
                      <Bar value={m.costUsd} max={maxModel} suffix={`$${m.costUsd.toFixed(3)}`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      </div>
    </div>
  )
}

// ─── Audit tab ──────────────────────────────────────────

function AuditTab({ days }: { days: number }) {
  const { data, isLoading, isError, error } = useAdminMetricsAudit(days)
  if (isLoading) return <Loading />
  if (isError) return <ErrorBox error={error} />
  if (!data) return null

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="Total events" value={data.totalEvents.toLocaleString()} sub={`last ${days}d`} />
        <StatCard label="Success" value={data.byResult.success ?? 0} colorClass="text-green-400" />
        <StatCard label="Blocked" value={data.byResult.blocked ?? 0} colorClass="text-red-400" />
        <StatCard label="Denied" value={data.byResult.denied ?? 0} colorClass="text-amber-400" />
        <StatCard label="Escalated" value={data.byResult.escalated ?? 0} colorClass="text-blue-400" />
      </div>

      <Section title="By object type">
        <KeyValueTable rows={Object.entries(data.byObjectType).map(([k, v]) => [formatLabel(k), v.toLocaleString()])} />
      </Section>

      <Section title="Top actions">
        {data.topActions.length === 0 ? (
          <Empty msg="No actions recorded." />
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground uppercase border-b border-border">
              <tr>
                <Th>Action</Th>
                <Th align="right">Total</Th>
                <Th align="right">Success</Th>
                <Th align="right">Blocked</Th>
                <Th align="right">Denied</Th>
                <Th align="right">Escalated</Th>
              </tr>
            </thead>
            <tbody>
              {data.topActions.map((a) => (
                <tr key={a.action} className="border-b border-border/50">
                  <td className="py-2 px-2">{a.action}</td>
                  <td className="py-2 px-2 text-right tabular-nums">{a.total}</td>
                  <td className="py-2 px-2 text-right tabular-nums text-green-400">{a.success || ''}</td>
                  <td className="py-2 px-2 text-right tabular-nums text-red-400">{a.blocked || ''}</td>
                  <td className="py-2 px-2 text-right tabular-nums text-amber-400">{a.denied || ''}</td>
                  <td className="py-2 px-2 text-right tabular-nums text-blue-400">{a.escalated || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  )
}

// ─── Reusable bits ──────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  colorClass,
}: {
  label: string
  value: string | number
  sub?: string
  colorClass?: string
}) {
  return (
    <Card>
      <CardContent className="py-5">
        <div className="text-xs text-muted-foreground uppercase tracking-wider">{label}</div>
        <div className={cn('text-3xl font-semibold mt-2 tabular-nums', colorClass ?? 'text-foreground')}>
          {value}
        </div>
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  )
}

function Section({ title, className, children }: { title: string; className?: string; children: React.ReactNode }) {
  return (
    <Card className={className}>
      <CardHeader className="border-b">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="py-4">{children}</CardContent>
    </Card>
  )
}

function Th({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      className={cn(
        'py-2 px-2 font-medium text-xs uppercase tracking-wider text-muted-foreground',
        align === 'right' ? 'text-right' : 'text-left',
      )}
    >
      {children}
    </th>
  )
}

function Bar({ value, max, suffix }: { value: number; max: number; suffix?: string }) {
  const pct = max === 0 ? 0 : Math.min(100, (value / max) * 100)
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="flex-1 max-w-[80px] h-1.5 bg-muted rounded-full overflow-hidden">
        <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <span className="tabular-nums text-foreground">{suffix ?? value.toLocaleString()}</span>
    </div>
  )
}

function KeyValueTable({ rows }: { rows: Array<[string, string | number]> }) {
  return (
    <table className="w-full text-sm">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k} className="border-b border-border/40 last:border-b-0">
            <td className="py-2 px-2 text-muted-foreground">{k}</td>
            <td className="py-2 px-2 text-right tabular-nums text-foreground">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Loading() {
  return (
    <div className="flex items-center gap-2 text-muted-foreground text-sm p-6">
      <RefreshCw className="h-4 w-4 animate-spin" />
      Loading…
    </div>
  )
}

function ErrorBox({ error }: { error: unknown }) {
  const msg = error instanceof Error ? error.message : String(error)
  return (
    <Alert variant="destructive">
      <AlertTriangle />
      <AlertTitle>Failed to load metrics</AlertTitle>
      <AlertDescription>{msg}</AlertDescription>
    </Alert>
  )
}

function Empty({ msg }: { msg: string }) {
  return <div className="text-sm text-muted-foreground py-4">{msg}</div>
}

function formatLabel(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim()
}

function formatMs(ms: number): string {
  if (Number.isNaN(ms)) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}
