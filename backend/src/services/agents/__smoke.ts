/**
 * Phase 9 smoke test — verifies agent + context-loader wiring.
 *
 * Skips actual skill invocations (those require ANTHROPIC_API_KEY).
 * Verifies:
 *   - Context loaders pull data from DB without crashing
 *   - All four agent functions are exported and callable shapes
 *   - Service catalog snippet is built correctly
 *
 * Run: tsx backend/src/services/agents/__smoke.ts
 */

import {
  buildBaseContext,
  loadPolicyBundle,
  loadOrgCatalog,
  loadTemporal,
  loadRoleConstraints,
  loadChangeT2Extras,
  loadIncidentT2Extras,
  loadAuditSlice,
  triageChange,
  triageIncident,
  reviewAccessRequest,
  routeApproval,
} from './index.js'
import { prisma } from '../../lib/prisma.js'

let pass = 0
let fail = 0

function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    pass++
    console.log(`  PASS  ${label}`)
  } else {
    fail++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

async function main() {
  console.log('Phase 9 smoke test\n==================\n')

  // 1. Functions exported
  console.log('1. Agent functions exported')
  check('triageChange exported', typeof triageChange === 'function')
  check('triageIncident exported', typeof triageIncident === 'function')
  check('reviewAccessRequest exported', typeof reviewAccessRequest === 'function')
  check('routeApproval exported', typeof routeApproval === 'function')

  // 2. Context loaders
  console.log('\n2. Context loaders (DB-backed)')
  let policy: Awaited<ReturnType<typeof loadPolicyBundle>>
  let orgCatalog: Awaited<ReturnType<typeof loadOrgCatalog>>
  let temporal: Awaited<ReturnType<typeof loadTemporal>>
  try {
    policy = await loadPolicyBundle()
    check('loadPolicyBundle returns bundleVersion', typeof policy.bundleVersion === 'string')
    check('loadPolicyBundle returns rules array', Array.isArray(policy.rules))
    check('loadPolicyBundle returns activeFreezes array', Array.isArray(policy.activeFreezes))
  } catch (err) {
    fail++
    console.log(`  FAIL  loadPolicyBundle threw: ${(err as Error).message}`)
  }

  try {
    orgCatalog = await loadOrgCatalog()
    check('loadOrgCatalog returns users array', Array.isArray(orgCatalog.users))
    check(
      `loadOrgCatalog has services map (${Object.keys(orgCatalog.services).length} services)`,
      Object.keys(orgCatalog.services).length > 0,
    )
    check('loadOrgCatalog has approverRegistry', typeof orgCatalog.approverRegistry === 'object')

    // payment-service should be in the catalog with criticality=critical
    const ps = orgCatalog.services['payment-service']
    if (ps) {
      check('payment-service in catalog', true)
      check('payment-service criticality=critical', ps.criticality === 'critical')
    } else {
      check('payment-service in catalog', false, 'service not found in catalog')
    }
  } catch (err) {
    fail++
    console.log(`  FAIL  loadOrgCatalog threw: ${(err as Error).message}`)
  }

  try {
    temporal = await loadTemporal()
    check('loadTemporal returns now string', typeof temporal.now === 'string')
    check('loadTemporal returns activeFreezes array', Array.isArray(temporal.activeFreezes))
  } catch (err) {
    fail++
    console.log(`  FAIL  loadTemporal threw: ${(err as Error).message}`)
  }

  // 3. Role constraints
  console.log('\n3. Role constraints')
  for (const role of [
    'operator',
    'engineer',
    'it_support',
    'approver',
    'access_approver',
    'admin',
    'unknown_role',
  ]) {
    const r = loadRoleConstraints(role)
    check(`loadRoleConstraints("${role}") returns label`, typeof r.label === 'string')
  }

  // 4. T2 extras (need a service that exists)
  console.log('\n4. T2 extras')
  try {
    const t2c = await loadChangeT2Extras('payment-service')
    check('loadChangeT2Extras returns deploys array', Array.isArray(t2c.recentDeploysOnService))
  } catch (err) {
    fail++
    console.log(`  FAIL  loadChangeT2Extras threw: ${(err as Error).message}`)
  }

  try {
    const t2i = await loadIncidentT2Extras('payment-service')
    check('loadIncidentT2Extras returns deploys array', Array.isArray(t2i.recentDeploysOnService))
    check('loadIncidentT2Extras returns incidents array', Array.isArray(t2i.recentIncidentsOnService))
  } catch (err) {
    fail++
    console.log(`  FAIL  loadIncidentT2Extras threw: ${(err as Error).message}`)
  }

  // 5. T4 audit slice
  console.log('\n5. T4 audit slice')
  try {
    const audit = await loadAuditSlice({
      objectType: 'change',
      objectId: 'nonexistent',
      limit: 5,
    })
    check('loadAuditSlice returns array', Array.isArray(audit.recentAuditEvents))
  } catch (err) {
    fail++
    console.log(`  FAIL  loadAuditSlice threw: ${(err as Error).message}`)
  }

  // 6. Composite buildBaseContext
  console.log('\n6. buildBaseContext composite')
  try {
    const ctx = await buildBaseContext({ actor: 'system', role: 'operator' })
    check('ctx.actor === system', ctx.actor === 'system')
    check('ctx.t1?.policyBundle present', !!ctx.t1?.policyBundle)
    check('ctx.t1?.orgCatalog present', !!ctx.t1?.orgCatalog)
    check('ctx.t1?.roleConstraints present', !!ctx.t1?.roleConstraints)
    check('ctx.t5 present', !!ctx.t5)
  } catch (err) {
    fail++
    console.log(`  FAIL  buildBaseContext threw: ${(err as Error).message}`)
  }

  // 7. Agent function rejection on missing entity
  console.log('\n7. Agent error paths (no API key required)')
  try {
    await triageChange({ changeId: 'nonexistent-cuid' })
    check('triageChange rejects unknown id', false, 'expected throw')
  } catch (err) {
    check('triageChange rejects unknown id', (err as Error).message.includes('not found'))
  }

  try {
    await triageIncident({ incidentDbId: 'nonexistent-cuid' })
    check('triageIncident rejects unknown id', false, 'expected throw')
  } catch (err) {
    check('triageIncident rejects unknown id', (err as Error).message.includes('not found'))
  }

  try {
    await reviewAccessRequest({ accessRequestDbId: 'nonexistent-cuid' })
    check('reviewAccessRequest rejects unknown id', false, 'expected throw')
  } catch (err) {
    check(
      'reviewAccessRequest rejects unknown id',
      (err as Error).message.includes('not found'),
    )
  }

  try {
    await routeApproval({ approvalId: 'nonexistent-cuid' })
    check('routeApproval rejects unknown id', false, 'expected throw')
  } catch (err) {
    check('routeApproval rejects unknown id', (err as Error).message.includes('not found'))
  }

  // 8. Final tally
  console.log('\n==================')
  console.log(`Pass: ${pass}`)
  console.log(`Fail: ${fail}`)
  console.log(fail === 0 ? 'OK\n' : 'FAILED\n')

  await prisma.$disconnect()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async (err) => {
  console.error('Smoke test crashed:', err)
  await prisma.$disconnect()
  process.exit(2)
})
