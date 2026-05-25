/**
 * Skill runner — the single chokepoint that executes any skill.
 *
 * Flow:
 *   1. Look up the SkillSpec in the registry.
 *   2. Validate the input against the spec's Zod inputSchema.
 *   3. Call the spec's `buildPrompt` to compose system + user messages.
 *   4. Hash the joined prompt (SHA-256) → `prompt_hash`.
 *   5. Call Anthropic's messages API (non-streaming JSON).
 *   6. Strip code fences if any, parse JSON.
 *   7. Validate parsed JSON against the spec's outputSchema.
 *   8. Write one row to `agent_invocations` (provenance contract).
 *   9. Return RunnerResult with the validated output + metrics.
 *
 * On any failure path, status is set appropriately (validation_failed | error)
 * and the provenance row is still written with the failure reason.
 */

import { createHash } from 'node:crypto'
import Anthropic from '@anthropic-ai/sdk'
import { config } from '../../config.js'
import { prisma } from '../../lib/prisma.js'
import { getSkill, hasSkill } from './registry.js'
import { splitOnCacheBreak } from './prompt.js'
import { validateReferences, violationsAreBlocking } from './validate-references.js'
import { runCritique, critiqueBlocks } from './critique.js'
import {
  withRetry,
  withTimeout,
  breakerOpen,
  recordBreakerSuccess,
  recordBreakerFailure,
  consumeRateToken,
  checkCostCap,
  getFallbackModel,
  CircuitOpenError,
  TimeoutError,
  RateLimitError,
  CostCapError,
  isTransientError,
} from './reliability.js'

const DEFAULT_TIMEOUT_MS = 30_000 // 30s hard cap per skill call (C4)
import type {
  RunnerResult,
  RunnerStatus,
  RunSkillOptions,
  SkillContext,
  SkillName,
} from './types.js'

// ─── Anthropic client singleton ─────────────────────────

let _client: Anthropic | null = null

function getClient(): Anthropic {
  if (!_client) {
    if (!config.anthropicApiKey) {
      throw new Error('ANTHROPIC_API_KEY is not configured')
    }
    _client = new Anthropic({ apiKey: config.anthropicApiKey })
  }
  return _client
}

export function isSkillRunnerConfigured(): boolean {
  return !!config.anthropicApiKey
}

// ─── Helpers ────────────────────────────────────────────

function hashPrompt(system: string, user: string): string {
  return createHash('sha256').update(`${system}\n---\n${user}`).digest('hex')
}

/**
 * Strip ```json fences and surrounding whitespace, returning the inner text.
 * Models sometimes emit fences despite explicit instructions.
 */
function stripCodeFences(text: string): string {
  let trimmed = text.trim()
  // Strip leading ```json or ``` and trailing ```
  if (trimmed.startsWith('```')) {
    const firstNewline = trimmed.indexOf('\n')
    if (firstNewline >= 0) trimmed = trimmed.slice(firstNewline + 1)
    if (trimmed.endsWith('```')) trimmed = trimmed.slice(0, -3)
    trimmed = trimmed.trim()
  }
  return trimmed
}

interface ProvenanceWriteInput {
  skill: SkillName
  kind: 'agentic' | 'deterministic' | 'integration'
  model: string
  promptHash: string
  tokensIn: number
  tokensOut: number
  cached: boolean
  latencyMs: number
  confidence: number | null
  status: RunnerStatus
  errorMessage: string | null
  actor: string
}

async function writeProvenance(input: ProvenanceWriteInput): Promise<string | undefined> {
  try {
    const row = await prisma.agentInvocation.create({
      data: {
        skill: input.skill,
        kind: input.kind,
        model: input.model,
        promptHash: input.promptHash,
        tokensIn: input.tokensIn,
        tokensOut: input.tokensOut,
        cached: input.cached,
        latencyMs: input.latencyMs,
        confidence: input.confidence,
        status: input.status,
        errorMessage: input.errorMessage,
        actor: input.actor,
      },
    })
    return row.id
  } catch (err) {
    // Provenance write failure is logged but does not fail the skill call.
    // eslint-disable-next-line no-console
    console.error('[skill-runner] provenance write failed:', err)
    return undefined
  }
}

