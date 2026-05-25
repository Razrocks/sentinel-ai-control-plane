/**
 * Zod schemas mirroring the input/output contracts in skills/<name>/skill.md.
 *
 * Strictness:
 *   - Output schemas are the source of truth for validation in the runner.
 *   - Failures convert the runner status to `validation_failed`.
 *   - When a skill spec lists a field as optional, the schema uses `.optional()`.
 *   - When the spec lists "must be one of …", we use `z.enum`.
 */

import { z } from 'zod'

// ─── Shared enums ───────────────────────────────────────

export const RiskLevel = z.enum(['critical', 'high', 'medium', 'low'])
export const PolicyDecision = z.enum(['allow', 'deny', 'escalate', 'simulate_only'])
export const IncidentSeverity = z.enum(['sev1', 'sev2', 'sev3', 'sev4'])
export const IncidentStatus = z.enum(['new', 'investigating', 'identified', 'monitoring', 'resolved'])
export const UserRole = z.enum([
  'operator',
  'engineer',
  'it_support',
  'approver',
  'access_approver',
  'admin',
])
export const Confidence = z.number().min(0).max(1)

// ─── 1. assess_change ───────────────────────────────────

export const AssessChangeInput = z.object({
  change: z.object({
    id: z.string(),
    ticketId: z.string(),
    title: z.string(),
    description: z.string(),
    owner: z.string(),
    ownerTeam: z.string(),
    service: z.string(),
    environment: z.string(),
    riskLevel: RiskLevel,
    linkedPRs: z.array(z.string()),
    ciStatus: z.enum(['passing', 'failing', 'pending']),
    maintenanceWindow: z.string().nullable(),
    maintenanceWindowStart: z.string().nullable(),
    maintenanceWindowEnd: z.string().nullable(),
    rollbackPlan: z.boolean(),
  }),
  prSummaries: z
    .array(
      z.object({
        url: z.string(),
        title: z.string(),
        filesChanged: z.number(),
        additions: z.number(),
        deletions: z.number(),
      }),
    )
    .optional(),
  recentDeploysOnService: z
    .array(
      z.object({
        ticketId: z.string(),
        deployedAt: z.string(),
        result: z.enum(['success', 'rolled_back']),
      }),
    )
    .optional(),
})
export type AssessChangeInput = z.infer<typeof AssessChangeInput>

export const AssessChangeOutput = z.object({
  riskLevel: RiskLevel,
  summary: z.string(),
  riskRationale: z.string(),
  confidence: Confidence,
  signals: z.array(
    z.object({
      kind: z.enum(['service', 'data', 'scope', 'timing', 'reversibility', 'history']),
      severity: z.enum(['positive', 'neutral', 'negative']),
      note: z.string(),
    }),
  ),
})
export type AssessChangeOutput = z.infer<typeof AssessChangeOutput>

// ─── 2. analyze_blast_radius ────────────────────────────

const BlastRadiusType = z.enum([
  'service',
  'database',
  'api',
  'queue',
  'job',
  'monitoring',
  'integration',
])

export const AnalyzeBlastRadiusInput = z.object({
  change: z.object({
    id: z.string(),
    ticketId: z.string(),
    title: z.string(),
    description: z.string(),
    service: z.string(),
    environment: z.string(),
    linkedPRs: z.array(z.string()),
  }),
  candidates: z.array(
    z.object({
      name: z.string(),
      type: BlastRadiusType,
      sourceOfDiscovery: z.enum(['pr_files', 'service_catalog', 'recent_audit', 'manual']),
      rawSignal: z.string(),
      ownerTeam: z.string().optional(),
    }),
  ),
  serviceCatalogSnippet: z.record(
    z.string(),
    z.object({
      team: z.string(),
      criticality: RiskLevel,
      downstream: z.array(z.string()),
    }),
  ),
})
export type AnalyzeBlastRadiusInput = z.infer<typeof AnalyzeBlastRadiusInput>

export const AnalyzeBlastRadiusOutput = z.object({
  items: z.array(
    z.object({
      name: z.string(),
      type: BlastRadiusType,
      reason: z.string(),
      confidence: z.enum(['high', 'medium', 'low']),
      criticality: RiskLevel,
      ownerTeam: z.string(),
      details: z.string(),
    }),
  ),
  excluded: z.array(z.object({ name: z.string(), reason: z.string() })),
  notes: z.string(),
})
export type AnalyzeBlastRadiusOutput = z.infer<typeof AnalyzeBlastRadiusOutput>

