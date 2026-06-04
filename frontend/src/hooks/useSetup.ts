import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

/**
 * Setup status — polled on app load + after each wizard step. Used by
 * SetupGuard to decide whether to redirect to /setup.
 */
export function useSetupStatus() {
  return useQuery({
    queryKey: ['setupStatus'],
    queryFn: () => api.getSetupStatus(),
    /** Re-check every 5s while the wizard is open so .env edits surface fast. */
    refetchInterval: 5_000,
  })
}

export function useRecheckEnv() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.recheckEnv(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['setupStatus'] }),
  })
}

export function useMarkSetupStep() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (step: string) => api.markSetupStep(step),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['setupStatus'] }),
  })
}

export function useCompleteSetup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.completeSetup(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['setupStatus'] }),
  })
}

// ─── Integrations ──────────────────────────────────────

export function useIntegrations() {
  return useQuery({
    queryKey: ['integrations:list'],
    queryFn: () => api.listIntegrations(),
    staleTime: 10_000,
  })
}

export function useIntegrationTypes() {
  return useQuery({
    queryKey: ['integrations:types'],
    queryFn: () => api.listIntegrationTypes(),
  })
}

export function useTestIntegration() {
  return useMutation({
    mutationFn: ({ type, credential }: { type: string; credential: string }) =>
      api.testIntegration(type, credential),
  })
}

export function useConnectIntegration() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      type,
      payload,
    }: {
      type: string
      payload: { credential: string; displayName: string; config?: Record<string, unknown> }
    }) => api.connectIntegration(type, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations:list'] }),
  })
}

export function useDisconnectIntegration() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.disconnectIntegration(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations:list'] }),
  })
}

export function useIntegrationScopes(type: string | null) {
  return useQuery({
    queryKey: ['integrations:scopes', type],
    queryFn: () => api.listIntegrationScopes(type!),
    enabled: !!type,
    /** Scopes can be expensive to fetch (GitHub paginates); cache 60s. */
    staleTime: 60_000,
  })
}

export function useRegisterWebhook() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      type,
      scopeIds,
      publicBaseUrl,
    }: {
      type: string
      scopeIds: string[]
      publicBaseUrl: string
    }) => api.registerIntegrationWebhook(type, { scopeIds, publicBaseUrl }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations:list'] }),
  })
}
