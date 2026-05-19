/**
 * Public surface of the agents system (Phase 9 read-path).
 *
 * Each agent function is callable from a route handler or directly during
 * intake. Agents use the skills runner internally and persist advisory
 * fields + audit events.
 */

export { triageChange } from './change-triage.js'
export type { TriageChangeResult } from './change-triage.js'

export { triageIncident } from './incident-triage.js'
export type { TriageIncidentResult } from './incident-triage.js'

export { reviewAccessRequest } from './access-reviewer.js'
export type { ReviewAccessResult } from './access-reviewer.js'

export { routeApproval } from './approval-router.js'
export type { RouteApprovalResult } from './approval-router.js'

export {
  buildBaseContext,
  loadPolicyBundle,
  loadOrgCatalog,
  loadTemporal,
  loadRoleConstraints,
  loadChangeT2Extras,
  loadIncidentT2Extras,
  loadAuditSlice,
} from './context.js'

export { gateConfidence, DEFAULT_THRESHOLDS, SKILL_THRESHOLDS } from './confidence.js'
export type { ConfidenceCheck, ConfidenceVerdict, ConfidenceThresholds } from './confidence.js'
