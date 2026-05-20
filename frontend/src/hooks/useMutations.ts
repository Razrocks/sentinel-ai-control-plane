import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { Approval, Change, AccessRequest, Incident } from '@/types'

// ─── Types ──────────────────────────────────────────────

interface ApprovalDecideInput {
  id: string
  decision: 'approved' | 'denied' | 'approved_with_condition'
  condition?: string
}

interface ApprovalDecideResult {
  approval: Approval
  isComplete: boolean
  isFinalApproval: boolean
  allApproved: boolean
}

interface ChangeExecuteResult extends Change {}

interface SimulationResult {
  success: boolean
  changeId: string
  simulationResult: {
    status: string
    message: string
    checks: Array<{ name: string; result: string }>
  }
}

interface AccessRequestDecideInput {
  id: string
  decision: 'approved' | 'denied'
  role: 'manager' | 'owner'
}

interface IncidentUpdateStatusInput {
  id: string
  status: string
}

// ─── Approval Mutations ─────────────────────────────────

/**
 * Decide on an approval (approve / deny / approve_with_condition).
 * Invalidates approvals, changes, access-requests, and audit-events caches.
 */
export function useApprovalDecision() {
  const queryClient = useQueryClient()

  return useMutation<ApprovalDecideResult, Error, ApprovalDecideInput>({
    mutationFn: async ({ id, decision, condition }) => {
      return apiFetch<ApprovalDecideResult>(`/approvals/${id}/decide`, {
        method: 'POST',
        body: JSON.stringify({ decision, condition }),
      })
    },
    onSuccess: () => {
      // Invalidate all related caches
      queryClient.invalidateQueries({ queryKey: ['approvals'] })
      queryClient.invalidateQueries({ queryKey: ['changes'] })
      queryClient.invalidateQueries({ queryKey: ['accessRequests'] })
      queryClient.invalidateQueries({ queryKey: ['auditEvents'] })
    },
  })
}

// ─── Change Mutations ───────────────────────────────────

/**
 * Execute (deploy) a change. Policy engine validates.
 */
export function useChangeExecute() {
  const queryClient = useQueryClient()

  return useMutation<ChangeExecuteResult, Error, string>({
    mutationFn: async (changeId) => {
      return apiFetch<ChangeExecuteResult>(`/changes/${changeId}/execute`, {
        method: 'POST',
        body: JSON.stringify({}),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['changes'] })
      queryClient.invalidateQueries({ queryKey: ['auditEvents'] })
    },
  })
}

/**
 * Simulate (dry-run) a change.
 */
export function useChangeSimulate() {
  const queryClient = useQueryClient()

  return useMutation<SimulationResult, Error, string>({
    mutationFn: async (changeId) => {
      return apiFetch<SimulationResult>(`/changes/${changeId}/simulate`, {
        method: 'POST',
        body: JSON.stringify({}),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auditEvents'] })
    },
  })
}

/**
 * Escalate a change.
 */
export function useChangeEscalate() {
  const queryClient = useQueryClient()

  return useMutation<Change, Error, { changeId: string; reason?: string }>({
    mutationFn: async ({ changeId, reason }) => {
      return apiFetch<Change>(`/changes/${changeId}/escalate`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['changes'] })
      queryClient.invalidateQueries({ queryKey: ['auditEvents'] })
    },
  })
}

// ─── Access Request Mutations ───────────────────────────

/**
 * Decide on an access request (manager or owner approval/denial).
 */
export function useAccessRequestDecide() {
  const queryClient = useQueryClient()

  return useMutation<AccessRequest, Error, AccessRequestDecideInput>({
    mutationFn: async ({ id, decision, role }) => {
      return apiFetch<AccessRequest>(`/access-requests/${id}/decide`, {
        method: 'POST',
        body: JSON.stringify({ decision, role }),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accessRequests'] })
      queryClient.invalidateQueries({ queryKey: ['approvals'] })
      queryClient.invalidateQueries({ queryKey: ['auditEvents'] })
    },
  })
}

// ─── Incident Mutations ─────────────────────────────────

/**
 * Update an incident's status. Backend validates transition order.
 */
export function useIncidentUpdateStatus() {
  const queryClient = useQueryClient()

  return useMutation<Incident, Error, IncidentUpdateStatusInput>({
    mutationFn: async ({ id, status }) => {
      return apiFetch<Incident>(`/incidents/${id}/update-status`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] })
      queryClient.invalidateQueries({ queryKey: ['auditEvents'] })
    },
  })
}

// ─── Agent Re-analyze Mutations ─────────────────────────
// Trigger an agent end-to-end via the /api/agents/* routes.
// Returns the agent's full structured result; UI shows summary toast.

interface AgentTriageResult {
  // ChangeTriageAgent
  changeId?: string
  ticketId?: string
  appliedRiskLevel?: string
  blastRadiusItemsWritten?: number
  // IncidentTriageAgent
  incidentId?: string
  appliedSeverity?: string
  fieldsUpdated?: string[]
  // AccessReviewerAgent
  requestId?: string
  // ApprovalRouterAgent
  approvalId?: string
  coApprovalsWritten?: number
  filerOmitted?: number
  decisionImpactWritten?: boolean
  // Common
  assess?: { status: string; output?: unknown; errorMessage?: string }
  blastRadius?: { status: string; output?: unknown; errorMessage?: string }
  triage?: { status: string; output?: unknown; errorMessage?: string }
  evaluate?: { status: string; output?: unknown; errorMessage?: string }
  route?: { status: string; output?: unknown; errorMessage?: string }
  impact?: { status: string; output?: unknown; errorMessage?: string }
}

/**
 * Re-run ChangeTriageAgent on a Change. Calls assess_change + analyze_blast_radius.
 */
export function useTriageChangeAgent() {
  const queryClient = useQueryClient()
  return useMutation<AgentTriageResult, Error, string>({
    mutationFn: async (changeIdOrTicket) => {
      return apiFetch<AgentTriageResult>(`/agents/triage-change/${changeIdOrTicket}`, {
        method: 'POST',
        body: JSON.stringify({}),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['changes'] })
      queryClient.invalidateQueries({ queryKey: ['auditEvents'] })
    },
  })
}

/**
 * Re-run IncidentTriageAgent on an Incident. Calls triage_incident.
 */
export function useTriageIncidentAgent() {
  const queryClient = useQueryClient()
  return useMutation<AgentTriageResult, Error, string>({
    mutationFn: async (incidentIdOrTicket) => {
      return apiFetch<AgentTriageResult>(`/agents/triage-incident/${incidentIdOrTicket}`, {
        method: 'POST',
        body: JSON.stringify({}),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] })
      queryClient.invalidateQueries({ queryKey: ['auditEvents'] })
    },
  })
}

/**
 * Re-run AccessReviewerAgent on an AccessRequest. Calls evaluate_access_request.
 */
export function useReviewAccessRequestAgent() {
  const queryClient = useQueryClient()
  return useMutation<AgentTriageResult, Error, string>({
    mutationFn: async (requestIdOrTicket) => {
      return apiFetch<AgentTriageResult>(`/agents/review-access-request/${requestIdOrTicket}`, {
        method: 'POST',
        body: JSON.stringify({}),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accessRequests'] })
      queryClient.invalidateQueries({ queryKey: ['auditEvents'] })
    },
  })
}
