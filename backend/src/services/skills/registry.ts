/**
 * Skill registry — single source of truth for the 12 v1 skills.
 *
 * Each entry binds:
 *   - the skill's name and kind (agentic / deterministic / integration)
 *   - the model + temperature + token budget per its skill.md spec
 *   - input + output Zod schemas (from schemas.ts)
 *   - a `buildPrompt` closure that composes the system prompt from context
 *     tiers and renders the input as the user message
 *   - the audit action string the calling service should emit
 *
 * The runner (runner.ts) consumes SkillSpec entries via `getSkill(name)`.
 */

import type { SkillName, SkillSpec, SkillContext } from './types.js'
import { buildSystemPrompt, renderInputAsJson } from './prompt.js'
import * as S from './schemas.js'

// ─── Helpers ────────────────────────────────────────────

function makeBuildPrompt<T>(taskInstructions: string, opts?: {
  excludePolicy?: boolean
  excludeRole?: boolean
  excludeOrgCatalog?: boolean
  excludeT4?: boolean
  excludeT5?: boolean
  servicesFilter?: (input: T) => string[] | undefined
}) {
  return (input: T, ctx: SkillContext) => {
    const orgCatalogServices = opts?.servicesFilter ? opts.servicesFilter(input) : undefined
    const system = buildSystemPrompt(ctx, {
      includePolicy: !opts?.excludePolicy,
      includeRole: !opts?.excludeRole,
      includeOrgCatalog: !opts?.excludeOrgCatalog,
      orgCatalogServices,
      includeT4: !opts?.excludeT4,
      includeT5: !opts?.excludeT5,
      taskInstructions,
    })
    const user = renderInputAsJson(input)
    return { system, user }
  }
}

// ─── Skill specs ────────────────────────────────────────

const assess_change: SkillSpec<S.AssessChangeInput, S.AssessChangeOutput> = {
  name: 'assess_change',
  kind: 'agentic',
  model: 'claude-sonnet-4-20250514',
  temperature: 0.1,
  maxInputTokens: 6000,
  maxOutputTokens: 600,
  inputSchema: S.AssessChangeInput,
  outputSchema: S.AssessChangeOutput,
  auditAction: 'change_assessed',
  purpose:
    'Classify the risk of a change (critical/high/medium/low) with a 1-2 sentence summary, ' +
    '2-4 sentence rationale, confidence, and contributing signals. Advisory only.',
  buildPrompt: makeBuildPrompt<S.AssessChangeInput>(
    [
      'Classify the risk of this change. Read input.change and produce a NEW JSON object with these EXACT fields:',
      '',
      '{',
      '  "riskLevel": "critical" | "high" | "medium" | "low",',
      '  "summary": "<1-2 sentences in plain English describing what the change does>",',
      '  "riskRationale": "<2-4 sentences explaining why you chose that risk class>",',
      '  "confidence": <number 0.0 to 1.0>,',
      '  "signals": [',
      '    { "kind": "service"|"data"|"scope"|"timing"|"reversibility"|"history", "severity": "positive"|"neutral"|"negative", "note": "<short note>" }',
      '  ]',
      '}',
      '',
      'Risk class definitions:',
      '- critical: production data loss possible; affects multiple services; no rollback; or schema change with active traffic.',
      '- high: production write to a critical service; large blast radius; in-flight during freeze; or risky rollback.',
      '- medium: production write to non-critical service with rollback; staging change with broad impact; or known-fragile area.',
      '- low: read-only; staging-only; or contained-blast configuration change with rollback.',
    ].join('\n'),
    {
      servicesFilter: (input) => [input.change.service],
    },
  ),
}

const analyze_blast_radius: SkillSpec<
  S.AnalyzeBlastRadiusInput,
  S.AnalyzeBlastRadiusOutput
