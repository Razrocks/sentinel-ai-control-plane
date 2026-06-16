import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch, ApiError } from '@/lib/api'
import type { Approval, Change, AccessRequest, Incident } from '@/types'
import { toast } from '@/components/ui/sonner'

/**
 * Pull the most useful end-user message out of an API/network error.
 * Backend errors usually carry a `{ message }` body; if not, fall back to
 * the Error message. We avoid surfacing raw exception strings (eg
 * "TypeError: Failed to fetch") and replace them with something
 * actionable when possible.
 */
function readableError(err: Error, fallback = 'Something went wrong.'): string {
  if (err instanceof ApiError) {
    const body = err.body as { message?: string } | undefined
    if (body?.message) return body.message
    if (err.status === 401) return 'Session expired. Please log in again.'
    if (err.status === 403) return 'Not allowed by current role / policy.'
    if (err.status === 404) return 'Not found.'
    if (err.status === 409) return 'Conflict — the record changed since you loaded it.'
    if (err.status === 412) return 'Out of date — refresh and try again.'
    if (err.status >= 500) return 'Server error. Try again in a moment.'
    return err.message || fallback
  }
  return err.message || fallback
}

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
  expectedVersion?: number
}

interface IncidentUpdateStatusInput {
  id: string
  status: string
  expectedVersion?: number
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
    onSuccess: (_data, vars) => {
      // Invalidate all related caches
      queryClient.invalidateQueries({ queryKey: ['approvals'] })
      queryClient.invalidateQueries({ queryKey: ['changes'] })
      queryClient.invalidateQueries({ queryKey: ['accessRequests'] })
      queryClient.invalidateQueries({ queryKey: ['auditEvents'] })
      const verb =
        vars.decision === 'approved'
          ? 'Approved'
          : vars.decision === 'denied'
            ? 'Denied'
            : 'Approved with condition'
      toast.success(`${verb}`)
    },
    onError: async (err) => {
      // On a stale-version conflict, force a refetch (not just invalidate)
      // so the approval cards re-render with the new version BEFORE the
      // user clicks retry. `refetchQueries` blocks on the network round-trip
      // so the next render has fresh `approval.version` in scope, and the
      // user's next click sends the correct `If-Match`.
      if (err instanceof ApprovalConflictError) {
        await queryClient.refetchQueries({ queryKey: ['approvals'], type: 'active' })
        toast.warning('Approval changed since you loaded it', {
          description: 'Refreshed — review the new state and try again.',
        })
        return
      }
      toast.error('Could not save decision', { description: readableError(err) })
    },
  })
}

/**
 * Attach a free-text note to an approval. Used during triage to capture
 * rationale or ask for clarification before deciding.
 */
export function useApprovalAddNote() {
  const queryClient = useQueryClient()
  return useMutation<{ note: { id: string; content: string; actor: string; createdAt: string } }, Error, { id: string; content: string }>({
    mutationFn: async ({ id, content }) => {
      return apiFetch(`/approvals/${id}/note`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['approvals'] })
      queryClient.invalidateQueries({ queryKey: ['auditEvents'] })
      toast.success('Note added')
    },
    onError: (err) => {
      toast.error('Could not add note', { description: readableError(err) })
    },
  })
}

/**
 * Edit an existing approval note. Only original author or admin allowed
 * server-side; UI gates the affordance the same way.
 */
export function useEditApprovalNote() {
  const queryClient = useQueryClient()
  return useMutation<unknown, Error, { id: string; noteId: string; content: string }>({
    mutationFn: async ({ id, noteId, content }) => {
      return apiFetch(`/approvals/${id}/note/${noteId}`, {
        method: 'PATCH',
        body: JSON.stringify({ content }),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['approvals'] })
      queryClient.invalidateQueries({ queryKey: ['auditEvents'] })
      toast.success('Note updated')
    },
    onError: (err) => {
      toast.error('Could not update note', { description: readableError(err) })
    },
  })
}

/**
 * Soft-delete an approval note. Author or admin only.
 */
