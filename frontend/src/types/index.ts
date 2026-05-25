export type RiskLevel = 'critical' | 'high' | 'medium' | 'low'
export type ApprovalState = 'approved' | 'pending' | 'denied' | 'not_required'
export type PolicyDecision = 'allow' | 'deny' | 'escalate' | 'simulate_only'
export type ConfidenceLevel = 'high' | 'medium' | 'low'
export type ExecutionMode = 'read_only' | 'draft' | 'pr_mode' | 'simulate_only' | 'controlled_apply' | 'escalate'
export type ChangeStatus = 'open' | 'in_review' | 'approved' | 'blocked' | 'escalated' | 'deployed' | 'rolled_back'
export type IncidentSeverity = 'sev1' | 'sev2' | 'sev3' | 'sev4'
export type IncidentStatus = 'new' | 'investigating' | 'identified' | 'monitoring' | 'resolved'
export type AccessRequestStatus = 'pending' | 'approved' | 'denied' | 'revoked' | 'expired'
export type RecommendationClass = 'required_now' | 'recommended' | 'optional_optimization' | 'out_of_scope'

export interface Change {
  id: string
  ticketId: string
  title: string
  description: string
  owner: string
  ownerTeam: string
  service: string
  environment: string
  riskLevel: RiskLevel
  status: ChangeStatus
  approvalState: ApprovalState
  policyDecision: PolicyDecision
  linkedPRs: string[]
  ciStatus: 'passing' | 'failing' | 'pending'
  maintenanceWindow: string | null
  /** ISO timestamp — start of approved maintenance window (Phase 0). */
  maintenanceWindowStart: string | null
  /** ISO timestamp — end of approved maintenance window (Phase 0). */
  maintenanceWindowEnd: string | null
  rollbackPlan: boolean
  createdAt: string
  updatedAt: string
  blastRadius: BlastRadiusItem[]
  recommendations: Recommendation[]
  auditEvents: AuditEvent[]
}

export interface BlastRadiusItem {
  id: string
  name: string
  type: 'service' | 'database' | 'api' | 'queue' | 'job' | 'monitoring' | 'integration'
  reason: string
  confidence: ConfidenceLevel
  criticality: RiskLevel
  ownerTeam: string
  details: string
}

export interface Incident {
  id: string
  incidentId: string
  title: string
  description: string
  requester: string
  affectedService: string
  severity: IncidentSeverity
  status: IncidentStatus
  assignmentGroup: string
  relatedCI: string[]
  relatedChanges: string[]
  likelyIssueType: string
  rootCauseCategory: string
  recommendedFix: string
  kbArticles: string[]
  isRecurring: boolean
  createdAt: string
  updatedAt: string
}

export interface AccessRequest {
  id: string
  requestId: string
  requester: string
  requesterEmail: string
  requestedSystem: string
  requestedRole: string
  justification: string
  manager: string
  systemOwner: string
  status: AccessRequestStatus
  riskLevel: RiskLevel
  policyDecision: PolicyDecision
  entitlementCheck: 'eligible' | 'ineligible' | 'review_required'
  autoGrantAllowed: boolean
  managerApprovalRequired: boolean
  ownerApprovalRequired: boolean
  managerApproval: ApprovalState
  ownerApproval: ApprovalState
  reason: string
  createdAt: string
  updatedAt: string
}

export interface CoApproval {
  role: string
  name: string
  status: 'approved' | 'pending' | 'denied'
  decidedAt?: string
}

export interface DecisionImpact {
  approve: string
  deny: string
  escalate: string
}

export interface Approval {
  id: string
  type: 'change' | 'access' | 'remediation' | 'escalation'
  title: string
  requester: string
  impactedSystem: string
  riskLevel: RiskLevel
  reason: string
  recommendedAction: string
  status: 'pending' | 'approved' | 'denied' | 'approved_with_condition'
  condition?: string
  /** Phase 0 — set true once an `approved_with_condition` condition is satisfied. */
  conditionResolved: boolean
  conditionResolvedAt?: string
  conditionResolvedBy?: string
  createdAt: string
  linkedObjectId: string
  coApprovals?: CoApproval[]
  decisionImpact?: DecisionImpact
  whyYouAreRequired?: string
  /** B5 — optimistic-lock version. Echo back via `If-Match` on the next mutation. */
  version: number
}

export interface AuditEvent {
  id: string
  timestamp: string
  actor: string
  action: string
  objectType: 'change' | 'incident' | 'access' | 'policy' | 'execution' | 'approval'
  objectId: string
  objectTitle: string
  policyRule: string | null
  result: 'success' | 'blocked' | 'escalated' | 'denied'
  details: string
}

export interface Recommendation {
  id: string
  title: string
  reason: string
  evidence: string
  classification: RecommendationClass
  expectedBenefit: string
  requiredApprovals: string[]
  executableNow: boolean
  draftOnly: boolean
}

export interface PolicyRule {
  id: string
  name: string
  description: string
  bundle: string
  decision: PolicyDecision
  scope: string
  appliesTo: string[]
  isActive: boolean
}

// ─── Phase 0 additions ──────────────────────────────────

/** Org- or service-scoped freeze window. Execution gate consults active windows. */
export interface FreezeWindow {
  id: string
  name: string
  description: string
  startsAt: string
  endsAt: string
  /** Services or environments this freeze applies to. Empty = global. */
  appliesTo: string[]
  isActive: boolean
  createdAt: string
}

export type AgentInvocationStatus = 'success' | 'validation_failed' | 'error'
export type AgentSkillKind = 'agentic' | 'deterministic' | 'integration'

/** Provenance row for a single agentic skill invocation. */
export interface AgentInvocation {
  id: string
  /** Optional FK to the audit event this invocation produced. */
  auditEventId: string | null
  skill: string
  kind: AgentSkillKind
  model: string
  promptHash: string
  tokensIn: number
  tokensOut: number
  cached: boolean
  latencyMs: number
  confidence: number | null
  status: AgentInvocationStatus
  errorMessage: string | null
  /** Actor name or "system" for autonomous skills. */
  actor: string
  createdAt: string
}