> = {
  name: 'analyze_blast_radius',
  kind: 'agentic',
  model: 'claude-sonnet-4-20250514',
  temperature: 0.1,
  maxInputTokens: 7000,
  maxOutputTokens: 1500,
  inputSchema: S.AnalyzeBlastRadiusInput,
  outputSchema: S.AnalyzeBlastRadiusOutput,
  auditAction: 'blast_radius_computed',
  purpose:
    'Filter, classify, and explain a deterministic discovery output: for each candidate, ' +
    'decide if it is genuinely affected by the change and produce a confidence + criticality + reason.',
  buildPrompt: makeBuildPrompt<S.AnalyzeBlastRadiusInput>(
    [
      'Read input.candidates and input.serviceCatalogSnippet. Produce a NEW JSON object with these EXACT fields:',
      '',
      '{',
      '  "items": [',
      '    {',
      '      "name": "<must equal one candidate.name from input>",',
      '      "type": "service"|"database"|"api"|"queue"|"job"|"monitoring"|"integration",',
      '      "reason": "<1 sentence>",',
      '      "confidence": "high"|"medium"|"low",',
      '      "criticality": "critical"|"high"|"medium"|"low",',
      '      "ownerTeam": "<team name>",',
      '      "details": "<2-3 sentences>"',
      '    }',
      '  ],',
      '  "excluded": [ { "name": "<candidate.name>", "reason": "<why filtered out>" } ],',
      '  "notes": "<optional free text or empty string>"',
      '}',
      '',
      'Rules:',
      '- Every input candidate must appear in EITHER items OR excluded (never both, never neither).',
      '- items.length + excluded.length MUST equal input.candidates.length.',
      '- Do NOT invent new candidate names; use only names from input.candidates.',
      '- "confidence" = YOUR confidence the change touches it. "criticality" = the candidate\'s own importance.',
    ].join('\n'),
    {
      servicesFilter: (input) => [input.change.service],
      excludeT5: true,
    },
  ),
}

const triage_incident: SkillSpec<S.TriageIncidentInput, S.TriageIncidentOutput> = {
  name: 'triage_incident',
  kind: 'agentic',
  model: 'claude-sonnet-4-20250514',
  temperature: 0.1,
  maxInputTokens: 6000,
  maxOutputTokens: 700,
  inputSchema: S.TriageIncidentInput,
  outputSchema: S.TriageIncidentOutput,
  auditAction: 'incident_triaged',
  purpose:
    'Triage an incident: revise severity if needed, identify likely issue type and root cause category, ' +
    'recommend a fix advisory, score KB candidate relevance, and surface correlated recent changes.',
  buildPrompt: makeBuildPrompt<S.TriageIncidentInput>(
    [
      'Triage this incident. Produce a NEW JSON object with these EXACT fields:',
      '',
      '{',
      '  "severity": "sev1"|"sev2"|"sev3"|"sev4",',
      '  "severityChanged": <boolean — true if differs from input.incident.severity>,',
      '  "severityRationale": "<1-2 sentences>",',
      '  "likelyIssueType": "<free text>",',
      '  "rootCauseCategory": "deploy-correlated"|"infra"|"data"|"config"|"external-dependency"|"unknown",',
      '  "recommendedFix": "<advisory, 1-2 sentences>",',
      '  "kbArticles": [ { "id": "<must match an id from input.candidateKbArticles>", "relevance": "high"|"medium"|"low", "reason": "<short>" } ],',
      '  "relatedChanges": [ "<ticketId>" ],',
      '  "isRecurring": <boolean>,',
      '  "confidence": <number 0.0 to 1.0>',
      '}',
      '',
      'Rules:',
      '- kbArticles[].id must come from input.candidateKbArticles. Do not invent.',
      '- relatedChanges entries must reference ticketIds visible in input (recentDeploys or known context).',
      '- relatedChanges ranked by likelihood of correlation, most likely first.',
    ].join('\n'),
    {
      servicesFilter: (input) => [input.incident.affectedService],
      excludeRole: true,
    },
  ),
}

