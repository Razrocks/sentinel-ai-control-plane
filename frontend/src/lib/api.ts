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

// Token getter — set by auth module to avoid circular import
let _getToken: (() => string | null) | null = null
export function setTokenGetter(fn: () => string | null) { _getToken = fn }

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = _getToken?.()
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

// ─── Streaming chat helper ──────────────────────────────

export interface ChatContext {
  pagePath: string
  entityType?: 'change' | 'incident' | 'access_request'
  entityId?: string
  /** Stable id per conversation. Server uses this for cross-session memory grouping. */
  sessionId?: string
}

export async function chatStream(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  context: ChatContext,
  onChunk: (text: string) => void,
  onDone: () => void,
  onError: (err: string) => void,
): Promise<AbortController> {
  const controller = new AbortController()
  const token = _getToken?.()

  try {
    const res = await fetch(`${API_BASE}/chat`, {
      method: 'POST',
      credentials: 'include',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ messages, context }),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText)
      onError(text)
      return controller
    }

    const reader = res.body?.getReader()
    if (!reader) {
      onError('No response body')
      return controller
    }

    const decoder = new TextDecoder()
    let buffer = ''

    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // Parse SSE lines from buffer
        const lines = buffer.split('\n')
        buffer = lines.pop() || '' // Keep incomplete last line in buffer

        let currentEvent = ''
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim()
          } else if (line.startsWith('data: ')) {
            const data = line.slice(6)
            try {
              const parsed = JSON.parse(data)
              if (currentEvent === 'chunk' && parsed.content) {
                onChunk(parsed.content)
              } else if (currentEvent === 'done') {
                onDone()
                return
              } else if (currentEvent === 'error') {
                onError(parsed.message || 'Stream error')
                return
              }
            } catch {
              // Ignore parse errors for heartbeats etc.
            }
          }
        }
      }
      // Stream ended without explicit done event
      onDone()
    }

    pump().catch((err) => {
      if (err.name !== 'AbortError') {
        onError(err.message || 'Stream read error')
      }
    })
  } catch (err: unknown) {
    if (err instanceof Error && err.name !== 'AbortError') {
      onError(err.message || 'Failed to connect')
    }
  }

  return controller
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
