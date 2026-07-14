/**
 * LangChain runtime path for a subset of skills.
 *
 * Wired up so ONE skill (currently `explain_policy_decision`, chosen via
 * the `runtime: 'langchain'` flag on its SkillSpec) executes through
 * LangChain instead of the custom runner. Everything else keeps flowing
 * through `runner.ts` — this file is deliberately narrow.
 *
 * Why coexist rather than migrate everything: the custom runner owns
 * prompt-cache splits, A9 self-critique, provenance rows keyed on
 * `promptHash`, reliability wrappers (retry / breaker / rate + cost
 * caps), and multi-tier context rendering. LangChain would need to
 * either bypass or reinvent those guarantees. Coexistence keeps both:
 * portfolio surface for LangChain APIs (LCEL, `withStructuredOutput`,
 * `Callbacks`, LangSmith tracing) without regressing the runner's
 * hard-earned invariants.
 *
 * Shape parity with `runSkill`:
 *   - same signature: `(name, input, ctx, options) => RunnerResult`
 *   - same input Zod validation on entry
 *   - same joined prompt hash → same `AgentInvocation.promptHash`
 *   - writes to the same `agent_invocations` table so admin metrics +
 *     audit are runtime-agnostic
 *   - reports `status: 'validation_failed' | 'success' | 'error'` the
 *     same way
 *
 * LangChain APIs exercised (kept concentrated in this file so the
 * exposure is obvious to a reader):
 *   - `ChatAnthropic` — model wrapper (replaces raw `@anthropic-ai/sdk`)
 *   - `ChatPromptTemplate` — string → template
 *   - `RunnableSequence` (LCEL) — prompt | model | parser pipe
 *   - `withStructuredOutput(zodSchema)` — schema-safe extraction
 *   - `BaseCallbackHandler` — for `onLLMEnd` cost/latency instrumentation
 *   - LangSmith tracing — env-gated on `LANGSMITH_API_KEY`
 */

import { ChatAnthropic } from '@langchain/anthropic'
import { ChatPromptTemplate } from '@langchain/core/prompts'
import { BaseCallbackHandler } from '@langchain/core/callbacks/base'
import { RunnableSequence } from '@langchain/core/runnables'
import type { Serialized } from '@langchain/core/load/serializable'
import type { LLMResult } from '@langchain/core/outputs'
import { config } from '../../config.js'
import { getSkill, hasSkill } from './registry.js'
import { hashPrompt, writeProvenance } from './runner.js'
import type {
  RunnerResult,
  RunSkillOptions,
  SkillContext,
  SkillName,
} from './types.js'

// One-shot LangSmith opt-in. LangChain reads `LANGSMITH_*` env vars
// automatically once tracing is enabled, so we just gate on the API key.
// Absent key → no-op; developer still gets a fully-working local runtime.
function langSmithEnabled(): boolean {
  return (
    !!process.env.LANGSMITH_API_KEY &&
    process.env.LANGSMITH_TRACING !== 'false'
  )
}

/**
 * Callback handler that captures token usage + latency and hands them
 * back to the caller so we can write the same `AgentInvocation` row the
 * custom runner writes. Mirrors the token/latency accounting in
 * `runner.ts` so both runtimes look identical in `/admin/metrics`.
 */
class UsageCaptureHandler extends BaseCallbackHandler {
  name = 'sentinel-usage-capture'
  tokensIn = 0
  tokensOut = 0
  startedAt = 0
  latencyMs = 0

  handleLLMStart(_llm: Serialized, _prompts: string[]) {
    this.startedAt = Date.now()
  }

  handleLLMEnd(output: LLMResult) {
    this.latencyMs = Date.now() - this.startedAt
    // LangChain surfaces usage under generationInfo / llmOutput depending
    // on provider. Anthropic reports under `llmOutput.usage` with
    // `input_tokens` / `output_tokens`.
    const usage =
      (output.llmOutput?.usage as { input_tokens?: number; output_tokens?: number }) ??
      {}
    this.tokensIn = usage.input_tokens ?? 0
    this.tokensOut = usage.output_tokens ?? 0
  }
}

/**
 * Run a skill through the LangChain runtime. Same public contract as
 * `runSkill`. Callers don't need to pick — `dispatchSkill` looks at the
 * spec's `runtime` field and forwards here or to the custom runner.
 */