const evaluate_access_request: SkillSpec<
  S.EvaluateAccessRequestInput,
  S.EvaluateAccessRequestOutput
> = {
  name: 'evaluate_access_request',
  kind: 'agentic',
  model: 'claude-sonnet-4-20250514',
  temperature: 0.1,
  maxInputTokens: 5000,
  maxOutputTokens: 500,
  inputSchema: S.EvaluateAccessRequestInput,
  outputSchema: S.EvaluateAccessRequestOutput,
  auditAction: 'access_evaluated',
  purpose:
    'Evaluate an access request: produce a risk classification, justification quality, narrative, ' +
    'flags, and recommended time-bound. Does not decide entitlement.',
  buildPrompt: makeBuildPrompt<S.EvaluateAccessRequestInput>(
    [
      'Evaluate this access request. Produce a NEW JSON object with these EXACT fields:',
      '',
      '{',
      '  "riskLevel": "critical"|"high"|"medium"|"low",',
      '  "justificationQuality": "strong"|"adequate"|"weak"|"insufficient",',
      '  "narrative": "<3-5 sentences for the human approvers>",',
      '  "flags": [',
      '    { "kind": "unusual_role"|"unusual_system"|"time_bounded_recommended"|"scope_too_broad"|"recent_denial"|"no_prior_history"|"freeze_active",',
      '      "severity": "info"|"warn"|"block", "note": "<short>" }',
      '  ],',
      '  "recommendedTimeBound": "<ISO 8601 duration e.g. P30D>" | null,',
      '  "confidence": <number 0.0 to 1.0>',
      '}',
      '',
      'Consider system tier × role privilege × requester history × freeze when choosing riskLevel.',
    ].join('\n'),
    {
      servicesFilter: (input) => [input.request.requestedSystem],
    },
  ),
}

const support_approval_decision: SkillSpec<
  S.SupportApprovalDecisionInput,
  S.SupportApprovalDecisionOutput
> = {
  name: 'support_approval_decision',
  kind: 'agentic',
  model: 'claude-sonnet-4-20250514',
  temperature: 0.2,
  maxInputTokens: 4000,
  maxOutputTokens: 500,
  inputSchema: S.SupportApprovalDecisionInput,
  outputSchema: S.SupportApprovalDecisionOutput,
  auditAction: 'decision_impact_generated',
  purpose:
    'Produce three short impact statements (approve / deny / escalate) plus a per-co-approver ' +
    '"why required" reason. Used to populate Approval.decisionImpact at chain construction.',
  buildPrompt: makeBuildPrompt<S.SupportApprovalDecisionInput>(
    [
      'Produce a NEW JSON object with these EXACT fields:',
      '',
      '{',
      '  "approve": "<1-2 sentences. What state transitions, what becomes possible, what timing applies.>",',
      '  "deny": "<1-2 sentences. What returns to the requester, any cooldown, any escalation path.>",',
      '  "escalate": "<1-2 sentences. Where it goes, what the requester sees.>",',
      '  "whyEachApproverIsRequired": [',
      '    { "role": "<from input.approval.coApprovals[].role>", "name": "<from input.approval.coApprovals[].name>", "why": "<1 sentence>" }',
      '  ]',
      '}',
      '',
      'Rules:',
      '- whyEachApproverIsRequired.length MUST equal input.approval.coApprovals.length.',
      '- Use the role + name pairs from input — do not invent.',
    ].join('\n'),
    {
      servicesFilter: (input) => [input.approval.impactedSystem],
      excludeRole: true,
    },
  ),
}

