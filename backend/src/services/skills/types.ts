/**
 * Shared types for the skills system (Phase 8).
 *
 * A "skill" is a single-purpose, prompt-driven unit of advisory work.
 * Skills do not write to the database directly. They produce structured
 * output that a calling service persists.
 *
 * Every agentic skill invocation writes one row to `agent_invocations`
 * (provenance contract). Deterministic skills do not.
 */

import type { ZodSchema } from 'zod'

// ─── Skill kinds ────────────────────────────────────────

export type SkillKind = 'agentic' | 'deterministic' | 'integration'

// ─── Skill names (closed set, v1) ───────────────────────

export const SKILL_NAMES = [
  'assess_change',
  'analyze_blast_radius',
  'triage_incident',
  'evaluate_access_request',
  'support_approval_decision',
  'route_request',
  'propose_bounded_remediation',
  'draft_approval_packet',
  'draft_work_note',
  'draft_customer_response',
  'explain_policy_decision',
  'summarize_decision_impact',
] as const

export type SkillName = (typeof SKILL_NAMES)[number]

// ─── Context tier inputs ────────────────────────────────

/**
 * Identity & immutable framing — Sentinel's hard constraints.
 * Same string every call; cacheable.
 */
export interface T1aIdentity {
  systemRole: 'sentinel'
  hardConstraints: string[]
}

/**
 * Active policy bundle — the currently in-force rules.
 * Cached per bundle version.
 */
export interface T1bPolicyBundle {
  bundleVersion: string
  rules: Array<{
    name: string
    description: string
    bundle: string
    decision: string
    scope: string
    appliesTo: string[]
    /** Why this rule exists. Agents quote this when explaining enforcement. */
    rationale?: string | null
    /** Concrete examples the skill can pattern-match against the candidate. */
    examples?: string[]
    /** Lightweight category tags surfaced for filtering. */
    tags?: string[]
  }>
  activeFreezes: Array<{
    id: string
    label: string
    scope: string
    startsAt: string
    endsAt: string
    affectsServices: string[]
  }>
}

/**
 * Role-aware constraints for the acting user.
 * Cached per role.
 */
export interface T1cRoleConstraints {
  role: string
  label: string
  description: string
  allowed: string[]
  blocked: string[]
}

/**
 * Org & service catalog — user directory, manager hierarchy, service catalog,
 * team directory, approver registry. Used by chat-style skills for ownership/
 * contact-routing answers.
 */
export interface T1dOrgCatalog {
  users: Array<{
    id: string
    name: string
    email: string
    role: string
    team: string
    managerId: string | null
    systemsOwned: string[]
  }>
  services: Record<
    string,
    {
      team: string
      criticality: 'critical' | 'high' | 'medium' | 'low'
      ownerUserIds: string[]
      downstream: string[]
    }
  >
  approverRegistry: Record<string, string[]>
}

/**
 * Skill registry meta — names + descriptions of available skills,
 * for skills that need to suggest follow-up actions.
 */
export interface T1eSkillRegistry {
  skills: Array<{ name: string; purpose: string }>
}

/**
 * Composite T1 — all five sub-tiers. Skills opt in to which they need.
 */
export interface T1Context {
  identity?: T1aIdentity
  policyBundle?: T1bPolicyBundle
  roleConstraints?: T1cRoleConstraints
  orgCatalog?: T1dOrgCatalog
  skillRegistry?: T1eSkillRegistry
}

/**
 * T2 — the focal entity for this invocation.
 * Skills receive the entity in their input; T2 here is the "extra" relations
 * the runner pre-loaded (PR summaries, recent deploys, prior work notes, etc.).
 */
export interface T2Context {
  recentDeploysOnService?: Array<{
    ticketId: string
    deployedAt: string
    result: string
  }>
  recentIncidentsOnService?: Array<{
    incidentId: string
    rootCauseCategory: string
    resolvedAt: string
  }>
  prSummaries?: Array<{
    url: string
    title: string
    filesChanged: number
    additions: number
    deletions: number
  }>
  candidateKbArticles?: Array<{ id: string; title: string; snippet: string }>
  priorWorkNotes?: Array<{ at: string; author: string; note: string }>
}

/**
 * T3 — conversation / user-bound memory.
 *
 * Per-user state that persists across sessions. Used by:
 *   - Chat surfaces (ChatPanel, ContextualAssistant) — supplies prior turns
 *     for continuity ("you said earlier…").
 *   - Skills invoked from a chat conversation — same user context.
 *
 * Privacy: this tier is scoped to the acting user. It does NOT contain other
 * users' chat history. System-wide activity belongs in T4 (audit slice).
 *
 * Cacheability: medium. User history is stable enough to cache for ~5 min,
 * but invalidates whenever the user sends a new message.
 */
export interface T3Context {
  /** Recent chat messages exchanged with this user (oldest first). */
  userHistory?: Array<{
    role: 'user' | 'assistant'
    content: string
    createdAt: string
    sessionId: string
  }>
  /** Recent skill invocations performed FOR this user (self-recall). */
  recentInvocations?: Array<{
    skill: string
    status: string
    confidence: number | null
    createdAt: string
  }>
  /** Optional session metadata (id, page path, etc.). */
  session?: {
    sessionId: string
    pagePath?: string
  }
}

/**
 * T4 — slice of recent audit history relevant to the skill's question.
 * E.g. last N events on the same service for incident triage, or org-wide
 * recent activity for "what's been happening?" chat queries.
 */
