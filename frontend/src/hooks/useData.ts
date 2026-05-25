import { useQuery } from '@tanstack/react-query'
import { api, apiFetch } from '@/lib/api'

// Shared stale time — data refreshes every 30s to prevent flicker
const STALE_TIME = 30_000

// ─── Changes ─────────────────────────────────────────────

export function useChanges(filters?: Record<string, string>) {
  return useQuery({
    queryKey: ['changes', filters],
    queryFn: () => api.getChanges(filters),
    staleTime: STALE_TIME,
  })
}

export function useChange(id: string) {
  return useQuery({
    queryKey: ['changes', id],
    queryFn: () => api.getChange(id),
    staleTime: STALE_TIME,
    enabled: !!id,
  })
}

// ─── Incidents ───────────────────────────────────────────

export function useIncidents(filters?: Record<string, string>) {
  return useQuery({
    queryKey: ['incidents', filters],
    queryFn: () => api.getIncidents(filters),
    staleTime: STALE_TIME,
  })
}

export function useIncident(id: string) {
  return useQuery({
    queryKey: ['incidents', id],
    queryFn: () => api.getIncident(id),
    staleTime: STALE_TIME,
    enabled: !!id,
  })
}

// ─── Access Requests ─────────────────────────────────────

export function useAccessRequests(filters?: Record<string, string>) {
  return useQuery({
    queryKey: ['accessRequests', filters],
    queryFn: () => api.getAccessRequests(filters),
    staleTime: STALE_TIME,
  })
}

export function useAccessRequest(id: string) {
  return useQuery({
    queryKey: ['accessRequests', id],
    queryFn: () => api.getAccessRequest(id),
    staleTime: STALE_TIME,
    enabled: !!id,
  })
}

// ─── Approvals ───────────────────────────────────────────

export function useApprovals(filters?: Record<string, string>) {
  return useQuery({
    queryKey: ['approvals', filters],
    queryFn: () => api.getApprovals(filters),
    staleTime: STALE_TIME,
  })
}

// ─── Audit Events ────────────────────────────────────────

export function useAuditEvents(filters?: Record<string, string>) {
  return useQuery({
    queryKey: ['auditEvents', filters],
    queryFn: () => api.getAuditEvents(filters).then((res) => res.data),
    staleTime: STALE_TIME,
  })
}

// ─── Policies ────────────────────────────────────────────

export function usePolicies(filters?: Record<string, string>) {
  return useQuery({
    queryKey: ['policies', filters],
    queryFn: () => api.getPolicies(filters),
    staleTime: STALE_TIME,
  })
}

// ─── Settings ────────────────────────────────────────────

export function useIntegrations() {
  return useQuery({
    queryKey: ['integrations'],
    queryFn: () => api.getIntegrations().then((res) => res.integrations),
    staleTime: STALE_TIME,
  })
}

export function useSettingsHealth() {
  return useQuery({
    queryKey: ['settingsHealth'],
    queryFn: () => api.getSettingsHealth(),
    staleTime: STALE_TIME,
  })
}

// ─── Admin metrics (D MVP) ──────────────────────────────

export interface AdminMetricsHealth {
  timestamp: string
  uptime: number
  memoryMb: number
  totals: Record<string, number>
  last24h: Record<string, number>
}

export interface AdminMetricsSkill {
  skill: string
  totalCalls: number
  successCount: number
  validationFailedCount: number
  errorCount: number
  cacheHitRate: number
  tokensIn: number
  tokensOut: number
  costUsd: number
  latencyMsP50: number
  latencyMsP95: number
  avgConfidence: number | null
}

export interface AdminMetricsCost {
  sinceDays: number
  since: string
  totalCalls: number
  totalCostUsd: number
  totalTokensIn: number
  totalTokensOut: number
  byActor: Array<{ actor: string; calls: number; costUsd: number; tokensIn: number; tokensOut: number }>
  byModel: Array<{ model: string; calls: number; costUsd: number }>
}

export interface AdminMetricsAudit {
  sinceDays: number
  since: string
  totalEvents: number
  byResult: Record<string, number>
  byObjectType: Record<string, number>
  topActions: Array<{ action: string; success: number; blocked: number; denied: number; escalated: number; total: number }>
}

// 30s refresh — dashboard feels live without hammering backend
const METRICS_REFRESH_MS = 30_000

export function useAdminMetricsHealth() {
  return useQuery<AdminMetricsHealth>({
    queryKey: ['adminMetricsHealth'],
    queryFn: () => apiFetch<AdminMetricsHealth>('/admin/metrics/health'),
    staleTime: METRICS_REFRESH_MS,
    refetchInterval: METRICS_REFRESH_MS,
  })
}

export function useAdminMetricsSkills(days: number = 7) {
  return useQuery<{ sinceDays: number; since: string; skills: AdminMetricsSkill[] }>({
    queryKey: ['adminMetricsSkills', days],
    queryFn: () =>
      apiFetch<{ sinceDays: number; since: string; skills: AdminMetricsSkill[] }>(
        `/admin/metrics/skills?days=${days}`,
      ),
    staleTime: METRICS_REFRESH_MS,
    refetchInterval: METRICS_REFRESH_MS,
  })
}

export function useAdminMetricsCost(days: number = 7) {
  return useQuery<AdminMetricsCost>({
    queryKey: ['adminMetricsCost', days],
    queryFn: () => apiFetch<AdminMetricsCost>(`/admin/metrics/cost?days=${days}`),
    staleTime: METRICS_REFRESH_MS,
    refetchInterval: METRICS_REFRESH_MS,
  })
}

export function useAdminMetricsAudit(days: number = 7) {
  return useQuery<AdminMetricsAudit>({
    queryKey: ['adminMetricsAudit', days],
    queryFn: () => apiFetch<AdminMetricsAudit>(`/admin/metrics/audit?days=${days}`),
    staleTime: METRICS_REFRESH_MS,
    refetchInterval: METRICS_REFRESH_MS,
  })
}