const route_request: SkillSpec<S.RouteRequestInput, S.RouteRequestOutput> = {
  name: 'route_request',
  kind: 'agentic',
  model: 'claude-sonnet-4-20250514',
  temperature: 0.1,
  maxInputTokens: 6000,
  maxOutputTokens: 800,
  inputSchema: S.RouteRequestInput,
  outputSchema: S.RouteRequestOutput,
  auditAction: 'approval_chain_constructed',
  purpose:
    'Identify the co-approval chain participants (one user per required role) with a 1-sentence why. ' +
    'Marks isFiler=true when an eligible candidate matches the filer; the calling service applies SOD.',
  buildPrompt: makeBuildPrompt<S.RouteRequestInput>(
    [
      'For each role in input.policyContext.requiredApproverRoles, choose a user from input.orgCatalog.',
      'Produce a NEW JSON object with these EXACT fields:',
      '',
      '{',
      '  "participants": [',
      '    {',
      '      "role": "<one of input.policyContext.requiredApproverRoles>",',
      '      "name": "<chosen user name from input.orgCatalog>",',
      '      "userId": "<chosen user id from input.orgCatalog>",',
      '      "why": "<1 sentence explaining fit>",',
      '      "isFiler": <boolean — true if name === input.filerName>',
      '    }',
      '  ],',
      '  "chainNotes": "<overall narrative about the chain>",',
      '  "unresolvedRoles": [ "<role>" ]',
      '}',
      '',
      'Selection preferences (apply in order):',
      '- service-specific owner over generic role-holder when entity has a service field',
      '- user\'s manager when entity is access-related and role is "manager-of-requester"',
      '- system owner when role is "owner-of-system"',
      '- when multiple eligible, pick team-aligned (most adjacent to entity ownerTeam)',
      '',
      'Rules:',
      '- Set isFiler=true if chosen name equals input.filerName (caller applies SOD).',
      '- If a required role has no eligible user, put it in unresolvedRoles AND omit from participants.',
      '- Use ONLY userIds and names that exist in input.orgCatalog.',
    ].join('\n'),
    {
      excludeRole: true,
      excludeT4: true,
    },
  ),
}

const propose_bounded_remediation: SkillSpec<
  S.ProposeBoundedRemediationInput,
  S.ProposeBoundedRemediationOutput
> = {
  name: 'propose_bounded_remediation',
  kind: 'agentic',
  model: 'claude-sonnet-4-20250514',
  temperature: 0.2,
  maxInputTokens: 6000,
  maxOutputTokens: 1200,
  inputSchema: S.ProposeBoundedRemediationInput,
  outputSchema: S.ProposeBoundedRemediationOutput,
  auditAction: 'remediation_proposed',
  purpose:
    'Draft a single-service, single-environment, single-changeType remediation proposal with ' +
    'estimated blast radius, rollback plan, and suggested maintenance window. Output is a draft.',
  buildPrompt: makeBuildPrompt<S.ProposeBoundedRemediationInput>(
    [
      'Propose ONE bounded remediation. Produce a NEW JSON object with these EXACT fields:',
      '',
      '{',
      '  "proposed": {',
      '    "title": "<suitable as a Change title>",',
      '    "description": "<4-8 sentences>",',
      '    "targetService": "<exactly one service from input.authorContext.systemsOwned or input.incident.affectedService>",',
      '    "environment": "<exactly one — usually production unless incident is staging>",',
      '    "changeType": "rollback"|"config_change"|"restart"|"failover",',
      '    "estimatedRiskLevel": "critical"|"high"|"medium"|"low",',
      '    "estimatedBlastRadius": [ { "name": "<entity>", "type": "<service|api|db|job>", "reason": "<short>" } ],',
      '    "rollbackPlan": "<2-4 sentences>",',
      '    "rollbackTested": <boolean>,',
      '    "suggestedMaintenanceWindow": "<ISO range>" | null',
      '  },',
      '  "rationale": "<why this remediation; why not others>",',
      '  "dependencies": [ "<human-readable prerequisite>" ],',
      '  "warnings": [ { "severity": "info"|"warn"|"block", "note": "<short>" } ],',
      '  "confidence": <number 0.0 to 1.0>',
      '}',
      '',
      'Hard rules (violating these is invalid output):',
      '- targetService is EXACTLY ONE service name (no commas, no "and").',
      '- changeType is EXACTLY ONE enum value.',
      '- rollbackPlan is REQUIRED.',
      '- If remediation cannot fit single-service bounds, do NOT relax — add warnings explaining the multi-service issue and propose only the first-step single-service change.',
    ].join('\n'),
    {
      servicesFilter: (input) => [input.incident.affectedService],
    },
  ),
}