export interface T4Context {
  recentAuditEvents?: Array<{
    timestamp: string
    actor: string
    action: string
    objectType?: string
    objectId: string
    objectTitle?: string
    result: string
  }>
}

/**
 * T5 — temporal facts. "Now" + active windows + time-since for relative phrasing.
 */
export interface T5Context {
  now: string
  activeFreezes?: Array<{
    id: string
    label: string
    endsAt: string
  }>
  notes?: string
}

// ─── Composite skill context ────────────────────────────

export interface SkillContext {
  /** Acting user (for provenance). 'system' for autonomous skills. */
  actor: string
  /** Trace ID for cross-skill correlation. */
  traceId?: string
  t1?: T1Context
  t2?: T2Context
  t3?: T3Context
  t4?: T4Context
  t5?: T5Context
}

// ─── Skill spec ─────────────────────────────────────────

/**
 * A SkillSpec is the registered definition of a single skill.
 * The runner uses it to validate input, build the prompt, call the model,
 * and validate output.
 */
export interface SkillSpec<TInput = unknown, TOutput = unknown> {
  name: SkillName
  kind: SkillKind
  /** Anthropic model ID, e.g. "claude-sonnet-4-6". */
  model: string
  temperature: number
  maxInputTokens: number
  maxOutputTokens: number
  /** Zod schema for the input payload. Failures → validation_failed before any model call. */
  inputSchema: ZodSchema<TInput>
  /** Zod schema for the parsed JSON output. Failures → validation_failed after the model call. */
  outputSchema: ZodSchema<TOutput>
  /** Audit action string emitted on the linked entity (per spec). */
  auditAction: string
  /** Human-readable purpose, surfaced via T1.e to other skills. */
  purpose: string
  /**
   * Build the system prompt + user message from input + context.
   * The runner hashes the joined prompt to populate `prompt_hash`.
   */
  buildPrompt: (input: TInput, ctx: SkillContext) => {
    system: string
    user: string
  }
  /**
   * A9 — optional second-pass self-critique. When set, after the primary
   * output has passed schema + reference validation the runner asks a
   * cheaper critic model to look for problems. Severity ≥ blockSeverity
   * fails the call as `validation_failed` so the caller treats it as bad
   * output instead of silently persisting questionable analysis.
   *
   * Apply selectively — every critiqued call roughly doubles the model
   * cost. Reserve for high-stakes skills: risk classification, access
   * evaluation, approval-decision support, anything that influences a
   * production-affecting human decision.
   */
  critique?: CritiqueConfig
}

// ─── A9 self-critique ───────────────────────────────────

/**
 * Per-skill self-critique configuration. The critic runs after the primary
 * output passes its schema + reference validators; on a "block"-severity
 * issue it fails the call so callers can re-route or fall back.
 */
export interface CritiqueConfig {
  enabled: true
  /**
   * Model to use for the critic. Defaults to a cheap haiku — the critic
   * should be cheaper than the primary so we don't double our spend.
   */
  model?: string
  /**
   * Minimum severity that fails the call. Lower severities are kept on the
   * result for observability but don't block. Defaults to `'major'`.
   */
  blockSeverity?: CritiqueSeverity
  /**
   * Free-form extra guidance appended to the critic system prompt. Use this
   * to call out skill-specific failure modes ("watch for hallucinated
   * service names", "verify role/user pairings exist in input.orgCatalog").
   */
  extraGuidance?: string
}

export type CritiqueSeverity = 'none' | 'minor' | 'major'

/**
 * Critic output, returned alongside RunnerResult so callers can surface it
 * to the user / dashboard. `ok=true` means the critic found no blocking
 * issues; `severity='major'` plus `ok=false` is the fail path.
 */
export interface CritiqueResult {
  ok: boolean
  severity: CritiqueSeverity
  issues: string[]
  /** Optional natural-language suggestion for how to fix the output. */
  suggestion?: string
  /** Model used for the critic call (for cost attribution). */
  model: string
  /** Critic-call tokens, additive on top of the primary call. */
  tokensIn: number
  tokensOut: number
}

// ─── Runner result ──────────────────────────────────────

export type RunnerStatus = 'success' | 'validation_failed' | 'error'

export interface RunnerResult<TOutput = unknown> {
  status: RunnerStatus
  /** Parsed, schema-validated output. Only set when status === 'success'. */
  output?: TOutput
  /** Raw model text, for debugging when validation fails. */
  rawOutput?: string
  /** Error message when status !== 'success'. */
  errorMessage?: string
  /** Provenance row id (if written). */
  invocationId?: string
  /** Token + latency metrics (best-effort). */
  metrics: {
    tokensIn: number
    tokensOut: number
    latencyMs: number
    cached: boolean
  }
  /** Confidence the skill self-reported, if any. */
  confidence?: number
  /**
   * A9 — critic result when the skill opted into self-critique. Present on
   * both `success` (critic passed) and `validation_failed` (critic blocked)
   * paths so the dashboard can show the critique pass-rate.
   */
  critique?: CritiqueResult
}

// ─── Runner options ─────────────────────────────────────

export interface RunSkillOptions {
  /** Override the actor for this single call (default: ctx.actor). */
  actor?: string
  /** If true, the runner skips writing to agent_invocations. Used for tests. */
  skipProvenance?: boolean
}
