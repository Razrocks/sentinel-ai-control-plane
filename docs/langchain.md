# LangChain integration

Sentinel uses LangChain in two narrow places rather than as a top-level
framework. Everywhere else the platform talks to Anthropic through the
raw SDK — the custom skill runner owns prompt caching, self-critique,
provenance, and reliability wrappers, and none of those benefit from a
framework abstraction.

## Where LangChain is used

### 1. RAG over the doc corpus (chat)

Backend: [`backend/src/services/rag/indexer.ts`](../backend/src/services/rag/indexer.ts) + [`backend/src/services/chat-tools.ts`](../backend/src/services/chat-tools.ts).

The chat surface already knew how to look up structured entities via
`chat-tools.ts` (users, services, changes, etc). It couldn't quote
Sentinel's own architecture. A `lookup_docs` tool now retrieves chunks
of `docs/**/*.md` + `skills/**/skill.md` by cosine similarity so chat
answers about the system itself cite the actual design doc.

Stack:

- **`MemoryVectorStore`** — in-memory, rebuilds per process. Fine at
  personal-project scope; swap for pgvector or Chroma when the corpus
  grows past a few hundred docs.
- **`HuggingFaceTransformersEmbeddings` (`Xenova/all-MiniLM-L6-v2`)** —
  local ONNX embeddings, no embedding API key required. One-time ~120MB
  model download cached under `~/.cache/huggingface`. Trade-off vs
  OpenAI/Voyage embeddings: lower quality but zero cost and no
  third-party call.
- **`RecursiveCharacterTextSplitter`** — 800-char chunks with 100-char
  overlap. Fits the markdown section shape without splitting mid-sentence
  too often.

Warm-up runs from `server.ts` at boot in the background so the first
`lookup_docs` call doesn't pay the model-download + indexing latency.

### 2. Skill runtime for `explain_policy_decision`

Backend: [`backend/src/services/skills/langchain-runner.ts`](../backend/src/services/skills/langchain-runner.ts) + `runtime: 'langchain'` flag on the SkillSpec.

One skill runs through LangChain end-to-end as a reference example. The
target is `explain_policy_decision` because it's low-stakes (advisory
prose, no persistence side-effects) and its Zod output schema maps
cleanly onto LangChain's `withStructuredOutput`.

Stack:

- **`ChatAnthropic`** (`@langchain/anthropic`) — model wrapper. Replaces
  the direct `@anthropic-ai/sdk` call for this one skill.
- **`ChatPromptTemplate.fromMessages`** — turns the existing
  `spec.buildPrompt(input, ctx)` output into a LangChain template. No
  interpolation variables — the runner has already rendered all
  T1/T2/T4/T5 context tiers upstream.
- **`RunnableSequence`** (LCEL pipe) — composes prompt + model +
  structured-output binding.
- **`withStructuredOutput(zodSchema)`** — schema-safe extraction. On
  invalid output LangChain throws; we catch and return the same
  `RunnerResult { status: 'error' }` shape the custom runner would.
- **`BaseCallbackHandler`** — a `UsageCaptureHandler` records tokens +
  latency out of `handleLLMEnd`. Same shape as the custom runner's
  token accounting, so admin metrics don't need to know which runtime
  produced the row.
- **LangSmith tracing** — env-gated on `LANGSMITH_API_KEY`. When set
  and `LANGSMITH_TRACING !== 'false'` the run appears in the LangSmith
  hosted UI with tags `['sentinel', 'langchain-runtime', <skill>]`.

## The runtime flag

`SkillSpec` gets an optional `runtime?: 'custom' | 'langchain'` field
(defaults to `'custom'`). `runSkill` in
[`backend/src/services/skills/runner.ts`](../backend/src/services/skills/runner.ts)
inspects the flag and delegates to the LangChain runner when set. This
lets both runtimes coexist without callers changing anything —
`agents/*.ts` just calls `runSkill('explain_policy_decision', …)` and
doesn't need to know.

## Why the split

The custom runner owns:

- Prompt-cache splits (Anthropic ephemeral cache, 5-min TTL)
- A9 self-critique via a separate critic model
- Reference validation (`validate-references.ts`) as post-schema
  hallucination defence
- Reliability wrappers (retry / breaker / rate-limit / cost-cap /
  fallback-model)
- Structured `AgentInvocation` provenance rows keyed on `promptHash`

Migrating everything to LangChain would either bypass those guarantees
or force a rewrite that regresses them. Coexisting both runtimes keeps
the platform's hard-earned invariants and gets the LangChain surface for
one clean reference skill.

## Environment

Optional variables (add to `backend/.env` when opting in):

```
LANGSMITH_API_KEY=…       # required to enable tracing
LANGSMITH_PROJECT=sentinel # display group in LangSmith UI
LANGSMITH_TRACING=true    # explicit opt-in
```

Without these, everything still works — LangChain just doesn't ship
traces anywhere.