const draft_approval_packet: SkillSpec<
  S.DraftApprovalPacketInput,
  S.DraftApprovalPacketOutput
> = {
  name: 'draft_approval_packet',
  kind: 'agentic',
  model: 'claude-sonnet-4-20250514',
  temperature: 0.3,
  maxInputTokens: 8000,
  maxOutputTokens: 1500,
  inputSchema: S.DraftApprovalPacketInput,
  outputSchema: S.DraftApprovalPacketOutput,
  auditAction: 'approval_packet_drafted',
  purpose:
    'Compress a Change + its blast radius + recommendations + policy posture + approval-chain status ' +
    'into a one-page approval brief with sections and an advisory recommendation.',
  buildPrompt: makeBuildPrompt<S.DraftApprovalPacketInput>(
    [
      'Produce a NEW JSON object with these EXACT fields (a structured approval packet):',
      '',
      '{',
      '  "title": "<1 line, e.g. \\"Approval Packet — CHG-2026-002\\">",',
      '  "oneLineSummary": "<the elevator pitch, 1 sentence>",',
      '  "sections": {',
      '    "whatChanges": "<3-5 sentences>",',
      '    "whyNow": "<2-3 sentences, business reason + timing>",',
      '    "blastRadiusSummary": "<3-5 sentences>",',
      '    "riskPosture": "<2-3 sentences>",',
      '    "rollbackPlan": "<2-3 sentences>",',
      '    "policyPosture": "<2-3 sentences referencing policyContext>",',
      '    "approvalChain": "<2-3 sentences referencing approval.coApprovals>",',
      '    "openQuestions": "<optional, things approver should ask>"',
      '  },',
      '  "recommendation": "approve"|"approve_with_condition"|"investigate_further"|"deny",',
      '  "recommendationRationale": "<1-3 sentences>"',
      '}',
      '',
      'The recommendation is ADVISORY ONLY. Do not phrase it as a decision.',
    ].join('\n'),
    {
      servicesFilter: (input) => [input.change.service],
    },
  ),
}

const draft_work_note: SkillSpec<S.DraftWorkNoteInput, S.DraftWorkNoteOutput> = {
  name: 'draft_work_note',
  kind: 'agentic',
  model: 'claude-sonnet-4-20250514',
  temperature: 0.4,
  maxInputTokens: 3500,
  maxOutputTokens: 400,
  inputSchema: S.DraftWorkNoteInput,
  outputSchema: S.DraftWorkNoteOutput,
  auditAction: 'work_note_drafted',
  purpose:
    'Draft a ServiceNow-style work note (3-6 sentences) with a recommended next-update time and audience.',
  buildPrompt: makeBuildPrompt<S.DraftWorkNoteInput>(
    [
      'Produce a NEW JSON object with these EXACT fields:',
      '',
      '{',
      '  "workNote": "<the prose note, 3-6 sentences>",',
      '  "nextUpdateTimeRecommended": "<ISO 8601 duration e.g. PT15M, PT30M, PT2H>",',
      '  "audience": "on_call"|"assignment_group"|"incident_commander"',
      '}',
      '',
      'workNote tone: factual, concise, no marketing, no apologies. Structure:',
      '- 1 sentence: current state',
      '- 1-2 sentences: what has been investigated / changed since last update',
      '- 1 sentence: who is involved',
      '- 1 sentence: next update time',
      '',
      'nextUpdateTimeRecommended by severity: Sev1 → PT15M. Sev2 → PT30M. Sev3/4 → PT2H or longer.',
      'audience: on_call (page-worthy) | assignment_group (team-wide) | incident_commander.',
    ].join('\n'),
    {
      servicesFilter: (input) => [input.incident.affectedService],
      excludePolicy: true,
    },
  ),
}