// ─── 3. triage_incident ─────────────────────────────────

export const TriageIncidentInput = z.object({
  incident: z.object({
    id: z.string(),
    incidentId: z.string(),
    title: z.string(),
    description: z.string(),
    requester: z.string(),
    affectedService: z.string(),
    severity: IncidentSeverity,
    assignmentGroup: z.string(),
    relatedCI: z.array(z.string()),
    isRecurring: z.boolean(),
  }),
  recentDeploysOnService: z
    .array(z.object({ ticketId: z.string(), deployedAt: z.string(), result: z.string() }))
    .optional(),
  recentIncidentsOnService: z
    .array(
      z.object({
        incidentId: z.string(),
        rootCauseCategory: z.string(),
        resolvedAt: z.string(),
      }),
    )
    .optional(),
  candidateKbArticles: z
    .array(z.object({ id: z.string(), title: z.string(), snippet: z.string() }))
    .optional(),
})
export type TriageIncidentInput = z.infer<typeof TriageIncidentInput>

export const TriageIncidentOutput = z.object({
  severity: IncidentSeverity,
  severityChanged: z.boolean(),
  severityRationale: z.string(),
  likelyIssueType: z.string(),
  rootCauseCategory: z.enum([
    'deploy-correlated',
    'infra',
    'data',
    'config',
    'external-dependency',
    'unknown',
  ]),
  recommendedFix: z.string(),
  kbArticles: z.array(
    z.object({
      id: z.string(),
      relevance: z.enum(['high', 'medium', 'low']),
      reason: z.string(),
    }),
  ),
  relatedChanges: z.array(z.string()),
  isRecurring: z.boolean(),
  confidence: Confidence,
})
export type TriageIncidentOutput = z.infer<typeof TriageIncidentOutput>

// ─── 4. evaluate_access_request ─────────────────────────

export const EvaluateAccessRequestInput = z.object({
  request: z.object({
    id: z.string(),
    requestId: z.string(),
    requester: z.string(),
    requesterEmail: z.string(),
    requestedSystem: z.string(),
    requestedRole: z.string(),
    justification: z.string(),
    manager: z.string(),
    systemOwner: z.string(),
    riskLevel: RiskLevel,
    entitlementCheck: z.enum(['eligible', 'ineligible', 'review_required']),
  }),
  requesterContext: z.object({
    role: UserRole,
    team: z.string(),
    managerId: z.string().nullable(),
    systemsOwned: z.array(z.string()),
    pastRequests: z.array(
      z.object({
        requestId: z.string(),
        system: z.string(),
        role: z.string(),
        status: z.string(),
        resolvedAt: z.string(),
      }),
    ),
  }),
  systemContext: z.object({
    catalogTier: RiskLevel,
    rolePrivilegeLevel: z.enum(['read', 'write', 'admin']),
    activeFreezeAffectingSystem: z.boolean(),
  }),
})
export type EvaluateAccessRequestInput = z.infer<typeof EvaluateAccessRequestInput>

export const EvaluateAccessRequestOutput = z.object({
  riskLevel: RiskLevel,
  justificationQuality: z.enum(['strong', 'adequate', 'weak', 'insufficient']),
  narrative: z.string(),
  flags: z.array(
    z.object({
      kind: z.enum([
        'unusual_role',
        'unusual_system',
        'time_bounded_recommended',
        'scope_too_broad',
        'recent_denial',
        'no_prior_history',
        'freeze_active',
      ]),
      severity: z.enum(['info', 'warn', 'block']),
      note: z.string(),
    }),
  ),
  recommendedTimeBound: z.string().nullable(),
  confidence: Confidence,
})
export type EvaluateAccessRequestOutput = z.infer<typeof EvaluateAccessRequestOutput>

// ─── 5. support_approval_decision ───────────────────────