// ─── Public: runSkill ───────────────────────────────────

/**
 * Run a skill end-to-end. Returns a RunnerResult with status, output (if valid),
 * raw text (if validation failed), error message (if errored), and metrics.
 *
 * Never throws for skill-level failures — all failure modes return a
 * RunnerResult with status set. Throws only for programmer errors
 * (unknown skill name, missing API key when an agentic skill is invoked).
 */
export async function runSkill<TInput = unknown, TOutput = unknown>(
  name: SkillName,
  input: TInput,
  ctx: SkillContext,
  options: RunSkillOptions = {},
): Promise<RunnerResult<TOutput>> {
  if (!hasSkill(name)) {
    throw new Error(`Unknown skill: ${name}`)
  }
  const spec = getSkill<TInput, TOutput>(name)
  const actor = options.actor ?? ctx.actor ?? 'system'

  // Track the model actually used (may switch to fallback below).
  let usedModel = spec.model

  // 1. Validate input
  const inputCheck = spec.inputSchema.safeParse(input)
  if (!inputCheck.success) {
    const errMsg = `input validation failed: ${JSON.stringify(inputCheck.error.flatten())}`
    let invocationId: string | undefined
    if (!options.skipProvenance) {
      invocationId = await writeProvenance({
        skill: name,
        kind: spec.kind,
        model: usedModel,
        promptHash: '',
        tokensIn: 0,
        tokensOut: 0,
        cached: false,
        latencyMs: 0,
        confidence: null,
        status: 'validation_failed',
        errorMessage: errMsg,
        actor,
      })
    }
    return {
      status: 'validation_failed',
      errorMessage: errMsg,
      invocationId,
      metrics: { tokensIn: 0, tokensOut: 0, latencyMs: 0, cached: false },
    }
  }

  // 2. Build prompt
  const { system, user } = spec.buildPrompt(inputCheck.data, ctx)
  const promptHash = hashPrompt(system, user)

  // 2a. Split into cached + dynamic blocks for prompt caching.
  // Anthropic ephemeral cache: 5-min TTL, 90% discount on hits.
  // Min cacheable block size is 1024 tokens — we only request caching when
  // the stable half is large enough to be worth caching.
  const { cached: cachedBlock, dynamic: dynamicBlock } = splitOnCacheBreak(system)
  // Rough token estimate: 1 token ≈ 3.5 chars. Skip cache if too small.
  const CACHE_MIN_CHARS = 1024 * 3 // ~1024 tokens
  const useCache = cachedBlock.length >= CACHE_MIN_CHARS

  const systemBlocks: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> = []
  if (cachedBlock) {
    systemBlocks.push(
      useCache
        ? { type: 'text', text: cachedBlock, cache_control: { type: 'ephemeral' } }
        : { type: 'text', text: cachedBlock },
    )
  }
  if (dynamicBlock) {
    systemBlocks.push({ type: 'text', text: dynamicBlock })
  }

  // 3. Pre-flight reliability gates (C5 rate limit, C6 cost cap)
  try {
    consumeRateToken(actor)
    await checkCostCap(actor)
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    let invocationId: string | undefined
    if (!options.skipProvenance) {
      invocationId = await writeProvenance({
        skill: name,
        kind: spec.kind,
        model: usedModel,
        promptHash,
        tokensIn: 0,
        tokensOut: 0,
        cached: false,
        latencyMs: 0,
        confidence: null,
        status: 'error',
        errorMessage: errMsg,
        actor,
      })
    }
    return {
      status: 'error',
      errorMessage: errMsg,
      invocationId,
      metrics: { tokensIn: 0, tokensOut: 0, latencyMs: 0, cached: false },
    }
  }

  // 4. Call model with retry + timeout + circuit breaker + model fallback
  const client = getClient()
  const startedAt = Date.now()
  let rawText = ''
  let tokensIn = 0
  let tokensOut = 0
  let cached = false
  let cacheReadTokens = 0
  let cacheWriteTokens = 0

  const callModel = async (model: string) => {
    const breakerKey = `${model}:${name}`
    if (breakerOpen(breakerKey)) {
      throw new CircuitOpenError(breakerKey)
    }
    return await withRetry(
      () =>
        withTimeout(
          () =>
            client.messages.create({
              model,
              max_tokens: spec.maxOutputTokens,
              temperature: spec.temperature,
              system: systemBlocks,
              messages: [{ role: 'user', content: user }],
            }),
          DEFAULT_TIMEOUT_MS,
        ),
      {
        maxAttempts: 3,
        baseDelayMs: 500,
        maxDelayMs: 5000,
        shouldRetry: (err, attempt) => {
          // Don't retry timeouts past the first — they're slow problems, not transient
          if (err instanceof TimeoutError) return attempt < 2
          return isTransientError(err) && attempt < 3
        },
      },
    )
  }

  try {
    let response: Awaited<ReturnType<typeof client.messages.create>>
    try {
      response = await callModel(spec.model)
      recordBreakerSuccess(`${spec.model}:${name}`)
    } catch (primaryErr) {
      // C7 model fallback on persistent failure of primary
      const fallback = getFallbackModel(spec.model)
      if (fallback && (isTransientError(primaryErr) || primaryErr instanceof TimeoutError || primaryErr instanceof CircuitOpenError)) {
        recordBreakerFailure(`${spec.model}:${name}`)
        usedModel = fallback
        response = await callModel(fallback)
        recordBreakerSuccess(`${fallback}:${name}`)
      } else {
        recordBreakerFailure(`${spec.model}:${name}`)
        throw primaryErr
      }
    }

    tokensIn = response.usage?.input_tokens ?? 0
    tokensOut = response.usage?.output_tokens ?? 0
    const usage = response.usage as
      | { cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
      | undefined
    cacheReadTokens = usage?.cache_read_input_tokens ?? 0
    cacheWriteTokens = usage?.cache_creation_input_tokens ?? 0
    cached = cacheReadTokens > 0

    // Concatenate any text blocks
    for (const block of response.content) {
      if (block.type === 'text') rawText += block.text
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    const latencyMs = Date.now() - startedAt
    let invocationId: string | undefined
    if (!options.skipProvenance) {
      invocationId = await writeProvenance({
        skill: name,
        kind: spec.kind,
        model: usedModel,
        promptHash,
        tokensIn: 0,
        tokensOut: 0,
        cached: false,
        latencyMs,
        confidence: null,
        status: 'error',
        errorMessage: errMsg,
        actor,
      })
    }
    return {
      status: 'error',
      errorMessage: errMsg,
      invocationId,
      metrics: { tokensIn: 0, tokensOut: 0, latencyMs, cached: false },
    }
  }

  const latencyMs = Date.now() - startedAt

  // 5. Parse JSON
  const cleaned = stripCodeFences(rawText)
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch (err) {
    const errMsg = `output not valid JSON: ${err instanceof Error ? err.message : String(err)}`
    let invocationId: string | undefined
    if (!options.skipProvenance) {
      invocationId = await writeProvenance({
        skill: name,
        kind: spec.kind,
        model: usedModel,
        promptHash,
        tokensIn,
        tokensOut,
        cached,
        latencyMs,
        confidence: null,
        status: 'validation_failed',
        errorMessage: errMsg,
        actor,
      })
    }
    return {
      status: 'validation_failed',
      rawOutput: rawText,
      errorMessage: errMsg,
      invocationId,
      metrics: { tokensIn, tokensOut, latencyMs, cached },
    }
  }

  // 5. Validate output
  const outputCheck = spec.outputSchema.safeParse(parsed)
  if (!outputCheck.success) {
    const errMsg = `output schema validation failed: ${JSON.stringify(outputCheck.error.flatten())}`
    let invocationId: string | undefined
    if (!options.skipProvenance) {
      invocationId = await writeProvenance({
        skill: name,
        kind: spec.kind,
        model: usedModel,
        promptHash,
        tokensIn,
        tokensOut,
        cached,
        latencyMs,
        confidence: null,
        status: 'validation_failed',
        errorMessage: errMsg,
        actor,
      })
    }
    return {
      status: 'validation_failed',
      rawOutput: rawText,
      errorMessage: errMsg,
      invocationId,
      metrics: { tokensIn, tokensOut, latencyMs, cached },
    }
  }

  // 6. Reference validator post-pass (anti-hallucination).
  // Scans output for entity references (service names, etc.) and verifies
  // each one exists in the catalog passed via context. Unknown service names
  // → fail the call. Other reference types are advisory-only (logged but not blocking).
  const violations = validateReferences(outputCheck.data, ctx, inputCheck.data)
  if (violations.length > 0 && violationsAreBlocking(violations)) {
    const violationList = violations.map((v) => `${v.kind}: ${v.value}`).join('; ')
    const errMsg = `output references unknown entities: ${violationList}`
    let invocationId: string | undefined
    if (!options.skipProvenance) {
      invocationId = await writeProvenance({
        skill: name,
        kind: spec.kind,
        model: usedModel,
        promptHash,
        tokensIn,
        tokensOut,
        cached,
        latencyMs,
        confidence: null,
        status: 'validation_failed',
        errorMessage: errMsg,
        actor,
      })
    }
    return {
      status: 'validation_failed',
      rawOutput: rawText,
      errorMessage: errMsg,
      invocationId,
      metrics: { tokensIn, tokensOut, latencyMs, cached },
    }
  }

  // 7. A9 self-critique (opt-in per skill).
  // Runs a cheap critic model to look for problems the schema and reference
  // validator can't catch — factual contradictions, missed constraints,
  // schema-valid-but-semantically-wrong outputs. Blocks the call on a
  // `major` severity verdict; lesser severities pass through with the
  // critique attached for observability.
  const validated = outputCheck.data as TOutput & { confidence?: number }
  const confidence = typeof validated.confidence === 'number' ? validated.confidence : null

  let critique: import('./types.js').CritiqueResult | undefined
  if (spec.critique?.enabled) {
    critique = await runCritique(client, name, inputCheck.data, validated, spec.critique)
    // Fold critique tokens into the totals so cost dashboards stay accurate.
    tokensIn += critique.tokensIn
    tokensOut += critique.tokensOut

    if (critiqueBlocks(critique, spec.critique)) {
      const errMsg = `[critique-blocked] ${critique.issues.join('; ')}${
        critique.suggestion ? ` | suggestion: ${critique.suggestion}` : ''
      }`
      let invocationId: string | undefined
      if (!options.skipProvenance) {
        invocationId = await writeProvenance({
          skill: name,
          kind: spec.kind,
          model: usedModel,
          promptHash,
          tokensIn,
          tokensOut,
          cached,
          latencyMs: Date.now() - startedAt,
          confidence,
          status: 'validation_failed',
          errorMessage: errMsg,
          actor,
        })
      }
      return {
        status: 'validation_failed',
        rawOutput: rawText,
        errorMessage: errMsg,
        invocationId,
        metrics: { tokensIn, tokensOut, latencyMs: Date.now() - startedAt, cached },
        critique,
      }
    }
  }

  // 8. Success
  const finalLatency = Date.now() - startedAt

  let invocationId: string | undefined
  if (!options.skipProvenance) {
    invocationId = await writeProvenance({
      skill: name,
      kind: spec.kind,
      model: usedModel,
      promptHash,
      tokensIn,
      tokensOut,
      cached,
      latencyMs: finalLatency,
      confidence,
      status: 'success',
      errorMessage: null,
      actor,
    })
  }

  return {
    status: 'success',
    output: validated,
    invocationId,
    metrics: { tokensIn, tokensOut, latencyMs: finalLatency, cached },
    confidence: confidence ?? undefined,
    critique,
  }
}

// ─── Convenience: typed wrappers per skill ──────────────
//
// Callers can use `runSkill('name', input, ctx)` directly, but the typed
// wrappers below provide better inference. They are thin pass-throughs.

import type {
  AssessChangeInput,
  AssessChangeOutput,
  AnalyzeBlastRadiusInput,
  AnalyzeBlastRadiusOutput,
  TriageIncidentInput,
  TriageIncidentOutput,
  EvaluateAccessRequestInput,
  EvaluateAccessRequestOutput,
  SupportApprovalDecisionInput,
  SupportApprovalDecisionOutput,
  RouteRequestInput,
  RouteRequestOutput,
  ProposeBoundedRemediationInput,
  ProposeBoundedRemediationOutput,
  DraftApprovalPacketInput,
  DraftApprovalPacketOutput,
  DraftWorkNoteInput,
  DraftWorkNoteOutput,
  DraftCustomerResponseInput,
  DraftCustomerResponseOutput,
  ExplainPolicyDecisionInput,
  ExplainPolicyDecisionOutput,
  SummarizeDecisionImpactInput,
  SummarizeDecisionImpactOutput,
} from './schemas.js'

export const runners = {
  assessChange: (input: AssessChangeInput, ctx: SkillContext, opts?: RunSkillOptions) =>
    runSkill<AssessChangeInput, AssessChangeOutput>('assess_change', input, ctx, opts),
  analyzeBlastRadius: (input: AnalyzeBlastRadiusInput, ctx: SkillContext, opts?: RunSkillOptions) =>
    runSkill<AnalyzeBlastRadiusInput, AnalyzeBlastRadiusOutput>(
      'analyze_blast_radius',
      input,
      ctx,
      opts,
    ),
  triageIncident: (input: TriageIncidentInput, ctx: SkillContext, opts?: RunSkillOptions) =>
    runSkill<TriageIncidentInput, TriageIncidentOutput>('triage_incident', input, ctx, opts),
  evaluateAccessRequest: (
    input: EvaluateAccessRequestInput,
    ctx: SkillContext,
    opts?: RunSkillOptions,
  ) =>
    runSkill<EvaluateAccessRequestInput, EvaluateAccessRequestOutput>(
      'evaluate_access_request',
      input,
      ctx,
      opts,
    ),
  supportApprovalDecision: (
    input: SupportApprovalDecisionInput,
    ctx: SkillContext,
    opts?: RunSkillOptions,
  ) =>
    runSkill<SupportApprovalDecisionInput, SupportApprovalDecisionOutput>(
      'support_approval_decision',
      input,
      ctx,
      opts,
    ),
  routeRequest: (input: RouteRequestInput, ctx: SkillContext, opts?: RunSkillOptions) =>
    runSkill<RouteRequestInput, RouteRequestOutput>('route_request', input, ctx, opts),
  proposeBoundedRemediation: (
    input: ProposeBoundedRemediationInput,
    ctx: SkillContext,
    opts?: RunSkillOptions,
  ) =>
    runSkill<ProposeBoundedRemediationInput, ProposeBoundedRemediationOutput>(
      'propose_bounded_remediation',
      input,
      ctx,
      opts,
    ),
  draftApprovalPacket: (
    input: DraftApprovalPacketInput,
    ctx: SkillContext,
    opts?: RunSkillOptions,
  ) =>
    runSkill<DraftApprovalPacketInput, DraftApprovalPacketOutput>(
      'draft_approval_packet',
      input,
      ctx,
      opts,
    ),
  draftWorkNote: (input: DraftWorkNoteInput, ctx: SkillContext, opts?: RunSkillOptions) =>
    runSkill<DraftWorkNoteInput, DraftWorkNoteOutput>('draft_work_note', input, ctx, opts),
  draftCustomerResponse: (
    input: DraftCustomerResponseInput,
    ctx: SkillContext,
    opts?: RunSkillOptions,
  ) =>
    runSkill<DraftCustomerResponseInput, DraftCustomerResponseOutput>(
      'draft_customer_response',
      input,
      ctx,
      opts,
    ),
  explainPolicyDecision: (
    input: ExplainPolicyDecisionInput,
    ctx: SkillContext,
    opts?: RunSkillOptions,
  ) =>
    runSkill<ExplainPolicyDecisionInput, ExplainPolicyDecisionOutput>(
      'explain_policy_decision',
      input,
      ctx,
      opts,
    ),
  summarizeDecisionImpact: (
    input: SummarizeDecisionImpactInput,
    ctx: SkillContext,
    opts?: RunSkillOptions,
  ) =>
    runSkill<SummarizeDecisionImpactInput, SummarizeDecisionImpactOutput>(
      'summarize_decision_impact',
      input,
      ctx,
      opts,
    ),
}