const draft_customer_response: SkillSpec<
  S.DraftCustomerResponseInput,
  S.DraftCustomerResponseOutput
> = {
  name: 'draft_customer_response',
  kind: 'agentic',
  model: 'claude-sonnet-4-20250514',
  temperature: 0.5,
  maxInputTokens: 3000,
  maxOutputTokens: 600,
  inputSchema: S.DraftCustomerResponseInput,
  outputSchema: S.DraftCustomerResponseOutput,
  auditAction: 'customer_response_drafted',
  purpose:
    'Generate a customer-facing status update (status_page / support_reply / email_blast / social_media_short) ' +
    'matching the requested intent phase. Strips internal jargon and engineer names.',
  buildPrompt: makeBuildPrompt<S.DraftCustomerResponseInput>(
    [
      'Produce a NEW JSON object with these EXACT fields:',
      '',
      '{',
      '  "body": "<the prose, sized per channel below>",',
      '  "subject": "<only for channel=email_blast; omit for other channels>",',
      '  "toneCheck": "pass"|"review_recommended",',
      '  "toneNotes": "<short why pass or what to review>"',
      '}',
      '',
      'Content constraints (do NOT violate):',
      '- No internal system names unless customer would already know them.',
      '- No engineer names. No internal ticket IDs.',
      '- No technical root cause unless customer asked.',
      '- Calm, factual tone. No marketing apologies. No promises about timing beyond what is known.',
      '',
      'Channel sizing for body:',
      '- status_page: 1-3 sentences, factual',
      '- support_reply: 2-5 sentences, acknowledging the customer\'s specific report',
      '- email_blast: 4-7 sentences with structure (also include subject field)',
      '- social_media_short: ≤ 280 characters',
      '',
      'toneCheck:',
      '- "pass": ships clean',
      '- "review_recommended": jargon, over-promised timing, or marketing apology detected',
    ].join('\n'),
    {
      excludePolicy: true,
      excludeOrgCatalog: true,
      excludeT4: true,
    },
  ),
}

const explain_policy_decision: SkillSpec<
  S.ExplainPolicyDecisionInput,
  S.ExplainPolicyDecisionOutput
> = {
  name: 'explain_policy_decision',
  kind: 'agentic',
  model: 'claude-sonnet-4-20250514',
  temperature: 0.2,
  maxInputTokens: 4000,
  maxOutputTokens: 400,
  inputSchema: S.ExplainPolicyDecisionInput,
  outputSchema: S.ExplainPolicyDecisionOutput,
  auditAction: 'policy_decision_explained',
  purpose:
    'Render a human-readable explanation of a deterministic policy outcome. Does not decide policy; ' +
    'explains the verdict so the user can understand why and what would unblock.',
  buildPrompt: makeBuildPrompt<S.ExplainPolicyDecisionInput>(
    [
      'Produce a NEW JSON object with these EXACT fields:',
      '',
      '{',
      '  "oneLineSummary": "<what happened, plain English, 1 sentence>",',
      '  "ruleNameDisplay": "<friendly rendering, e.g. \\"Production Write Guard\\" not \\"production-write-guard\\">",',
      '  "whyExplanation": "<2-4 sentences: why does this rule apply to THIS specific object?>",',
      '  "whatWouldUnblock": "<1-2 sentences. If input.whatWouldUnblock is set, refine it; else reason about it>",',
      '  "nextStep": "<1 sentence: concrete user action>",',
      '  "tone": "firm"|"neutral"',
      '}',
      '',
      'tone: "firm" for deny / hard policy. "neutral" for escalate / soft.',
    ].join('\n'),
    {
      excludeT4: true,
      excludeT5: true,
    },
  ),
}