export const SupportApprovalDecisionInput = z.object({
  approval: z.object({
    id: z.string(),
    type: z.enum(['change', 'access', 'remediation', 'escalation']),
    title: z.string(),
    requester: z.string(),
    impactedSystem: z.string(),
    riskLevel: RiskLevel,
    reason: z.string(),
    recommendedAction: z.string(),
    linkedObjectId: z.string(),
    coApprovals: z.array(
      z.object({
        role: z.string(),
        name: z.string(),
        status: z.enum(['approved', 'pending', 'denied']),
      }),
    ),
  }),
  linkedEntity: z.object({
    type: z.string(),
    data: z.unknown(),
  }),
  policyContext: z.object({
    activePolicyRules: z.array(
      z.object({
        name: z.string(),
        description: z.string(),
        decision: PolicyDecision,
      }),
    ),
    activeFreezesAffecting: z.array(z.string()),
  }),
})
export type SupportApprovalDecisionInput = z.infer<typeof SupportApprovalDecisionInput>

export const SupportApprovalDecisionOutput = z.object({
  approve: z.string(),
  deny: z.string(),
  escalate: z.string(),
  whyEachApproverIsRequired: z.array(
    z.object({ role: z.string(), name: z.string(), why: z.string() }),
  ),
})
export type SupportApprovalDecisionOutput = z.infer<typeof SupportApprovalDecisionOutput>

// ─── 6. route_request ───────────────────────────────────

export const RouteRequestInput = z.object({
  entity: z.object({
    type: z.enum(['change', 'access', 'remediation', 'escalation']),
    id: z.string(),
    title: z.string(),
    relevantFields: z.record(z.string(), z.unknown()),
  }),
  policyContext: z.object({
    requiredApproverRoles: z.array(z.string()),
    activeFreezesAffecting: z.array(z.string()),
  }),
  orgCatalog: z.object({
    usersByRole: z.record(
      z.string(),
      z.array(z.object({ id: z.string(), name: z.string(), team: z.string() })),
    ),
    serviceOwners: z.record(
      z.string(),
      z.array(z.object({ id: z.string(), name: z.string(), team: z.string() })),
    ),
    managerHierarchy: z.record(z.string(), z.string().nullable()),
  }),
  filerName: z.string().optional(),
  mode: z.enum(['construct_chain', 'explain_chain']),
})
export type RouteRequestInput = z.infer<typeof RouteRequestInput>

export const RouteRequestOutput = z.object({
  participants: z.array(
    z.object({
      role: z.string(),
      name: z.string(),
      userId: z.string(),
      why: z.string(),
      isFiler: z.boolean(),
    }),
  ),
  chainNotes: z.string(),
  unresolvedRoles: z.array(z.string()),
})
export type RouteRequestOutput = z.infer<typeof RouteRequestOutput>

// ─── 7. propose_bounded_remediation ─────────────────────

export const ProposeBoundedRemediationInput = z.object({
  incident: z.object({
    id: z.string(),
    incidentId: z.string(),
    title: z.string(),
    description: z.string(),
    affectedService: z.string(),
    severity: IncidentSeverity,
    likelyIssueType: z.string().optional(),
    rootCauseCategory: z.string().optional(),
    relatedChanges: z.array(z.string()).optional(),
  }),
  authorContext: z.object({
    name: z.string(),
    role: UserRole,
    team: z.string(),
    systemsOwned: z.array(z.string()),
  }),
  intent: z.enum(['rollback', 'config_change', 'restart', 'failover', 'auto_choose']),
  freeFormHint: z.string().optional(),
})
export type ProposeBoundedRemediationInput = z.infer<typeof ProposeBoundedRemediationInput>

