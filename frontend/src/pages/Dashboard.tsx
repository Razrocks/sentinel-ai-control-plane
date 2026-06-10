import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  GitPullRequest,
  KeyRound,
  ShieldAlert,
  CheckCircle2,
  Clock,
  ArrowRight,
  Wrench,
  ScrollText,
  Ban,
  Compass,
  ArrowUpRight,
  Play,
  Code,
  CheckCircle,
  XCircle,
  FlaskConical,
  BookOpen,
  Shield,
  Activity,
  Server,
  Lock,
} from 'lucide-react'
import { useChanges, useIncidents, useAccessRequests, useApprovals, usePolicies, useAuditEvents } from '@/hooks/useData'
import { RiskBadge, ApprovalBadge, PolicyBadge } from '@/components/shared'
import { timeAgo } from '@/lib/utils'
import { useRole } from '@/lib/roles'
import { Card, CardContent } from '@/components/ui/card'

function StatCard({ label, value, icon: Icon, color, to }: { label: string; value: number; icon: React.ElementType; color: string; to?: string }) {
  const content = (
    <Card className="h-full transition-colors hover:border-primary/40">
      <CardContent className="flex items-center gap-4 py-5">
        <div className={`flex h-11 w-11 items-center justify-center rounded-md ${color}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex flex-col gap-1 min-w-0">
          <div className="text-3xl font-semibold text-foreground leading-none tracking-tight tabular-nums">{value}</div>
          <div className="text-sm text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  )
  return to ? <Link to={to} className="block">{content}</Link> : content
}

// Compute next step hint for a change
function changeNextStep(change: typeof mockChanges[0]): { label: string; color: string } {
  if (change.policyDecision === 'deny') return { label: 'Blocked', color: 'border-l-risk-critical' }
  if (change.policyDecision === 'escalate') return { label: 'Escalation needed', color: 'border-l-status-escalated' }
  if (change.approvalState === 'pending') return { label: 'Awaiting approval', color: 'border-l-status-pending' }
  if (change.status === 'approved') return { label: 'Ready to execute', color: 'border-l-status-approved' }
  return { label: 'In review', color: 'border-l-accent' }
}

function incidentNextStep(incident: typeof mockIncidents[0]): { label: string; color: string } {
  if (incident.severity === 'sev1') return { label: 'Urgent triage', color: 'border-l-risk-critical' }
  if (incident.severity === 'sev2') return { label: 'Needs attention', color: 'border-l-risk-high' }
  if (incident.isRecurring) return { label: 'Known fix available', color: 'border-l-status-approved' }
  return { label: 'Triage needed', color: 'border-l-status-pending' }
}

// Engineer-specific: next step from engineering perspective
function engineerChangeHint(change: typeof mockChanges[0]): { label: string; color: string } {
  if (change.ciStatus === 'failing') return { label: 'CI failing', color: 'border-l-risk-critical' }
  if (change.policyDecision === 'deny') return { label: 'Policy blocked', color: 'border-l-risk-critical' }
  if (change.policyDecision === 'escalate') return { label: 'Needs escalation', color: 'border-l-status-escalated' }
  if (change.linkedPRs.length === 0) return { label: 'No PR linked', color: 'border-l-status-pending' }
  if (change.approvalState === 'pending') return { label: 'Awaiting review', color: 'border-l-status-pending' }
  if (change.status === 'approved') return { label: 'Ready to simulate', color: 'border-l-status-approved' }
  return { label: 'In progress', color: 'border-l-accent' }
}

function engineerIncidentHint(incident: typeof mockIncidents[0]): { label: string; color: string } {
  if (incident.isRecurring) return { label: 'KB fix available', color: 'border-l-status-approved' }
  if (incident.severity === 'sev1' || incident.severity === 'sev2') return { label: 'Needs technical fix', color: 'border-l-risk-high' }
  return { label: 'Investigation needed', color: 'border-l-accent' }
}

// Mock CI/PR data for engineer dashboard
const mockCIEvents = [
  { id: 'ci-1', changeId: 'chg-001', ticketId: 'CHG-2024-0847', title: 'Rate-limiter v2 rollout', status: 'passing' as const, branch: 'feat/rate-limiter-v2', prState: 'open' as const, updatedAt: '2026-03-15T06:30:00Z' },
  { id: 'ci-2', changeId: 'chg-002', ticketId: 'CHG-2024-0851', title: 'Schema migration: NOT NULL on orders.customer_id', status: 'failing' as const, branch: 'db/orders-notnull', prState: 'draft' as const, updatedAt: '2026-03-15T05:15:00Z' },
  { id: 'ci-3', changeId: 'chg-003', ticketId: 'CHG-2024-0852', title: 'Enable dead-letter queue', status: 'passing' as const, branch: 'feat/dlq-notifications', prState: 'open' as const, updatedAt: '2026-03-14T18:00:00Z' },
  { id: 'ci-4', changeId: 'chg-004', ticketId: 'CHG-2024-0849', title: 'Logging middleware update', status: 'pending' as const, branch: 'chore/logging-update', prState: 'merged' as const, updatedAt: '2026-03-14T14:00:00Z' },
]

export default function Dashboard() {
  const { role, config, canAccess } = useRole()
  const { data: mockChanges = [] } = useChanges()
  const { data: mockIncidents = [] } = useIncidents()
  const { data: mockAccessRequests = [] } = useAccessRequests()
  const { data: mockApprovals = [] } = useApprovals()
  const { data: mockPolicyRules = [] } = usePolicies()
  const { data: mockAuditEvents = [] } = useAuditEvents()

  const highRiskChanges = mockChanges.filter(c => c.riskLevel === 'high' || c.riskLevel === 'critical')
  const blockedChanges = mockChanges.filter(c => c.policyDecision === 'deny' || c.policyDecision === 'escalate')
  const pendingApprovals = mockApprovals.filter(a => a.status === 'pending')
  const activeIncidents = mockIncidents.filter(i => i.status !== 'resolved')
  const sevIncidents = activeIncidents.filter(i => i.severity === 'sev1' || i.severity === 'sev2')
  const pendingAccess = mockAccessRequests.filter(a => a.status === 'pending')

  const roleGreetings: Record<string, { title: string; subtitle: string }> = {
    operator: { title: 'Operational Overview', subtitle: 'Triage queue — changes, incidents, and requests needing action' },
    approver: { title: 'Approval Queue', subtitle: 'Pending decisions across changes, access, and escalations' },
    engineer: { title: 'Engineering Dashboard', subtitle: 'Your changes, CI status, simulations, and technical actions' },
    it_support: { title: 'Support Dashboard', subtitle: 'Open incidents, access requests, and remediation queue' },
    access_approver: { title: 'Access Approvals', subtitle: 'System owner — access requests and entitlement decisions' },
    admin: { title: 'Admin Overview', subtitle: 'Full operational state across all lanes' },
  }

  const greeting = roleGreetings[role] || roleGreetings.admin

  // ──────────────────────────────────────────────────────────
  // ENGINEER DASHBOARD
  // ──────────────────────────────────────────────────────────
  if (role === 'engineer') {
    const myChanges = mockChanges.filter(c => c.status !== 'deployed')
    const simulationReady = mockChanges.filter(c => c.status === 'approved' || (c.approvalState !== 'denied' && c.ciStatus === 'passing'))
    const techIncidents = activeIncidents.filter(i => i.isRecurring || i.severity === 'sev1' || i.severity === 'sev2')
    const failingCI = mockCIEvents.filter(e => e.status === 'failing')

    return (
      <div className="flex flex-col gap-12">
        <div>
          <h1 className="font-heading text-3xl font-medium tracking-tight text-foreground">{greeting.title}</h1>
          <p className="text-foreground/80 mt-1">{greeting.subtitle}</p>
          <div className="mt-1 text-xs text-muted-foreground">Viewing as: <span className="text-primary font-medium">{config.label}</span></div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="My Changes" value={myChanges.length} icon={GitPullRequest} color="bg-primary/10 text-primary" to="/changes" />
          <StatCard label="CI Failing" value={failingCI.length} icon={XCircle} color="bg-risk-critical/10 text-risk-critical" />
          <StatCard label="Simulation Ready" value={simulationReady.length} icon={FlaskConical} color="bg-status-approved/10 text-status-approved" />
          <StatCard label="Tech Incidents" value={techIncidents.length} icon={Wrench} color="bg-risk-high/10 text-risk-high" to="/incidents" />
        </div>

        {/* Blocked by Policy — engineers can help resolve these */}
        {blockedChanges.length > 0 && (
          <div className="rounded-xl border border-risk-critical/40 bg-card text-card-foreground shadow-sm overflow-hidden ring-2 ring-risk-critical/15">
            <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                <Ban className="w-4 h-4 text-risk-critical" />
                Blocked by Policy — Needs Technical Action
              </h2>
              <span className="text-xs font-medium text-risk-critical">{blockedChanges.length} blocked</span>
            </div>
            <div className="divide-y divide-border/60">
              {blockedChanges.map(change => (
                <Link key={change.id} to={`/changes/${change.id}`} className="flex items-center justify-between px-5 py-3.5 hover:bg-muted transition-colors border-l-2 border-l-risk-critical">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <PolicyBadge decision={change.policyDecision} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-foreground truncate">{change.title}</div>
                      <div className="text-xs text-muted-foreground">{change.ticketId} · {change.service}</div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {change.ciStatus === 'failing' && <span className="inline-flex items-center rounded-md bg-risk-critical/15 px-2 py-1 text-xs font-medium text-risk-critical">CI failing</span>}
                      <span className="inline-flex items-center rounded-md bg-risk-critical/15 px-2.5 py-1.5 text-xs font-medium text-risk-critical">
                        {change.policyDecision === 'deny' ? 'Hard block' : 'Needs escalation'}
                      </span>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0 ml-3" />
                </Link>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* My Changes */}
          <div className="rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                <GitPullRequest className="w-4 h-4 text-primary" />
                My Changes
              </h2>
              <Link to="/changes" className="text-xs font-medium text-primary hover:underline">View all</Link>
            </div>
            <div className="divide-y divide-border/60">
              {myChanges.slice(0, 5).map(change => {
                const hint = engineerChangeHint(change)
                return (
                  <Link key={change.id} to={`/changes/${change.id}`} className={`flex items-center justify-between px-5 py-3.5 hover:bg-muted transition-colors border-l-2 ${hint.color}`}>
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <RiskBadge level={change.riskLevel} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-foreground truncate">{change.title}</div>
                        <div className="text-xs text-muted-foreground flex items-center gap-2">
                          <span>{change.ticketId}</span>
                          <span>·</span>
                          <span>{change.service}</span>
                          {change.ciStatus === 'passing' && <CheckCircle className="w-3 h-3 text-status-approved" />}
                          {change.ciStatus === 'failing' && <XCircle className="w-3 h-3 text-risk-critical" />}
                          {change.ciStatus === 'pending' && <Clock className="w-3 h-3 text-status-pending" />}
                        </div>
                      </div>
                      <span className="inline-flex flex-shrink-0 items-center rounded-md bg-muted px-2.5 py-1.5 text-xs font-medium text-foreground/80">{hint.label}</span>
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>

          {/* Simulation Candidates */}
          <div className="rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                <FlaskConical className="w-4 h-4 text-status-approved" />
                Simulation Ready
              </h2>
            </div>
            <div className="divide-y divide-border/60">
              {simulationReady.length > 0 ? simulationReady.slice(0, 4).map(change => (
                <Link key={change.id} to={`/changes/${change.id}`} className="flex items-center justify-between px-5 py-3.5 hover:bg-muted transition-colors border-l-2 border-l-status-approved">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <Play className="w-4 h-4 text-status-approved flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-foreground truncate">{change.title}</div>
                      <div className="text-xs text-muted-foreground">{change.ticketId} · {change.blastRadius.length} systems affected</div>
                    </div>
                    <span className="inline-flex flex-shrink-0 items-center rounded-md bg-status-approved/15 px-2.5 py-1.5 text-xs font-medium text-status-approved">Run simulation</span>
                  </div>
                </Link>
              )) : (
                <div className="px-4 py-6 text-center text-sm text-muted-foreground">No changes ready for simulation</div>
              )}
            </div>
          </div>

          {/* Incidents with Technical Remediation */}
          <div className="rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                <Wrench className="w-4 h-4 text-risk-high" />
                Incidents — Technical Remediation
              </h2>
              <Link to="/incidents" className="text-xs font-medium text-primary hover:underline">View all</Link>
            </div>
            <div className="divide-y divide-border/60">
              {techIncidents.length > 0 ? techIncidents.slice(0, 4).map(incident => {
                const hint = engineerIncidentHint(incident)
                return (
                  <Link key={incident.id} to={`/incidents/${incident.id}`} className={`flex items-center justify-between px-5 py-3.5 hover:bg-muted transition-colors border-l-2 ${hint.color}`}>
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <RiskBadge level={incident.severity === 'sev1' ? 'critical' : incident.severity === 'sev2' ? 'high' : 'medium'} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-foreground truncate">{incident.title}</div>
                        <div className="text-xs text-muted-foreground flex items-center gap-2">
                          <span>{incident.incidentId}</span>
                          <span>·</span>
                          <span>{incident.affectedService}</span>
                          {incident.isRecurring && <BookOpen className="w-3 h-3 text-status-approved" />}
                        </div>
                      </div>
                      <span className="inline-flex flex-shrink-0 items-center rounded-md bg-muted px-2.5 py-1.5 text-xs font-medium text-foreground/80">{hint.label}</span>
                    </div>
                  </Link>
                )
              }) : (
                <div className="px-4 py-6 text-center text-sm text-muted-foreground">No incidents needing technical action</div>
              )}
            </div>
          </div>

          {/* CI / PR Movement */}
          <div className="rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                <Code className="w-4 h-4 text-primary" />
                Recent CI / PR Activity
              </h2>
            </div>
            <div className="divide-y divide-border/60">
              {mockCIEvents.map(event => (
                <Link key={event.id} to={`/changes/${event.changeId}`} className="flex items-center justify-between px-5 py-3.5 hover:bg-muted transition-colors">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    {event.status === 'passing' && <CheckCircle className="w-4 h-4 text-status-approved flex-shrink-0" />}
                    {event.status === 'failing' && <XCircle className="w-4 h-4 text-risk-critical flex-shrink-0" />}
                    {event.status === 'pending' && <Clock className="w-4 h-4 text-status-pending flex-shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-foreground truncate">{event.title}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-2">
                        <span className="font-mono">{event.branch}</span>
                        <span>·</span>
                        <span className={
                          event.prState === 'merged' ? 'text-status-approved' :
                          event.prState === 'draft' ? 'text-muted-foreground' :
                          'text-primary'
                        }>
                          PR {event.prState}
                        </span>
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground flex-shrink-0">{timeAgo(event.updatedAt)}</span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ──────────────────────────────────────────────────────────
  // IT SUPPORT DASHBOARD
  // ──────────────────────────────────────────────────────────
  if (role === 'it_support') {
    const needsTriage = activeIncidents.filter(i => i.status === 'new' || i.status === 'investigating')
    const knownFixes = activeIncidents.filter(i => i.isRecurring || i.recommendedFix?.toLowerCase().includes('config'))
    const recurringIncidents = activeIncidents.filter(i => i.isRecurring)
    const accessNeedingRouting = mockAccessRequests.filter(a => a.status === 'pending')
    const supportApprovals = pendingApprovals.filter(a => a.type === 'remediation' || a.type === 'escalation')

    return (
      <div className="flex flex-col gap-12">
        <div>
          <h1 className="font-heading text-3xl font-medium tracking-tight text-foreground">{greeting.title}</h1>
          <p className="text-foreground/80 mt-1">{greeting.subtitle}</p>
          <div className="mt-1 text-xs text-muted-foreground">Viewing as: <span className="text-primary font-medium">{config.label}</span></div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Needs Triage" value={needsTriage.length} icon={AlertTriangle} color="bg-risk-high/10 text-risk-high" to="/incidents" />
          <StatCard label="Known Fixes" value={knownFixes.length} icon={BookOpen} color="bg-status-approved/10 text-status-approved" to="/incidents" />
          <StatCard label="Access Routing" value={accessNeedingRouting.length} icon={KeyRound} color="bg-status-draft/10 text-status-draft" to="/access-requests" />
          <StatCard label="Awaiting Approval" value={supportApprovals.length} icon={Clock} color="bg-status-pending/10 text-status-pending" to="/approvals" />
        </div>

        {/* Needs Triage — full width urgent section */}
        {needsTriage.length > 0 && (
          <div className="rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between">
              <h2 className="text-base font-semibold text-risk-high flex items-center gap-2">
                <ShieldAlert className="w-4 h-4" />
                Needs Triage — {needsTriage.length} incidents
              </h2>
              <Link to="/incidents" className="text-xs font-medium text-primary hover:underline">View all</Link>
            </div>
            <div className="divide-y divide-border/60">
              {needsTriage.map(incident => {
                const isKnown = incident.isRecurring || incident.recommendedFix?.toLowerCase().includes('config')
                return (
                  <Link key={incident.id} to={`/incidents/${incident.id}`} className={`flex items-center justify-between px-5 py-3.5 hover:bg-muted transition-colors border-l-2 ${
                    incident.severity === 'sev1' ? 'border-l-risk-critical' : incident.severity === 'sev2' ? 'border-l-risk-high' : 'border-l-status-pending'
                  }`}>
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <RiskBadge level={incident.severity === 'sev1' ? 'critical' : incident.severity === 'sev2' ? 'high' : 'medium'} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-foreground truncate">{incident.title}</div>
                        <div className="text-xs text-muted-foreground">{incident.incidentId} · {incident.affectedService}</div>
                      </div>
                      {isKnown && <span className="text-xs font-medium px-1.5 py-1 rounded bg-status-approved/10 text-status-approved flex-shrink-0">KB fix available</span>}
                      {!isKnown && <span className="text-xs font-medium px-1.5 py-1 rounded bg-status-pending/10 text-status-pending flex-shrink-0">Triage needed</span>}
                    </div>
                    <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0 ml-3" />
                  </Link>
                )
              })}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Known Fixes Available */}
          <div className="rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-status-approved" />
                Known Fixes Available
              </h2>
            </div>
            <div className="divide-y divide-border/60">
              {knownFixes.length > 0 ? knownFixes.slice(0, 4).map(incident => (
                <Link key={incident.id} to={`/incidents/${incident.id}`} className="flex items-center justify-between px-5 py-3.5 hover:bg-muted transition-colors border-l-2 border-l-status-approved">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <Wrench className="w-4 h-4 text-status-approved flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-foreground truncate">{incident.title}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-2">
                        <span>{incident.incidentId}</span>
                        <span>·</span>
                        <span>{incident.affectedService}</span>
                        {incident.isRecurring && <span className="text-status-pending">recurring</span>}
                      </div>
                    </div>
                    <span className="inline-flex flex-shrink-0 items-center rounded-md bg-status-approved/15 px-2.5 py-1.5 text-xs font-medium text-status-approved">
                      {incident.recommendedFix?.toLowerCase().includes('config') ? 'Config fix' : 'KB fix'}
                    </span>
                  </div>
                </Link>
              )) : (
                <div className="px-4 py-6 text-center text-sm text-muted-foreground">No known fixes available</div>
              )}
            </div>
          </div>

          {/* Recurring Issues */}
          <div className="rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                <ScrollText className="w-4 h-4 text-status-pending" />
                Recurring Issues
              </h2>
            </div>
            <div className="divide-y divide-border/60">
              {recurringIncidents.length > 0 ? recurringIncidents.slice(0, 4).map(incident => (
                <Link key={incident.id} to={`/incidents/${incident.id}`} className="flex items-center justify-between px-5 py-3.5 hover:bg-muted transition-colors border-l-2 border-l-status-pending">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <RiskBadge level={incident.severity === 'sev1' ? 'critical' : incident.severity === 'sev2' ? 'high' : 'medium'} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-foreground truncate">{incident.title}</div>
                      <div className="text-xs text-muted-foreground">{incident.incidentId} · {incident.rootCauseCategory}</div>
                    </div>
                    <span className="inline-flex flex-shrink-0 items-center rounded-md bg-muted px-2.5 py-1.5 text-xs font-medium text-foreground/80">Pattern detected</span>
                  </div>
                </Link>
              )) : (
                <div className="px-4 py-6 text-center text-sm text-muted-foreground">No recurring issues</div>
              )}
            </div>
          </div>

          {/* Access Requests Needing Routing */}
          <div className="rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-status-draft" />
                Access Requests — Route or Follow Up
              </h2>
              <Link to="/access-requests" className="text-xs font-medium text-primary hover:underline">View all</Link>
            </div>
            <div className="divide-y divide-border/60">
              {accessNeedingRouting.length > 0 ? accessNeedingRouting.slice(0, 4).map(req => {
                const blocker = req.managerApproval === 'pending' ? 'Waiting on manager'
                  : req.ownerApproval === 'pending' ? 'Waiting on owner'
                  : req.entitlementCheck === 'ineligible' ? 'Denied by policy'
                  : 'Support can route'
                return (
                  <Link key={req.id} to={`/access-requests/${req.id}`} className="flex items-center justify-between px-5 py-3.5 hover:bg-muted transition-colors border-l-2 border-l-status-pending">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <RiskBadge level={req.riskLevel} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-foreground truncate">{req.requester} → {req.requestedSystem}</div>
                        <div className="text-xs text-muted-foreground">{req.requestId} · {req.requestedRole}</div>
                      </div>
                      <span className="inline-flex flex-shrink-0 items-center rounded-md bg-muted px-2.5 py-1.5 text-xs font-medium text-foreground/80">{blocker}</span>
                    </div>
                  </Link>
                )
              }) : (
                <div className="px-4 py-6 text-center text-sm text-muted-foreground">No pending requests</div>
              )}
            </div>
          </div>

          {/* Awaiting Approval */}
          <div className="rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                <Clock className="w-4 h-4 text-status-pending" />
                Awaiting Approval
              </h2>
              <Link to="/approvals" className="text-xs font-medium text-primary hover:underline">View all</Link>
            </div>
            <div className="divide-y divide-border/60">
              {pendingApprovals.slice(0, 4).map(approval => (
                <Link key={approval.id} to="/approvals" className="flex items-center justify-between px-5 py-3.5 hover:bg-muted transition-colors">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-foreground truncate">{approval.title}</div>
                      <div className="text-xs text-muted-foreground">{approval.requester} · {approval.type}</div>
                    </div>
                    <span className="inline-flex flex-shrink-0 items-center rounded-md bg-muted px-2.5 py-1.5 text-xs font-medium text-foreground/80">Awaiting approver</span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ──────────────────────────────────────────────────────────
  // APPROVER DASHBOARD
  // ──────────────────────────────────────────────────────────
  if (role === 'approver' || role === 'access_approver') {
    const awaitingMyDecision = pendingApprovals // All pending = "yours" in the mock
    const highRiskDecisions = awaitingMyDecision.filter(a => a.riskLevel === 'critical' || a.riskLevel === 'high')
    const waitingOnOther = pendingApprovals.filter(a => a.coApprovals?.some(co => co.status === 'pending' && co.name !== 'you'))
    const recentlyDecided = mockApprovals.filter(a => a.status !== 'pending')

    // For access_approver, also show access requests needing owner sign-off
    const accessAwaitingOwner = role === 'access_approver'
      ? mockAccessRequests.filter(a => a.ownerApprovalRequired && a.ownerApproval === 'pending')
      : []

    return (
      <div className="flex flex-col gap-12">
        <div>
          <h1 className="font-heading text-3xl font-medium tracking-tight text-foreground">{greeting.title}</h1>
          <p className="text-foreground/80 mt-1">{greeting.subtitle}</p>
          <div className="mt-1 text-xs text-muted-foreground">Viewing as: <span className="text-primary font-medium">{config.label}</span></div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Awaiting My Decision" value={awaitingMyDecision.length} icon={CheckCircle2} color="bg-primary/10 text-primary" to="/approvals" />
          <StatCard label="High-Risk Decisions" value={highRiskDecisions.length} icon={ShieldAlert} color="bg-risk-high/10 text-risk-high" to="/approvals" />
          <StatCard label="Waiting on Others" value={waitingOnOther.length} icon={Clock} color="bg-status-pending/10 text-status-pending" />
          <StatCard label="Recently Decided" value={recentlyDecided.length} icon={ScrollText} color="bg-muted text-muted-foreground" />
        </div>

        {/* High-risk decisions needing attention */}
        {highRiskDecisions.length > 0 && (
          <div className="bg-card rounded-lg border border-risk-high/20">
            <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between">
              <h2 className="text-base font-semibold text-risk-high flex items-center gap-2">
                <ShieldAlert className="w-4 h-4" />
                High-Risk — Awaiting Your Decision
              </h2>
              <span className="text-xs text-risk-high">{highRiskDecisions.length} pending</span>
            </div>
            <div className="divide-y divide-border/60">
              {highRiskDecisions.map(approval => (
                <Link key={approval.id} to="/approvals" className={`flex items-center justify-between px-5 py-3.5 hover:bg-muted transition-colors border-l-2 ${
                  approval.riskLevel === 'critical' ? 'border-l-risk-critical' : 'border-l-risk-high'
                }`}>
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <RiskBadge level={approval.riskLevel} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-foreground truncate">{approval.title}</div>
                      <div className="text-xs text-muted-foreground">{approval.requester} · {approval.type} · {approval.impactedSystem}</div>
                    </div>
                    {approval.coApprovals && approval.coApprovals.length > 1 && (
                      <span className="text-xs font-medium px-1.5 py-1 rounded bg-muted text-muted-foreground flex-shrink-0">
                        {approval.coApprovals.filter(c => c.status === 'approved').length}/{approval.coApprovals.length} approved
                      </span>
                    )}
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0 ml-3" />
                </Link>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Awaiting My Decision */}
          <div className="rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-primary" />
                Awaiting My Decision
              </h2>
              <Link to="/approvals" className="text-xs font-medium text-primary hover:underline">View all</Link>
            </div>
            <div className="divide-y divide-border/60">
              {awaitingMyDecision.slice(0, 5).map(approval => (
                <Link key={approval.id} to="/approvals" className="flex items-center justify-between px-5 py-3.5 hover:bg-muted transition-colors border-l-2 border-l-accent">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <RiskBadge level={approval.riskLevel} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-foreground truncate">{approval.title}</div>
                      <div className="text-xs text-muted-foreground">{approval.requester} · {approval.type}</div>
                    </div>
                    <span className="text-xs text-muted-foreground flex-shrink-0">{timeAgo(approval.createdAt)}</span>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* Waiting on Another Approver */}
          <div className="rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                <Clock className="w-4 h-4 text-status-pending" />
                Waiting on Another Approver
              </h2>
            </div>
            <div className="divide-y divide-border/60">
              {waitingOnOther.length > 0 ? waitingOnOther.slice(0, 4).map(approval => {
                const pendingCo = approval.coApprovals?.find(c => c.status === 'pending' && c.name !== 'you')
                return (
                  <Link key={approval.id} to="/approvals" className="flex items-center justify-between px-5 py-3.5 hover:bg-muted transition-colors border-l-2 border-l-status-pending">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <RiskBadge level={approval.riskLevel} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-foreground truncate">{approval.title}</div>
                        <div className="text-xs text-muted-foreground">
                          Waiting on {pendingCo?.name || 'co-approver'} ({pendingCo?.role})
                        </div>
                      </div>
                    </div>
                  </Link>
                )
              }) : (
                <div className="px-4 py-6 text-center text-sm text-muted-foreground">No items waiting on others</div>
              )}
            </div>
          </div>

          {/* Recent Changes needing review */}
          <div className="rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                <GitPullRequest className="w-4 h-4 text-primary" />
                Changes in Review
              </h2>
              <Link to="/changes" className="text-xs font-medium text-primary hover:underline">View all</Link>
            </div>
            <div className="divide-y divide-border/60">
              {highRiskChanges.slice(0, 4).map(change => {
                const hint = changeNextStep(change)
                return (
                  <Link key={change.id} to={`/changes/${change.id}`} className={`flex items-center justify-between px-5 py-3.5 hover:bg-muted transition-colors border-l-2 ${hint.color}`}>
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <RiskBadge level={change.riskLevel} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-foreground truncate">{change.title}</div>
                        <div className="text-xs text-muted-foreground">{change.ticketId} · {change.service}</div>
                      </div>
                      <span className="inline-flex flex-shrink-0 items-center rounded-md bg-muted px-2.5 py-1.5 text-xs font-medium text-foreground/80">{hint.label}</span>
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>

          {/* Recently Decided */}
          <div className="rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                <ScrollText className="w-4 h-4 text-muted-foreground" />
                Recently Decided
              </h2>
            </div>
            <div className="divide-y divide-border/60">
              {recentlyDecided.length > 0 ? recentlyDecided.slice(0, 4).map(approval => (
                <div key={approval.id} className="flex items-center justify-between px-4 py-3 opacity-60">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    {approval.status === 'approved' ? (
                      <CheckCircle className="w-4 h-4 text-status-approved flex-shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 text-status-denied flex-shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-foreground truncate">{approval.title}</div>
                      <div className="text-xs text-muted-foreground">{approval.requester} · {approval.type}</div>
                    </div>
                    <span className={`text-xs font-medium px-1.5 py-1 rounded ${
                      approval.status === 'approved' ? 'bg-status-approved/10 text-status-approved' : 'bg-status-denied/10 text-status-denied'
                    }`}>
                      {approval.status === 'approved' ? 'Approved' : 'Denied'}
                    </span>
                  </div>
                </div>
              )) : (
                <div className="px-4 py-6 text-center text-sm text-muted-foreground">No recent decisions</div>
              )}
            </div>
          </div>

          {/* Access Requests — for access_approver only */}
          {role === 'access_approver' && accessAwaitingOwner.length > 0 && (
            <div className="bg-card rounded-lg border border-border col-span-2">
              <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between">
                <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-status-draft" />
                  Access Requests — Owner Sign-off Needed
                </h2>
                <Link to="/access-requests" className="text-xs font-medium text-primary hover:underline">View all</Link>
              </div>
              <div className="divide-y divide-border/60">
                {accessAwaitingOwner.slice(0, 4).map(req => (
                  <Link key={req.id} to={`/access-requests/${req.id}`} className="flex items-center justify-between px-5 py-3.5 hover:bg-muted transition-colors border-l-2 border-l-status-pending">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <RiskBadge level={req.riskLevel} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-foreground truncate">{req.requester} → {req.requestedSystem}</div>
                        <div className="text-xs text-muted-foreground">{req.requestId} · {req.requestedRole}</div>
                      </div>
                      <span className="inline-flex flex-shrink-0 items-center rounded-md bg-muted px-2.5 py-1.5 text-xs font-medium text-foreground/80">
                        {req.managerApproval === 'approved' ? 'Manager approved' : 'Awaiting manager'}
                      </span>
                    </div>
                    <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0 ml-3" />
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ──────────────────────────────────────────────────────────
  // ADMIN DASHBOARD — governance / control-plane oriented
  // ──────────────────────────────────────────────────────────
  if (role === 'admin') {
    const policyBlocks = mockAuditEvents.filter(e => e.result === 'blocked' || e.result === 'denied' || e.result === 'escalated')
    const policyEvals = mockAuditEvents.filter(e => e.objectType === 'policy' || e.policyRule)
    const accessGrants = mockAuditEvents.filter(e => e.objectType === 'access')
    const executionRestrictions = mockAuditEvents.filter(e => e.objectType === 'execution')
    const stuckApprovals = pendingApprovals.filter(a => {
      const created = new Date(a.createdAt).getTime()
      const now = Date.now()
      return (now - created) > 48 * 60 * 60 * 1000 // older than 48h
    })
    const hardBlockPolicies = mockPolicyRules.filter(r => r.decision === 'deny' && r.isActive)
    const escalationPolicies = mockPolicyRules.filter(r => r.decision === 'escalate' && r.isActive)

    // Integration health mock — covers core control-plane providers.
    const integrations = [
      { name: 'OPA Policy Engine', status: 'healthy' as const },
      { name: 'PostgreSQL', status: 'healthy' as const },
      { name: 'GitHub', status: 'healthy' as const },
    ]
    const healthyCount = integrations.filter(i => i.status === 'healthy').length

    return (
      <div className="flex flex-col gap-12">
        <div>
          <h1 className="font-heading text-3xl font-medium tracking-tight text-foreground">System Governance</h1>
          <p className="text-foreground/80 mt-1">Control plane — policy health, integration status, and cross-lane oversight</p>
          <div className="mt-1 text-xs text-muted-foreground">Viewing as: <span className="text-primary font-medium">{config.label}</span></div>
        </div>

        {/* Governance stats */}
        <div className="grid grid-cols-5 gap-4">
          <StatCard label="Policy Blocks" value={policyBlocks.length} icon={Ban} color="bg-risk-critical/10 text-risk-critical" to="/audit" />
          <StatCard label="Pending Decisions" value={pendingApprovals.length} icon={CheckCircle2} color="bg-status-pending/10 text-status-pending" to="/approvals" />
          <StatCard label="Active Incidents" value={activeIncidents.length} icon={AlertTriangle} color="bg-risk-high/10 text-risk-high" to="/incidents" />
          <StatCard label="Active Rules" value={mockPolicyRules.filter(r => r.isActive).length} icon={Shield} color="bg-primary/10 text-primary" to="/policies" />
          <StatCard label="Integrations" value={healthyCount} icon={Server} color="bg-status-approved/10 text-status-approved" to="/settings" />
        </div>

        {/* Policy Violations + Integration Health row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent Policy Violations / Blocks */}
          <div className="rounded-xl border border-risk-critical/40 bg-card text-card-foreground shadow-sm overflow-hidden ring-2 ring-risk-critical/15">
            <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-risk-critical flex items-center gap-2">
                <Ban className="w-4 h-4" />
                Recent Policy Blocks &amp; Escalations
              </h2>
              <Link to="/audit" className="text-xs font-medium text-primary hover:underline">View audit</Link>
            </div>
            <div className="divide-y divide-border/60">
              {policyBlocks.length > 0 ? policyBlocks.slice(0, 5).map(event => (
                <div key={event.id} className="flex items-center justify-between px-4 py-3 border-l-2 border-l-risk-critical">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <span className={`text-xs font-medium px-2 py-1 rounded ${
                      event.result === 'blocked' ? 'bg-risk-critical/10 text-risk-critical'
                        : event.result === 'denied' ? 'bg-risk-critical/10 text-risk-critical'
                        : 'bg-status-escalated/10 text-status-escalated'
                    }`}>{event.result}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-foreground truncate">{event.objectTitle}</div>
                      <div className="text-xs text-muted-foreground">{event.action} · {event.policyRule || event.objectType}</div>
                    </div>
                  </div>
                </div>
              )) : (
                <div className="px-4 py-6 text-center text-sm text-muted-foreground">No recent policy blocks</div>
              )}
            </div>
          </div>

          {/* Integration Health */}
          <div className="rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                <Activity className="w-4 h-4 text-status-approved" />
                Integration Health
              </h2>
              <Link to="/settings" className="text-xs font-medium text-primary hover:underline">Manage</Link>
            </div>
            <div className="divide-y divide-border/60">
              {integrations.map(intg => (
                <div key={intg.name} className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-foreground">{intg.name}</span>
                  <span className={`text-xs font-medium flex items-center gap-2 ${
                    intg.status === 'healthy' ? 'text-status-approved' : 'text-risk-critical'
                  }`}>
                    <CheckCircle className="w-3 h-3" />
                    {intg.status === 'healthy' ? 'Healthy' : 'Degraded'}
                  </span>
                </div>
              ))}
              <div className="px-4 py-2 bg-muted/50">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Server className="w-3 h-3" />
                  <span>3 MCP surfaces active · Policy bundle v2.4.1 · Last sync 2 min ago</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* High-risk decisions + Execution restrictions */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* High-Risk Pending Decisions */}
          <div className="rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-risk-high" />
                High-Risk Pending Decisions
              </h2>
              <Link to="/approvals" className="text-xs font-medium text-primary hover:underline">View all</Link>
            </div>
            <div className="divide-y divide-border/60">
              {pendingApprovals.filter(a => a.riskLevel === 'high' || a.riskLevel === 'critical').length > 0
                ? pendingApprovals.filter(a => a.riskLevel === 'high' || a.riskLevel === 'critical').slice(0, 4).map(approval => (
                  <Link key={approval.id} to="/approvals" className="flex items-center justify-between px-5 py-3.5 hover:bg-muted transition-colors border-l-2 border-l-risk-high">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <RiskBadge level={approval.riskLevel} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-foreground truncate">{approval.title}</div>
                        <div className="text-xs text-muted-foreground">{approval.requester} · {approval.type} · {approval.impactedSystem}</div>
                      </div>
                      {approval.coApprovals && (
                        <span className="text-xs font-medium px-1.5 py-1 rounded bg-muted text-muted-foreground flex-shrink-0">
                          {approval.coApprovals.filter(c => c.status === 'approved').length}/{approval.coApprovals.length} approved
                        </span>
                      )}
                    </div>
                    <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0 ml-3" />
                  </Link>
                ))
                : <div className="px-4 py-6 text-center text-sm text-muted-foreground">No high-risk decisions pending</div>
              }
            </div>
          </div>

          {/* Execution Mode & Restrictions */}
          <div className="rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                <Lock className="w-4 h-4 text-status-simulated" />
                Execution Restrictions
              </h2>
              <Link to="/policies" className="text-xs font-medium text-primary hover:underline">View policies</Link>
            </div>
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between bg-muted rounded p-3">
                <div>
                  <div className="text-xs text-muted-foreground">Default Execution Mode</div>
                  <div className="text-sm text-status-simulated font-medium">Simulate Only</div>
                </div>
                <span className="text-xs px-2 py-1 rounded bg-status-simulated/10 text-status-simulated font-medium">ACTIVE</span>
              </div>
              <div className="flex items-center justify-between bg-muted rounded p-3">
                <div>
                  <div className="text-xs text-muted-foreground">Freeze Window</div>
                  <div className="text-sm text-foreground">None active</div>
                </div>
                <span className="text-xs px-2 py-1 rounded bg-card text-muted-foreground font-medium">INACTIVE</span>
              </div>
              <div className="border-t border-border pt-3 space-y-1.5">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Active Guardrails</div>
                <div className="text-xs font-medium text-risk-critical">{hardBlockPolicies.length} hard blocks · {escalationPolicies.length} escalation rules</div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {hardBlockPolicies.slice(0, 3).map(p => (
                    <span key={p.id} className="text-xs font-mono bg-risk-critical/10 text-risk-critical px-1.5 py-1 rounded">{p.name}</span>
                  ))}
                  {escalationPolicies.slice(0, 2).map(p => (
                    <span key={p.id} className="text-xs font-mono bg-status-escalated/10 text-status-escalated px-1.5 py-1 rounded">{p.name}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Cross-lane: blocked changes + stuck approvals + recent governance events */}
        <div className="grid grid-cols-3 gap-5">
          {/* Blocked by Policy */}
          <div className="rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                <Ban className="w-4 h-4 text-risk-critical" />
                Blocked Changes
              </h2>
            </div>
            <div className="divide-y divide-border/60">
              {blockedChanges.length > 0 ? blockedChanges.slice(0, 3).map(change => (
                <Link key={change.id} to={`/changes/${change.id}`} className="flex items-center gap-3 px-5 py-3.5 hover:bg-muted transition-colors">
                  <PolicyBadge decision={change.policyDecision} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-foreground truncate">{change.title}</div>
                    <div className="text-xs text-muted-foreground">{change.ticketId} · {change.service}</div>
                  </div>
                </Link>
              )) : (
                <div className="px-4 py-6 text-center text-sm text-muted-foreground">No blocked changes</div>
              )}
            </div>
          </div>

          {/* Approval Chain Bottlenecks */}
          <div className="rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                <Clock className="w-4 h-4 text-status-pending" />
                Approval Bottlenecks
              </h2>
            </div>
            <div className="divide-y divide-border/60">
              {stuckApprovals.length > 0 ? stuckApprovals.slice(0, 3).map(a => (
                <Link key={a.id} to="/approvals" className="flex items-center gap-3 px-5 py-3.5 hover:bg-muted transition-colors">
                  <RiskBadge level={a.riskLevel} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-foreground truncate">{a.title}</div>
                    <div className="text-xs text-muted-foreground">Pending {timeAgo(a.createdAt)}</div>
                  </div>
                </Link>
              )) : (
                <div className="px-4 py-6 text-center text-sm text-muted-foreground">No bottlenecks detected</div>
              )}
              {pendingApprovals.filter(a => {
                const pending = a.coApprovals?.filter(c => c.status === 'pending') || []
                return pending.length > 1
              }).length > 0 && (
                <div className="px-4 py-2 bg-muted/50 text-xs text-muted-foreground">
                  {pendingApprovals.filter(a => (a.coApprovals?.filter(c => c.status === 'pending') || []).length > 1).length} approvals waiting on multiple approvers
                </div>
              )}
            </div>
          </div>

          {/* Recent Governance Events */}
          <div className="rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                <ScrollText className="w-4 h-4 text-muted-foreground" />
                Governance Events
              </h2>
              <Link to="/audit" className="text-xs font-medium text-primary hover:underline">Full trail</Link>
            </div>
            <div className="divide-y divide-border/60">
              {policyEvals.slice(0, 4).map(event => (
                <div key={event.id} className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-medium px-1.5 py-1 rounded ${
                      event.result === 'blocked' ? 'bg-risk-critical/10 text-risk-critical'
                        : event.result === 'escalated' ? 'bg-status-escalated/10 text-status-escalated'
                        : 'bg-status-approved/10 text-status-approved'
                    }`}>{event.result}</span>
                    <span className="text-xs text-muted-foreground font-mono">{event.policyRule}</span>
                  </div>
                  <div className="text-sm text-foreground mt-1 truncate">{event.objectTitle}</div>
                  <div className="text-xs text-muted-foreground">{event.action} · {timeAgo(event.timestamp)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Admin authority note */}
        <div className="bg-muted rounded-lg border border-border px-4 py-3 flex items-center gap-3">
          <Shield className="w-4 h-4 text-primary flex-shrink-0" />
          <p className="text-xs text-muted-foreground">
            Admin authority extends routing and governance actions, but hard policy blocks and audit requirements still apply. All actions are logged.
          </p>
        </div>
      </div>
    )
  }

  // ──────────────────────────────────────────────────────────
  // DEFAULT DASHBOARD (Operator, etc.)
  // ──────────────────────────────────────────────────────────
  const stats: { label: string; value: number; icon: React.ElementType; color: string; to?: string }[] = []
  if (canAccess('/changes')) stats.push({ label: 'Open Changes', value: mockChanges.filter(c => c.status !== 'deployed').length, icon: GitPullRequest, color: 'bg-primary/10 text-primary', to: '/changes' })
  if (canAccess('/incidents')) stats.push({ label: 'Active Incidents', value: activeIncidents.length, icon: AlertTriangle, color: 'bg-risk-high/10 text-risk-high', to: '/incidents' })
  if (canAccess('/approvals')) stats.push({ label: 'Pending Approvals', value: pendingApprovals.length, icon: CheckCircle2, color: 'bg-status-pending/10 text-status-pending', to: '/approvals' })
  if (canAccess('/access-requests')) stats.push({ label: 'Access Requests', value: pendingAccess.length, icon: KeyRound, color: 'bg-status-draft/10 text-status-draft', to: '/access-requests' })

  // Urgently actionable items for the operator
  const urgentItems = [
    ...highRiskChanges.map(c => ({
      id: c.id, type: 'change' as const, to: `/changes/${c.id}`,
      title: c.title, subtitle: `${c.ticketId} · ${c.service}`,
      risk: c.riskLevel, hint: changeNextStep(c),
    })),
    ...sevIncidents.map(i => ({
      id: i.id, type: 'incident' as const, to: `/incidents/${i.id}`,
      title: i.title, subtitle: `${i.incidentId} · ${i.affectedService}`,
      risk: (i.severity === 'sev1' ? 'critical' : 'high') as 'critical' | 'high',
      hint: incidentNextStep(i),
    })),
  ]

  return (
    <div className="flex flex-col gap-12">
      <div>
        <h1 className="font-heading text-3xl font-medium tracking-tight text-foreground">{greeting.title}</h1>
        <p className="text-foreground/80 mt-1">{greeting.subtitle}</p>
        <div className="mt-1 text-xs text-muted-foreground">Viewing as: <span className="text-primary font-medium">{config.label}</span></div>
      </div>

      {/* Stats — clickable */}
      <div className={`grid gap-4 ${stats.length <= 2 ? 'grid-cols-2' : stats.length === 3 ? 'grid-cols-3' : 'grid-cols-4'}`}>
        {stats.map(s => (
          <StatCard key={s.label} {...s} />
        ))}
      </div>

      {/* URGENT: Needs Attention — FULL WIDTH at top for operator */}
      {urgentItems.length > 0 && (canAccess('/changes') || canAccess('/incidents')) && (
        <div className="rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-risk-critical flex items-center gap-2">
              <ShieldAlert className="w-4 h-4" />
              Needs Attention — {urgentItems.length} items
            </h2>
          </div>
          <div className="divide-y divide-border/60">
            {urgentItems.map(item => (
              <Link key={item.id} to={item.to} className={`flex items-center justify-between px-5 py-3.5 hover:bg-muted transition-colors border-l-2 ${item.hint.color}`}>
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <RiskBadge level={item.risk} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-foreground truncate">{item.title}</div>
                    <div className="text-xs text-muted-foreground">{item.subtitle}</div>
                  </div>
                  <span className="inline-flex flex-shrink-0 items-center rounded-md bg-muted px-2.5 py-1.5 text-xs font-medium text-foreground/80">
                    {item.hint.label}
                  </span>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0 ml-3" />
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Blocked by Policy — separate section for operator awareness */}
      {canAccess('/changes') && blockedChanges.length > 0 && (
        <div className="rounded-xl border border-risk-critical/40 bg-card text-card-foreground shadow-sm overflow-hidden ring-2 ring-risk-critical/15">
          <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between">
            <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
              <Ban className="w-4 h-4 text-risk-critical" />
              Blocked by Policy
            </h2>
            <span className="text-xs font-medium text-risk-critical">{blockedChanges.length} blocked</span>
          </div>
          <div className="divide-y divide-border/60">
            {blockedChanges.map(change => (
              <Link key={change.id} to={`/changes/${change.id}`} className="flex items-center justify-between px-5 py-3.5 hover:bg-muted transition-colors border-l-2 border-l-risk-critical">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <PolicyBadge decision={change.policyDecision} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-foreground truncate">{change.title}</div>
                    <div className="text-xs text-muted-foreground">{change.ticketId} · {change.service}</div>
                  </div>
                  <span className="text-xs text-risk-critical bg-risk-critical/10 px-2 py-1 rounded flex-shrink-0">
                    {change.policyDecision === 'deny' ? 'Hard block' : 'Needs escalation'}
                  </span>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0 ml-3" />
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pending Approvals */}
        {canAccess('/approvals') && (
          <div className="rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                <Clock className="w-4 h-4 text-status-pending" />
                Pending Approvals
              </h2>
              <Link to="/approvals" className="text-xs font-medium text-primary hover:underline">View all</Link>
            </div>
            <div className="divide-y divide-border/60">
              {pendingApprovals.slice(0, 4).map(approval => (
                <Link key={approval.id} to="/approvals" className="flex items-center justify-between px-5 py-3.5 hover:bg-muted transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <ApprovalBadge state="pending" />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground truncate">{approval.title}</div>
                      <div className="text-xs text-muted-foreground">{approval.requester} · {approval.type}</div>
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground flex-shrink-0">{timeAgo(approval.createdAt)}</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Open Incidents */}
        {canAccess('/incidents') && (
          <div className="rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                <Wrench className="w-4 h-4 text-risk-high" />
                Open Incidents
              </h2>
              <Link to="/incidents" className="text-xs font-medium text-primary hover:underline">View all</Link>
            </div>
            <div className="divide-y divide-border/60">
              {activeIncidents.slice(0, 4).map(incident => {
                const hint = incidentNextStep(incident)
                return (
                  <Link key={incident.id} to={`/incidents/${incident.id}`} className={`flex items-center justify-between px-5 py-3.5 hover:bg-muted transition-colors border-l-2 ${hint.color}`}>
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <RiskBadge level={incident.severity === 'sev1' ? 'critical' : incident.severity === 'sev2' ? 'high' : 'medium'} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-foreground truncate">{incident.title}</div>
                        <div className="text-xs text-muted-foreground">{incident.incidentId} · {incident.affectedService}</div>
                      </div>
                      <span className="inline-flex flex-shrink-0 items-center rounded-md bg-muted px-2.5 py-1.5 text-xs font-medium text-foreground/80">{hint.label}</span>
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>
        )}

        {/* Recent Changes — with next step hints */}
        {canAccess('/changes') && (
          <div className="rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                <GitPullRequest className="w-4 h-4 text-primary" />
                Recent Changes
              </h2>
              <Link to="/changes" className="text-xs font-medium text-primary hover:underline">View all</Link>
            </div>
            <div className="divide-y divide-border/60">
              {mockChanges.slice(0, 4).map(change => {
                const hint = changeNextStep(change)
                return (
                  <Link key={change.id} to={`/changes/${change.id}`} className={`flex items-center justify-between px-5 py-3.5 hover:bg-muted transition-colors border-l-2 ${hint.color}`}>
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <RiskBadge level={change.riskLevel} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-foreground truncate">{change.title}</div>
                        <div className="text-xs text-muted-foreground">{change.ticketId} · {change.owner}</div>
                      </div>
                      <span className="inline-flex flex-shrink-0 items-center rounded-md bg-muted px-2.5 py-1.5 text-xs font-medium text-foreground/80">{hint.label}</span>
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>
        )}

        {/* Access Requests */}
        {canAccess('/access-requests') && (
          <div className="rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-status-draft" />
                Access Requests
              </h2>
              <Link to="/access-requests" className="text-xs font-medium text-primary hover:underline">View all</Link>
            </div>
            <div className="divide-y divide-border/60">
              {mockAccessRequests.slice(0, 4).map(req => (
                <Link key={req.id} to={`/access-requests/${req.id}`} className="flex items-center justify-between px-5 py-3.5 hover:bg-muted transition-colors border-l-2 border-l-status-pending">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <RiskBadge level={req.riskLevel} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-foreground truncate">{req.requester} → {req.requestedSystem}</div>
                      <div className="text-xs text-muted-foreground">{req.requestId} · {req.requestedRole}</div>
                    </div>
                  </div>
                  <ApprovalBadge state={req.status === 'pending' ? 'pending' : req.status === 'approved' ? 'approved' : 'denied'} />
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