const summarize_decision_impact: SkillSpec<
  S.SummarizeDecisionImpactInput,
  S.SummarizeDecisionImpactOutput
> = {
  name: 'summarize_decision_impact',
  kind: 'agentic',
  model: 'claude-haiku-4-5-20251001',
  temperature: 0.3,
  maxInputTokens: 2500,
  maxOutputTokens: 400,
  inputSchema: S.SummarizeDecisionImpactInput,
  outputSchema: S.SummarizeDecisionImpactOutput,
  auditAction: 'decision_impact_summarized',
  purpose:
    'Reshape an Approval\'s already-stored decisionImpact strings into a spoken-style summary ' +
    '(one_line / paragraph / three_options). Does NOT re-derive impact.',
  buildPrompt: makeBuildPrompt<S.SummarizeDecisionImpactInput>(
    [
      'Reshape the stored decision impact strings (input.approval.decisionImpact.approve/deny/escalate)',
      'into a single user-facing summary. Do NOT invent new consequences — reshape the existing text.',
      '',
      'Output JSON shape (these are the ONLY fields, no others):',
      '{',
      '  "summary": "<the reshaped text, sized per format below>",',
      '  "recommendedReadingOrder": ["approve", "deny", "escalate"]   // OPTIONAL: only when format=three_options',
      '}',
      '',
      'Format sizing (use input.format):',
      '- one_line: summary ≤ 30 words. Names the most likely recommended path given the chain state.',
      '- paragraph: summary = 3-5 sentences. Conversational. Explains the trade-off.',
      '- three_options: summary contains a one-liner per option, in suggested reading order. Populate `recommendedReadingOrder` with the order.',
    ].join('\n'),
    {
      excludePolicy: true,
      excludeRole: true,
      excludeOrgCatalog: true,
      excludeT4: true,
      excludeT5: true,
    },
  ),
}

// ─── Registry map ───────────────────────────────────────

const _registry: Record<SkillName, SkillSpec<unknown, unknown>> = {
  assess_change: assess_change as SkillSpec<unknown, unknown>,
  analyze_blast_radius: analyze_blast_radius as SkillSpec<unknown, unknown>,
  triage_incident: triage_incident as SkillSpec<unknown, unknown>,
  evaluate_access_request: evaluate_access_request as SkillSpec<unknown, unknown>,
  support_approval_decision: support_approval_decision as SkillSpec<unknown, unknown>,
  route_request: route_request as SkillSpec<unknown, unknown>,
  propose_bounded_remediation: propose_bounded_remediation as SkillSpec<unknown, unknown>,
  draft_approval_packet: draft_approval_packet as SkillSpec<unknown, unknown>,
  draft_work_note: draft_work_note as SkillSpec<unknown, unknown>,
  draft_customer_response: draft_customer_response as SkillSpec<unknown, unknown>,
  explain_policy_decision: explain_policy_decision as SkillSpec<unknown, unknown>,
  summarize_decision_impact: summarize_decision_impact as SkillSpec<unknown, unknown>,
}

export function getSkill<TInput = unknown, TOutput = unknown>(
  name: SkillName,
): SkillSpec<TInput, TOutput> {
  const spec = _registry[name]
  if (!spec) throw new Error(`Skill not found in registry: ${name}`)
  return spec as SkillSpec<TInput, TOutput>
}

export function listSkills(): Array<{ name: SkillName; purpose: string; kind: string }> {
  return Object.values(_registry).map((s) => ({
    name: s.name,
    purpose: s.purpose,
    kind: s.kind,
  }))
}

export function hasSkill(name: string): name is SkillName {
  return name in _registry
}