// A6 — multi-option proposals. The skill now returns 2-3 ranked options so
// the approver can choose between alternatives instead of accepting or
// rejecting a single take-it-or-leave-it proposal. The model picks one as
// `recommended`, but the caller (and ultimately the approver) may approve
// any of them. Persistence: every option is stored; the approver's chosen
// option id is recorded on the resulting Change/Approval.
const RemediationOption = z.object({
  /** Short stable id used by the approver UI when selecting. e.g. "opt-a". */
  id: z.string(),
  /** Human-readable name for the option, distinct from title. e.g. "Roll back to v2.4". */
  label: z.string(),
  /** Why this option is in the list (1-2 sentences). Distinct from rollbackPlan. */
  optionRationale: z.string(),
  /**
   * Trade-off relative to the recommended option, from the approver's POV.
   * "baseline-recommended" is reserved for the option matching
   * recommendedOptionId; all others must use one of the comparison values.
   */
  riskDelta: z.enum([
    'lower-risk-slower',
    'higher-risk-faster',
    'equivalent-different-tradeoff',
    'baseline-recommended',
  ]),
  title: z.string(),
  description: z.string(),
  targetService: z.string(),
  environment: z.string(),
  changeType: z.enum(['rollback', 'config_change', 'restart', 'failover']),
  estimatedRiskLevel: RiskLevel,
  estimatedBlastRadius: z.array(
    z.object({ name: z.string(), type: z.string(), reason: z.string() }),
  ),
  rollbackPlan: z.string(),
  rollbackTested: z.boolean(),
  suggestedMaintenanceWindow: z.string().nullable(),
})
export type RemediationOption = z.infer<typeof RemediationOption>

export const ProposeBoundedRemediationOutput = z.object({
  /** 2-3 options ranked by the model. min(1) for degraded scenarios. */
  options: z.array(RemediationOption).min(1).max(3),
  /** Must match exactly one options[].id — the model's pick. */
  recommendedOptionId: z.string(),
  /** Why this option set + why the recommendation. 2-4 sentences. */
  rationale: z.string(),
  dependencies: z.array(z.string()),
  warnings: z.array(
    z.object({
      severity: z.enum(['info', 'warn', 'block']),
      note: z.string(),
    }),
  ),
  confidence: Confidence,
})
export type ProposeBoundedRemediationOutput = z.infer<typeof ProposeBoundedRemediationOutput>

// ─── 8. draft_approval_packet ───────────────────────────

export const DraftApprovalPacketInput = z.object({
  change: z.object({
    id: z.string(),
    ticketId: z.string(),
    title: z.string(),
    description: z.string(),
    owner: z.string(),
    service: z.string(),
    environment: z.string(),
    riskLevel: RiskLevel,
    blastRadius: z.array(z.unknown()).optional(),
    recommendations: z.array(z.unknown()).optional(),
    maintenanceWindow: z.string().nullable().optional(),
    rollbackPlan: z.boolean().optional(),
  }),
  approval: z
    .object({
      id: z.string(),
      coApprovals: z.array(
        z.object({ role: z.string(), name: z.string(), status: z.string() }),
      ),
      decisionImpact: z.object({
        approve: z.string(),
        deny: z.string(),
        escalate: z.string(),
      }),
    })
    .nullable(),
  policyContext: z.object({
    policyDecision: PolicyDecision,
    matchedRule: z.string().nullable(),
    activeFreezesAffecting: z.array(z.string()),
  }),
  audience: z.enum(['self_review', 'peer_review', 'approver_review']),
})
export type DraftApprovalPacketInput = z.infer<typeof DraftApprovalPacketInput>

export const DraftApprovalPacketOutput = z.object({
  title: z.string(),
  oneLineSummary: z.string(),
  sections: z.object({
    whatChanges: z.string(),
    whyNow: z.string(),
    blastRadiusSummary: z.string(),
    riskPosture: z.string(),
    rollbackPlan: z.string(),
    policyPosture: z.string(),
    approvalChain: z.string(),
    openQuestions: z.string(),
  }),
  recommendation: z.enum([
    'approve',
    'approve_with_condition',
    'investigate_further',
    'deny',
  ]),
  recommendationRationale: z.string(),
})
export type DraftApprovalPacketOutput = z.infer<typeof DraftApprovalPacketOutput>

// ─── 9. draft_work_note ─────────────────────────────────

export const DraftWorkNoteInput = z.object({
  incident: z.object({
    id: z.string(),
    incidentId: z.string(),
    title: z.string(),
    description: z.string(),
    affectedService: z.string(),
    severity: IncidentSeverity,
    status: IncidentStatus,
    assignmentGroup: z.string(),
    likelyIssueType: z.string(),
    rootCauseCategory: z.string(),
    relatedChanges: z.array(z.string()),
    isRecurring: z.boolean(),
  }),
  authorContext: z.object({
    name: z.string(),
    role: UserRole,
    team: z.string(),
  }),
  intent: z.enum([
    'initial_triage',
    'investigation_update',
    'identified',
    'monitoring',
    'resolution',
  ]),
  customNotes: z.string().optional(),
})
export type DraftWorkNoteInput = z.infer<typeof DraftWorkNoteInput>

