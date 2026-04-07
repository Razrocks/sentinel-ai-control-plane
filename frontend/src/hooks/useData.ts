import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

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