export function useDeleteApprovalNote() {
  const queryClient = useQueryClient()
  return useMutation<unknown, Error, { id: string; noteId: string }>({
    mutationFn: async ({ id, noteId }) => {
      return apiFetch(`/approvals/${id}/note/${noteId}`, { method: 'DELETE' })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['approvals'] })
      queryClient.invalidateQueries({ queryKey: ['auditEvents'] })
      toast.success('Note deleted')
    },
    onError: (err) => {
      toast.error('Could not delete note', { description: readableError(err) })
    },
  })
}

/**
 * Escalate an approval to a senior reviewer. Bumps version, sets status to
 * `escalated`, writes audit + note with reason.
 */
export function useApprovalEscalate() {
  const queryClient = useQueryClient()
  return useMutation<{ approval: unknown }, Error, { id: string; reason: string; expectedVersion?: number }>({
    mutationFn: async ({ id, reason, expectedVersion }) => {
      try {
        return await apiFetch(`/approvals/${id}/escalate`, {
          method: 'POST',
          headers:
            typeof expectedVersion === 'number'
              ? { 'If-Match': `"${expectedVersion}"` }
              : undefined,
          body: JSON.stringify({ reason, expectedVersion }),
        })
      } catch (err) {
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
      queryClient.invalidateQueries({ queryKey: ['approvals'] })
      queryClient.invalidateQueries({ queryKey: ['auditEvents'] })
      toast.success('Escalated to senior reviewer')
    },
    onError: async (err) => {
      if (err instanceof ApprovalConflictError) {
        await queryClient.refetchQueries({ queryKey: ['approvals'], type: 'active' })
        toast.warning('Approval changed since you loaded it', {
          description: 'Refreshed — review the new state and try again.',
        })
        return
      }
      toast.error('Could not escalate', { description: readableError(err) })
    },
  })
}

// ─── Change Mutations ───────────────────────────────────

/**
 * Execute (deploy) a change. Policy engine validates.
 */
export function useChangeExecute() {
  const queryClient = useQueryClient()

  return useMutation<ChangeExecuteResult, Error, { changeId: string; expectedVersion?: number }>({
    mutationFn: async ({ changeId, expectedVersion }) => {
      return apiFetch<ChangeExecuteResult>(`/changes/${changeId}/execute`, {
        method: 'POST',
        headers:
          typeof expectedVersion === 'number'
            ? { 'If-Match': `"${expectedVersion}"` }
            : undefined,
        body: JSON.stringify({ expectedVersion }),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['changes'] })
      queryClient.invalidateQueries({ queryKey: ['auditEvents'] })
      toast.success('Change executed')
    },
    onError: async (err) => {
      if (err instanceof ApiError && err.status === 412) {
        await queryClient.refetchQueries({ queryKey: ['changes'], type: 'active' })
        toast.warning('Change updated since you loaded it', {
          description: 'Refreshed — review and retry.',
        })
        return
      }
      toast.error('Could not execute change', { description: readableError(err) })
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
      toast.success('Simulation complete')
    },
    onError: (err) => {
      toast.error('Simulation failed', { description: readableError(err) })
    },
  })
}

/**
 * Escalate a change.
 */
export function useChangeEscalate() {
  const queryClient = useQueryClient()

  return useMutation<Change, Error, { changeId: string; reason?: string; expectedVersion?: number }>({
    mutationFn: async ({ changeId, reason, expectedVersion }) => {
      return apiFetch<Change>(`/changes/${changeId}/escalate`, {
        method: 'POST',
        headers:
          typeof expectedVersion === 'number'
            ? { 'If-Match': `"${expectedVersion}"` }
            : undefined,
        body: JSON.stringify({ reason, expectedVersion }),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['changes'] })
      queryClient.invalidateQueries({ queryKey: ['auditEvents'] })
      toast.success('Change escalated')
    },
    onError: async (err) => {
      if (err instanceof ApiError && err.status === 412) {
        await queryClient.refetchQueries({ queryKey: ['changes'], type: 'active' })
        toast.warning('Change updated since you loaded it', {
          description: 'Refreshed — review and retry.',
        })
        return
      }
      toast.error('Could not escalate', { description: readableError(err) })
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
    mutationFn: async ({ id, decision, role, expectedVersion }) => {
      return apiFetch<AccessRequest>(`/access-requests/${id}/decide`, {
        method: 'POST',
        headers:
          typeof expectedVersion === 'number'
            ? { 'If-Match': `"${expectedVersion}"` }
            : undefined,
        body: JSON.stringify({ decision, role, expectedVersion }),
      })
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['accessRequests'] })
      queryClient.invalidateQueries({ queryKey: ['approvals'] })
      queryClient.invalidateQueries({ queryKey: ['auditEvents'] })
      toast.success(`Access request ${vars.decision}`)
    },
    onError: async (err) => {
      if (err instanceof ApiError && err.status === 412) {
        await queryClient.refetchQueries({ queryKey: ['accessRequests'], type: 'active' })
        toast.warning('Request updated since you loaded it', {
          description: 'Refreshed — review and retry.',
        })
        return
      }
      toast.error('Could not record decision', { description: readableError(err) })
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
    mutationFn: async ({ id, status, expectedVersion }) => {
      return apiFetch<Incident>(`/incidents/${id}/update-status`, {
        method: 'POST',
        headers:
          typeof expectedVersion === 'number'
            ? { 'If-Match': `"${expectedVersion}"` }
            : undefined,
        body: JSON.stringify({ status, expectedVersion }),
      })
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] })
      queryClient.invalidateQueries({ queryKey: ['auditEvents'] })
      toast.success(`Incident → ${vars.status}`)
    },
    onError: async (err) => {
      if (err instanceof ApiError && err.status === 412) {
        await queryClient.refetchQueries({ queryKey: ['incidents'], type: 'active' })
        toast.warning('Incident updated since you loaded it', {
          description: 'Refreshed — review and retry.',
        })
        return
      }
      toast.error('Could not update incident', { description: readableError(err) })
    },
  })
}

