const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api'

class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  // Lazy import to avoid circular dependency
  const { getToken } = await import('./auth')
  const token = getToken()
  const url = `${API_BASE}${path}`
  const res = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  })

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new ApiError(res.status, text)
  }

  return res.json()
}

// Typed API functions for each resource

import type {
  Change,
  Incident,
  AccessRequest,
  Approval,
  AuditEvent,
  PolicyRule,
} from '@/types'

export const api = {
  // Changes
  getChanges: (filters?: Record<string, string>) => {
    const params = filters ? '?' + new URLSearchParams(filters).toString() : ''
    return apiFetch<Change[]>(`/changes${params}`)
  },
  getChange: (id: string) => apiFetch<Change>(`/changes/${id}`),

  // Incidents
  getIncidents: (filters?: Record<string, string>) => {
    const params = filters ? '?' + new URLSearchParams(filters).toString() : ''
    return apiFetch<Incident[]>(`/incidents${params}`)
  },
  getIncident: (id: string) => apiFetch<Incident>(`/incidents/${id}`),

  // Access Requests
  getAccessRequests: (filters?: Record<string, string>) => {
    const params = filters ? '?' + new URLSearchParams(filters).toString() : ''
    return apiFetch<AccessRequest[]>(`/access-requests${params}`)
  },
  getAccessRequest: (id: string) => apiFetch<AccessRequest>(`/access-requests/${id}`),

  // Approvals
  getApprovals: (filters?: Record<string, string>) => {
    const params = filters ? '?' + new URLSearchParams(filters).toString() : ''
    return apiFetch<Approval[]>(`/approvals${params}`)
  },
  getApproval: (id: string) => apiFetch<Approval>(`/approvals/${id}`),

  // Audit Events
  getAuditEvents: (filters?: Record<string, string>) => {
    const params = filters ? '?' + new URLSearchParams(filters).toString() : ''
    return apiFetch<{ data: AuditEvent[]; total: number; limit: number; offset: number }>(
      `/audit-events${params}`
    )
  },

  // Policies
  getPolicies: (filters?: Record<string, string>) => {
    const params = filters ? '?' + new URLSearchParams(filters).toString() : ''
    return apiFetch<PolicyRule[]>(`/policies${params}`)
  },

  // Settings
  getIntegrations: () =>
    apiFetch<{
      integrations: Array<{
        name: string
        type: string
        status: string
        version: string
        description: string
        lastChecked: string
      }>
    }>('/settings/integrations'),

  getSettingsHealth: () =>
    apiFetch<{
      overall: string
      connected: number
      total: number
      policyBundleVersion: string
      defaultExecutionMode: string
      freezeWindow: string | null
    }>('/settings/health'),
}