export async function runSkillViaLangChain<TInput = unknown, TOutput = unknown>(
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
  const usedModel = spec.model

  // 1. Zod input validation — identical semantics to custom runner.
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

  // 2. Build prompt — reuse the existing spec.buildPrompt closure so this
  // runtime sees the same T1/T2/T4/T5 context tiers the custom runtime
  // would render. Just re-plumbed through LangChain's template layer.
  const { system, user } = spec.buildPrompt(inputCheck.data, ctx)
  const promptHash = hashPrompt(system, user)

  if (!config.anthropicApiKey) {
    return {
      status: 'error',
      errorMessage: 'ANTHROPIC_API_KEY is not configured',
      metrics: { tokensIn: 0, tokensOut: 0, latencyMs: 0, cached: false },
    }
  }

  // 3. Compose the LCEL chain.
  //   prompt | model.withStructuredOutput(zodSchema)
  // The structured-output binding replaces the manual JSON parse + Zod
  // check the custom runner does. LangChain forces the model into a
  // tool-call shape that matches the schema; on invalid output it
  // throws, which we catch below.
  const model = new ChatAnthropic({
    model: spec.model,
    temperature: spec.temperature,
    maxTokens: spec.maxOutputTokens,
    apiKey: config.anthropicApiKey,
    // LangSmith picks up LANGCHAIN_TRACING_V2 automatically when set —
    // we only need the API key + a project name to route runs.
    ...(langSmithEnabled()
      ? {
          clientOptions: {
            defaultHeaders: {
              'anthropic-beta': 'prompt-caching-2024-07-31',
            },
          },
        }
      : {}),
  })

  const structured = model.withStructuredOutput(spec.outputSchema, {
    name: spec.name,
  })

  // LangChain's `ChatPromptTemplate.fromMessages` accepts tuples of
  // (role, content). Content is a raw string here — no interpolation
  // variables because `buildPrompt` already rendered everything.
  const prompt = ChatPromptTemplate.fromMessages([
    ['system', system],
    ['human', user],
  ])

  const chain = RunnableSequence.from([prompt, structured])

  const usage = new UsageCaptureHandler()

  // 4. Invoke chain. Any thrown error becomes a `RunnerResult` with
  // status: 'error' — never let LangChain exceptions escape and crash
  // the caller's route handler.
  let output: TOutput
  try {
    output = (await chain.invoke(
      {},
      {
        callbacks: [usage],
        runName: `sentinel.${spec.name}`,
        tags: ['sentinel', 'langchain-runtime', spec.name],
        metadata: { actor, skill: spec.name, model: usedModel },
      },
    )) as TOutput
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    let invocationId: string | undefined
    if (!options.skipProvenance) {
      invocationId = await writeProvenance({
        skill: name,
        kind: spec.kind,
        model: usedModel,
        promptHash,
        tokensIn: usage.tokensIn,
        tokensOut: usage.tokensOut,
        cached: false,
        latencyMs: usage.latencyMs,
        confidence: null,
        status: 'error',
        errorMessage: `[langchain] ${errMsg}`,
        actor,
      })
    }
    return {
      status: 'error',
      errorMessage: `[langchain] ${errMsg}`,
      invocationId,
      metrics: {
        tokensIn: usage.tokensIn,
        tokensOut: usage.tokensOut,
        latencyMs: usage.latencyMs,
        cached: false,
      },
    }
  }

  // 5. Provenance row — same table, same shape, different runtime.
  // Downstream consumers (admin metrics, audit filters) don't need to
  // know which runtime produced the row.
  let invocationId: string | undefined
  if (!options.skipProvenance) {
    invocationId = await writeProvenance({
      skill: name,
      kind: spec.kind,
      model: usedModel,
      promptHash,
      tokensIn: usage.tokensIn,
      tokensOut: usage.tokensOut,
      cached: false,
      latencyMs: usage.latencyMs,
      confidence: null,
      status: 'success',
      errorMessage: null,
      actor,
    })
  }

  return {
    status: 'success',
    output,
    invocationId,
    metrics: {
      tokensIn: usage.tokensIn,
      tokensOut: usage.tokensOut,
      latencyMs: usage.latencyMs,
      cached: false,
    },
  }
}