/**
 * Attach a note (work_note or customer_reply) to an incident.
 */
export function useIncidentAddNote() {
  const queryClient = useQueryClient()
  return useMutation<unknown, Error, { id: string; content: string; kind?: 'work_note' | 'customer_reply' }>({
    mutationFn: async ({ id, content, kind }) => {
      return apiFetch(`/incidents/${id}/note`, {
        method: 'POST',
        body: JSON.stringify({ content, kind }),
      })
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] })
      queryClient.invalidateQueries({ queryKey: ['auditEvents'] })
      toast.success(vars.kind === 'customer_reply' ? 'Customer reply drafted' : 'Work note added')
    },
    onError: (err) => toast.error('Could not add note', { description: readableError(err) }),
  })
}

export function useIncidentEditNote() {
  const queryClient = useQueryClient()
  return useMutation<unknown, Error, { id: string; noteId: string; content: string }>({
    mutationFn: async ({ id, noteId, content }) => {
      return apiFetch(`/incidents/${id}/note/${noteId}`, {
        method: 'PATCH',
        body: JSON.stringify({ content }),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] })
      queryClient.invalidateQueries({ queryKey: ['auditEvents'] })
      toast.success('Note updated')
    },
    onError: (err) => toast.error('Could not update note', { description: readableError(err) }),
  })
}