export const DraftWorkNoteOutput = z.object({
  workNote: z.string(),
  nextUpdateTimeRecommended: z.string(),
  audience: z.enum(['on_call', 'assignment_group', 'incident_commander']),
})
export type DraftWorkNoteOutput = z.infer<typeof DraftWorkNoteOutput>

// ─── 10. draft_customer_response ────────────────────────

export const DraftCustomerResponseInput = z.object({
  incident: z.object({
    incidentId: z.string(),
    title: z.string(),
    description: z.string(),
    affectedService: z.string(),
    severity: IncidentSeverity,
    status: IncidentStatus,
    likelyIssueType: z.string(),
    customerImpactSummary: z.string().optional(),
  }),
  channel: z.enum(['status_page', 'support_reply', 'email_blast', 'social_media_short']),
  intent: z.enum([
    'initial_acknowledgement',
    'investigating',
    'identified',
    'workaround_available',
    'resolved',
  ]),
  customerContext: z
    .object({
      audienceType: z.enum(['all_customers', 'enterprise_only', 'specific_account']),
      knownAffectedFeatures: z.array(z.string()),
    })
    .optional(),
})
export type DraftCustomerResponseInput = z.infer<typeof DraftCustomerResponseInput>

export const DraftCustomerResponseOutput = z.object({
  body: z.string(),
  subject: z.string().optional(),
  toneCheck: z.enum(['pass', 'review_recommended']),
  toneNotes: z.string(),
})
export type DraftCustomerResponseOutput = z.infer<typeof DraftCustomerResponseOutput>

// ─── 11. explain_policy_decision ────────────────────────

export const ExplainPolicyDecisionInput = z.object({
  decision: PolicyDecision,
  matchedRule: z
    .object({
      name: z.string(),
      description: z.string(),
      bundle: z.string(),
      scope: z.string(),
      appliesTo: z.array(z.string()),
    })
    .nullable(),
  context: z.object({
    objectType: z.enum(['change', 'incident', 'access', 'execution', 'approval']),
    objectId: z.string(),
    objectTitle: z.string(),
    relevantFields: z.record(z.string(), z.unknown()),
  }),
  audience: z.object({
    role: UserRole,
    name: z.string(),
  }),
  whatWouldUnblock: z.string().optional(),
})
export type ExplainPolicyDecisionInput = z.infer<typeof ExplainPolicyDecisionInput>

export const ExplainPolicyDecisionOutput = z.object({
  oneLineSummary: z.string(),
  ruleNameDisplay: z.string(),
  whyExplanation: z.string(),
  whatWouldUnblock: z.string(),
  nextStep: z.string(),
  tone: z.enum(['neutral', 'firm']),
})
export type ExplainPolicyDecisionOutput = z.infer<typeof ExplainPolicyDecisionOutput>

// ─── 12. summarize_decision_impact ──────────────────────

export const SummarizeDecisionImpactInput = z.object({
  approval: z.object({
    id: z.string(),
    type: z.enum(['change', 'access', 'remediation', 'escalation']),
    title: z.string(),
    riskLevel: RiskLevel,
    decisionImpact: z.object({
      approve: z.string(),
      deny: z.string(),
      escalate: z.string(),
    }),
    coApprovals: z.array(
      z.object({ role: z.string(), name: z.string(), status: z.string() }),
    ),
    condition: z.string().nullable(),
  }),
  format: z.enum(['one_line', 'paragraph', 'three_options']),
  emphasize: z.enum(['approve', 'deny', 'escalate']).nullable().optional(),
})
export type SummarizeDecisionImpactInput = z.infer<typeof SummarizeDecisionImpactInput>

export const SummarizeDecisionImpactOutput = z.object({
  summary: z.string(),
  recommendedReadingOrder: z
    .array(z.enum(['approve', 'deny', 'escalate']))
    .optional(),
})
export type SummarizeDecisionImpactOutput = z.infer<typeof SummarizeDecisionImpactOutput>
