/**
 * Eval harness runner. Loads golden files, calls each skill, applies expectations.
 *
 * Usage:
 *   npm run eval                  # run all skill goldens
 *   npm run eval -- assess_change # run one skill
 *
 * Costs money (real Anthropic calls). Prompt caching is in effect — second
 * sample for the same skill hits cache → 75%+ cheaper.
 *
 * Exit code: 0 on full pass, 1 on any failure.
 */

import { readdir, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runSkill, type SkillContext, type SkillName, isSkillRunnerConfigured } from '../src/services/skills/index.js'
import { buildBaseContext } from '../src/services/agents/index.js'
import { applyExpectation } from './assertions.js'
import type { EvalReport, GoldenFile, SampleResult, SkillResult } from './types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SKILLS_DIR = join(__dirname, 'skills')

const HAIKU_IN = 1
const HAIKU_OUT = 5
const SONNET_IN = 3
const SONNET_OUT = 15

function estimateCost(model: string, tokensIn: number, tokensOut: number): number {
  const isHaiku = model.includes('haiku')
  const inRate = isHaiku ? HAIKU_IN : SONNET_IN
  const outRate = isHaiku ? HAIKU_OUT : SONNET_OUT
  return (tokensIn * inRate + tokensOut * outRate) / 1_000_000
}

async function loadGoldens(skillFilter?: string): Promise<GoldenFile[]> {
  const entries = await readdir(SKILLS_DIR)
  const out: GoldenFile[] = []
  for (const f of entries) {
    if (!f.endsWith('.golden.json')) continue
    const skillName = f.replace(/\.golden\.json$/, '')
    if (skillFilter && skillFilter !== skillName) continue
    const text = await readFile(join(SKILLS_DIR, f), 'utf-8')
    const data = JSON.parse(text) as GoldenFile
    out.push(data)
  }
  return out
}

async function runOneSample(
  skill: SkillName,
  sample: GoldenFile['samples'][number],
  baseCtx: SkillContext,
): Promise<{ result: SampleResult; model: string }> {
  const ctx: SkillContext = { ...baseCtx, ...(sample.ctxOverride ?? {}) }
  const startedAt = Date.now()
  const r = await runSkill(skill, sample.input, ctx, { skipProvenance: true, actor: 'eval' })
  const latencyMs = Date.now() - startedAt

  // Apply each expectation against the output (or empty obj if failed)
  const assertions = sample.expectations.map((exp) =>
    applyExpectation(exp, r.output ?? {}, r.status),
  )

  return {
    result: {
      sample,
      status: r.status,
      assertions,
      metrics: {
        tokensIn: r.metrics.tokensIn,
        tokensOut: r.metrics.tokensOut,
        latencyMs,
        cached: r.metrics.cached,
      },
      errorMessage: r.errorMessage,
    },
    model: (await import('../src/services/skills/registry.js')).getSkill(skill).model,
  }
}

async function main() {
  if (!isSkillRunnerConfigured()) {
    console.error('FAIL: ANTHROPIC_API_KEY not set in .env')
    process.exit(2)
  }

  const skillFilter = process.argv[2]
  if (skillFilter) console.log(`Filter: skill=${skillFilter}`)

  const goldens = await loadGoldens(skillFilter)
  if (goldens.length === 0) {
    console.error(`No golden files found${skillFilter ? ` for skill "${skillFilter}"` : ''}`)
    process.exit(2)
  }

  console.log(`Loaded ${goldens.length} golden file(s)`)
  console.log(`Building base context (loads policy bundle + org catalog from DB)...`)
  const baseCtx = await buildBaseContext({ actor: 'eval', role: 'operator' })

  const startedAt = Date.now()
  const skillResults: SkillResult[] = []
  let totalPass = 0
  let totalFail = 0
  let totalCost = 0

  for (const g of goldens) {
    console.log(`\n=== ${g.skill} (${g.samples.length} samples) ===`)
    const sampleResults: SampleResult[] = []
    let skillCost = 0

    for (const s of g.samples) {
      process.stdout.write(`  [${s.name}] `)
      const { result, model } = await runOneSample(g.skill, s, baseCtx)
      sampleResults.push(result)
      const cost = estimateCost(model, result.metrics.tokensIn, result.metrics.tokensOut)
      skillCost += cost
      const passCount = result.assertions.filter((a) => a.pass).length
      const failCount = result.assertions.length - passCount
      const verdict = failCount === 0 ? 'PASS' : `FAIL (${failCount}/${result.assertions.length})`
      const cacheMark = result.metrics.cached ? ' (cached)' : ''
      console.log(`${verdict} — ${result.metrics.latencyMs}ms $${cost.toFixed(4)}${cacheMark}`)
      if (result.errorMessage) console.log(`    error: ${result.errorMessage}`)
      for (const a of result.assertions) {
        if (!a.pass) console.log(`    × ${a.expectation.label ?? a.expectation.kind}: ${a.reason}`)
      }
    }

    const passSamples = sampleResults.filter((r) => r.assertions.every((a) => a.pass)).length
    const failSamples = sampleResults.length - passSamples
    const totalAssertions = sampleResults.reduce((acc, r) => acc + r.assertions.length, 0)
    const passedAssertions = sampleResults.reduce(
      (acc, r) => acc + r.assertions.filter((a) => a.pass).length,
      0,
    )

    skillResults.push({
      skill: g.skill,
      samples: sampleResults,
      passCount: passSamples,
      failCount: failSamples,
      totalAssertions,
      passedAssertions,
      costUsd: skillCost,
    })
    totalPass += passSamples
    totalFail += failSamples
    totalCost += skillCost
  }

  const report: EvalReport = {
    startedAt: new Date(startedAt).toISOString(),
    durationMs: Date.now() - startedAt,
    skills: skillResults,
    totalPass,
    totalFail,
    totalCostUsd: totalCost,
  }

  console.log('\n' + '='.repeat(60))
  console.log('SUMMARY')
  console.log('='.repeat(60))
  for (const s of skillResults) {
    const status = s.failCount === 0 ? 'PASS' : 'FAIL'
    console.log(
      `  ${status}  ${s.skill}: ${s.passCount}/${s.samples.length} samples, ${s.passedAssertions}/${s.totalAssertions} assertions, $${s.costUsd.toFixed(4)}`,
    )
  }
  console.log('-'.repeat(60))
  console.log(`Total samples: ${totalPass} PASS, ${totalFail} FAIL`)
  console.log(`Total cost: $${totalCost.toFixed(4)}`)
  console.log(`Duration: ${(report.durationMs / 1000).toFixed(1)}s`)

  process.exit(totalFail === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('eval crashed:', err)
  process.exit(2)
})