export function useIncidentDeleteNote() {
  const queryClient = useQueryClient()
  return useMutation<unknown, Error, { id: string; noteId: string }>({
    mutationFn: async ({ id, noteId }) => apiFetch(`/incidents/${id}/note/${noteId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] })
      queryClient.invalidateQueries({ queryKey: ['auditEvents'] })
      toast.success('Note deleted')
    },
    onError: (err) => toast.error('Could not delete note', { description: readableError(err) }),
  })
}

export function useIncidentEscalate() {
  const queryClient = useQueryClient()
  return useMutation<unknown, Error, { id: string; reason: string; expectedVersion?: number }>({
    mutationFn: async ({ id, reason, expectedVersion }) =>
      apiFetch(`/incidents/${id}/escalate`, {
        method: 'POST',
        headers:
          typeof expectedVersion === 'number'
            ? { 'If-Match': `"${expectedVersion}"` }
            : undefined,
        body: JSON.stringify({ reason, expectedVersion }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] })
      queryClient.invalidateQueries({ queryKey: ['auditEvents'] })
      toast.success('Incident escalated')
    },
    onError: async (err) => {
      if (err instanceof ApiError && err.status === 412) {
        await queryClient.refetchQueries({ queryKey: ['incidents'], type: 'active' })
        toast.warning('Incident updated since you loaded it', {
          description: 'Refreshed — review and retry.',
        })
        return
      }
      toast.error('Could not escalate', { description: readableError(err) })
    },
  })
}

export function useIncidentRoute() {
  const queryClient = useQueryClient()
  return useMutation<unknown, Error, { id: string; team: string }>({
    mutationFn: async ({ id, team }) =>
      apiFetch(`/incidents/${id}/route`, {
        method: 'POST',
        body: JSON.stringify({ team }),
      }),
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] })
      queryClient.invalidateQueries({ queryKey: ['auditEvents'] })
      toast.success(`Routed to ${vars.team}`)
    },
    onError: (err) => toast.error('Could not route', { description: readableError(err) }),
  })
}

export function useIncidentLinkKB() {
  const queryClient = useQueryClient()
  return useMutation<unknown, Error, { id: string; kbArticleId: string }>({
    mutationFn: async ({ id, kbArticleId }) =>
      apiFetch(`/incidents/${id}/link-kb`, {
        method: 'POST',
        body: JSON.stringify({ kbArticleId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] })
      queryClient.invalidateQueries({ queryKey: ['auditEvents'] })
      toast.success('KB article linked')
    },
    onError: (err) => toast.error('Could not link KB', { description: readableError(err) }),
  })
}

export function useIncidentUnlinkKB() {
  const queryClient = useQueryClient()
  return useMutation<unknown, Error, { id: string; kbArticleId: string }>({
    mutationFn: async ({ id, kbArticleId }) =>
      apiFetch(`/incidents/${id}/unlink-kb`, {
        method: 'POST',
        body: JSON.stringify({ kbArticleId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] })
      queryClient.invalidateQueries({ queryKey: ['auditEvents'] })
      toast.success('KB article unlinked')
    },
    onError: (err) => toast.error('Could not unlink KB', { description: readableError(err) }),
  })
}

export function useIncidentMarkAwaiting() {
  const queryClient = useQueryClient()
  return useMutation<unknown, Error, { id: string; awaiting: boolean }>({
    mutationFn: async ({ id, awaiting }) =>
      apiFetch(`/incidents/${id}/mark-awaiting`, {
        method: 'POST',
        body: JSON.stringify({ awaiting }),
      }),
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] })
      queryClient.invalidateQueries({ queryKey: ['auditEvents'] })
      toast.success(vars.awaiting ? 'Marked awaiting approval' : 'Cleared awaiting state')
    },
    onError: (err) => toast.error('Could not update', { description: readableError(err) }),
  })
}

export function useIncidentSendDraft() {
  const queryClient = useQueryClient()
  return useMutation<unknown, Error, { id: string }>({
    mutationFn: async ({ id }) =>
      apiFetch(`/incidents/${id}/draft-response/send`, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] })
      queryClient.invalidateQueries({ queryKey: ['auditEvents'] })
      toast.success('Draft sent as customer reply')
    },
    onError: (err) => toast.error('Could not send draft', { description: readableError(err) }),
  })
}

export function useIncidentSaveDraft() {
  const queryClient = useQueryClient()
  return useMutation<unknown, Error, { id: string; draft: string }>({
    mutationFn: async ({ id, draft }) =>
      apiFetch(`/incidents/${id}/draft-response`, {
        method: 'POST',
        body: JSON.stringify({ draft }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] })
      queryClient.invalidateQueries({ queryKey: ['auditEvents'] })
      toast.success('Draft saved')
    },
    onError: (err) => toast.error('Could not save draft', { description: readableError(err) }),
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
      toast.success('Change re-triaged')
    },
    onError: (err) => {
      toast.error('Triage failed', { description: readableError(err) })
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
      toast.success('Incident re-triaged')
    },
    onError: (err) => {
      toast.error('Triage failed', { description: readableError(err) })
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
      toast.success('Access request re-reviewed')
    },
    onError: (err) => {
      toast.error('Review failed', { description: readableError(err) })
    },
  })
}

/**
 * A6 — trigger `propose_bounded_remediation` skill for an incident. Server
 * persists the result onto `incident.proposedRemediations` so subsequent
 * page loads render the picker without re-running the LLM.
 */
export function useProposeRemediation() {
  const queryClient = useQueryClient()
  return useMutation<
    unknown,
    Error,
    { id: string; intent?: 'rollback' | 'config_change' | 'restart' | 'failover' | 'auto_choose'; freeFormHint?: string }
  >({
    mutationFn: async ({ id, intent, freeFormHint }) =>
      apiFetch(`/agents/propose-remediation/${id}`, {
        method: 'POST',
        body: JSON.stringify({ intent: intent ?? 'auto_choose', freeFormHint }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] })
      queryClient.invalidateQueries({ queryKey: ['auditEvents'] })
      toast.success('Remediation options proposed')
    },
    onError: (err) => toast.error('Could not propose options', { description: readableError(err) }),
  })
}

// ─── Policy Rule Mutations ──────────────────────────────

/**
 * Create a new policy rule. Admin-only. Active rules are picked up by
 * agent context on next skill invocation (no extra wiring needed).
 */
export function useCreatePolicyRule() {
  const queryClient = useQueryClient()
  return useMutation<import('@/types').PolicyRule, Error, import('@/types').PolicyRuleInput>({
    mutationFn: async (body) => {
      return apiFetch<import('@/types').PolicyRule>('/policies', {
        method: 'POST',
        body: JSON.stringify(body),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['policies'] })
      queryClient.invalidateQueries({ queryKey: ['auditEvents'] })
      toast.success('Policy rule created')
    },
    onError: (err) => {
      toast.error('Could not create rule', { description: readableError(err) })
    },
  })
}

/**
 * Update an existing policy rule. Admin-only. Optimistic concurrency via
 * `expectedVersion` (sent as both If-Match header and body field).
 */
export function useUpdatePolicyRule() {
  const queryClient = useQueryClient()
  return useMutation<
    import('@/types').PolicyRule,
    Error,
    { id: string } & Partial<import('@/types').PolicyRuleInput>
  >({
    mutationFn: async ({ id, expectedVersion, ...body }) => {
      return apiFetch<import('@/types').PolicyRule>(`/policies/${id}`, {
        method: 'PATCH',
        headers:
          typeof expectedVersion === 'number'
            ? { 'If-Match': `"${expectedVersion}"` }
            : undefined,
        body: JSON.stringify({ ...body, expectedVersion }),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['policies'] })
      queryClient.invalidateQueries({ queryKey: ['auditEvents'] })
      toast.success('Policy rule updated')
    },
    onError: async (err) => {
      if (err instanceof ApiError && err.status === 412) {
        await queryClient.refetchQueries({ queryKey: ['policies'], type: 'active' })
        toast.warning('Rule changed since you loaded it', {
          description: 'Refreshed — review the new state and try again.',
        })
        return
      }
      toast.error('Could not save rule', { description: readableError(err) })
    },
  })
}

/**
 * Disable (soft-delete) a policy rule. Pass `hard: true` to permanently
 * remove the row. Disabled rules are excluded from agent context.
 */
export function useDeletePolicyRule() {
  const queryClient = useQueryClient()
  return useMutation<unknown, Error, { id: string; hard?: boolean }>({
    mutationFn: async ({ id, hard }) => {
      return apiFetch(`/policies/${id}${hard ? '?hard=true' : ''}`, { method: 'DELETE' })
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['policies'] })
      queryClient.invalidateQueries({ queryKey: ['auditEvents'] })
      toast.success(vars.hard ? 'Policy rule deleted' : 'Policy rule disabled')
    },
    onError: (err) => {
      toast.error('Could not remove rule', { description: readableError(err) })
    },
  })
}
