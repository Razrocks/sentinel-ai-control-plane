import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch, ApiError } from '@/lib/api'
import type { Approval, Change, AccessRequest, Incident } from '@/types'

// ─── Types ──────────────────────────────────────────────

interface ApprovalDecideInput {
  id: string
  decision: 'approved' | 'denied' | 'approved_with_condition'
  condition?: string
  /**
   * B5 — optimistic-lock version read from the Approval. The backend rejects
   * the mutation with 412 if this no longer matches, preventing two
   * approvers from racing past each other. Callers MUST pass this; we
   * default to `undefined` only so existing tests keep typechecking.
   */
  expectedVersion?: number
}

/**
 * Thrown when the backend rejects a decide call with 412 Precondition
 * Failed. Carries the current version the server has so the UI can show
 * "someone else acted on this — reload to see the latest" and refetch.
 */
export class ApprovalConflictError extends Error {
  constructor(
    public approvalId: string,
    public expectedVersion: number,
    public currentVersion: number,
  ) {
    super(
      `Approval ${approvalId} changed since you loaded it (your version ${expectedVersion}, current ${currentVersion}). Reload and review the latest state before deciding again.`,
    )
    this.name = 'ApprovalConflictError'
  }
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
    mutationFn: async ({ id, decision, condition, expectedVersion }) => {
      try {
        return await apiFetch<ApprovalDecideResult>(`/approvals/${id}/decide`, {
          method: 'POST',
          // B5: send the version both as an If-Match header (HTTP-standard)
          // and as expectedVersion in the body (so clients without easy
          // header access still get protection). Backend prefers the header.
          headers:
            typeof expectedVersion === 'number'
              ? { 'If-Match': `"${expectedVersion}"` }
              : undefined,
          body: JSON.stringify({ decision, condition, expectedVersion }),
        })
      } catch (err) {
        // Translate 412 into a domain-specific error so the UI can render
        // a "stale approval" message and trigger a fresh fetch instead of
        // showing a generic "Bad Request" toast.
        if (err instanceof ApiError && err.status === 412) {
          const body = err.body as { expectedVersion?: number; currentVersion?: number } | undefined
          throw new ApprovalConflictError(
            id,
            body?.expectedVersion ?? expectedVersion ?? -1,
            body?.currentVersion ?? -1,
          )
        }
        throw err
      }
    },
    onSuccess: () => {
      // Invalidate all related caches
      queryClient.invalidateQueries({ queryKey: ['approvals'] })
      queryClient.invalidateQueries({ queryKey: ['changes'] })
      queryClient.invalidateQueries({ queryKey: ['accessRequests'] })
      queryClient.invalidateQueries({ queryKey: ['auditEvents'] })
    },
    onError: async (err) => {
      // On a stale-version conflict, force a refetch (not just invalidate)
      // so the approval cards re-render with the new version BEFORE the
      // user clicks retry. `refetchQueries` blocks on the network round-trip
      // so the next render has fresh `approval.version` in scope, and the
      // user's next click sends the correct `If-Match`.
      if (err instanceof ApprovalConflictError) {
        await queryClient.refetchQueries({ queryKey: ['approvals'], type: 'active' })
      }
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
