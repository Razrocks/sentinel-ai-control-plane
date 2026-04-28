/**
 * Phase 8 smoke test — runs without an Anthropic API key.
 *
 * Verifies:
 *   - all 12 skills registered
 *   - input validation rejects malformed payloads
 *   - prompt builders produce non-empty system + user strings
 *   - getSkill / hasSkill / listSkills return expected shapes
 *
 * Run: tsx backend/src/services/skills/__smoke.ts
 */

import {
  SKILL_NAMES,
  listSkills,
  getSkill,
  hasSkill,
  buildSystemPrompt,
  renderInputAsJson,
  isSkillRunnerConfigured,
  runSkill,
  type SkillContext,
} from './index.js'

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
  console.log('Phase 8 smoke test\n==================\n')
  console.log(`API key configured: ${isSkillRunnerConfigured() ? 'yes' : 'no (input/schema checks only)'}\n`)

  // 1. Registry coverage
  console.log('1. Registry coverage')
  const registered = listSkills()
  check(
    `12 skills registered (got ${registered.length})`,
    registered.length === 12,
  )
  for (const name of SKILL_NAMES) {
    check(`registry contains "${name}"`, hasSkill(name))
  }
  check('hasSkill rejects unknown name', !hasSkill('not_a_real_skill'))

  // 2. Spec shape
  console.log('\n2. Spec shape')
  for (const name of SKILL_NAMES) {
    const spec = getSkill(name)
    check(`${name}: model present`, typeof spec.model === 'string' && spec.model.length > 0)
    check(`${name}: temperature in [0,1]`, spec.temperature >= 0 && spec.temperature <= 1)
    check(`${name}: token budgets > 0`, spec.maxInputTokens > 0 && spec.maxOutputTokens > 0)
    check(`${name}: kind === agentic`, spec.kind === 'agentic')
    check(`${name}: has Zod inputSchema`, typeof spec.inputSchema.safeParse === 'function')
    check(`${name}: has Zod outputSchema`, typeof spec.outputSchema.safeParse === 'function')
    check(`${name}: has buildPrompt fn`, typeof spec.buildPrompt === 'function')
    check(
      `${name}: auditAction non-empty`,
      typeof spec.auditAction === 'string' && spec.auditAction.length > 0,
    )
  }

  // 3. Prompt builders produce strings
  console.log('\n3. Prompt builders')
  const ctx: SkillContext = {
    actor: 'system',
    t1: {
      policyBundle: {
        bundleVersion: 'v1.0.0',
        rules: [
          {
            name: 'production-write-guard',
            description: 'Blocks writes during pending approval',
            bundle: 'core',
            decision: 'deny',
            scope: 'production',
            appliesTo: ['change'],
          },
        ],
        activeFreezes: [
          {
            id: 'frz-001',
            label: 'Q1 close',
            scope: 'all-production',
            startsAt: '2026-04-25T00:00:00Z',
            endsAt: '2026-04-30T23:59:59Z',
            affectsServices: ['payment-service'],
          },
        ],
      },
      roleConstraints: {
        role: 'operator',
        label: 'Operator',
        description: 'change review and routing',
        allowed: ['Triage'],
        blocked: ['Approve'],
      },
      orgCatalog: {
        users: [
          {
            id: 'usr-1',
            name: 'M. Liu',
            email: 'm.liu@sentinel.dev',
            role: 'engineer',
            team: 'Payments',
            managerId: 'usr-2',
            systemsOwned: ['payment-service'],
          },
        ],
        services: {
          'payment-service': {
            team: 'Payments',
            criticality: 'critical',
            ownerUserIds: ['usr-1'],
            downstream: ['order-api'],
          },
        },
        approverRegistry: {
          'SRE-Owner': ['usr-2'],
        },
      },
    },
    t5: {
      now: '2026-04-27T10:00:00Z',
      activeFreezes: [{ id: 'frz-001', label: 'Q1 close', endsAt: '2026-04-30T23:59:59Z' }],
    },
  }

  const sysPrompt = buildSystemPrompt(ctx, {
    taskInstructions: 'Test task instructions.',
  })
  check('buildSystemPrompt returns non-empty string', sysPrompt.length > 0)
  check('system prompt contains identity', sysPrompt.includes('Identity'))
  check('system prompt contains policy bundle', sysPrompt.includes('Active Policy Bundle'))
  check('system prompt contains org catalog', sysPrompt.includes('Org & Service Catalog'))
  check('system prompt contains temporal', sysPrompt.includes('Temporal'))
  check('system prompt contains task', sysPrompt.includes('Test task instructions.'))

  const userMsg = renderInputAsJson({ hello: 'world' })
  check('renderInputAsJson includes JSON block', userMsg.includes('```json'))
  check('renderInputAsJson asks for strict JSON output', userMsg.includes('No prose, no code fences'))

  // 4. Input validation rejects malformed payloads
  console.log('\n4. Input validation (validation_failed without API call)')

  const badAssess = await runSkill(
    'assess_change',
    { change: { ticketId: 'CHG-1' } } /* missing fields */,
    ctx,
    { skipProvenance: true },
  )
  check('assess_change rejects malformed input', badAssess.status === 'validation_failed')
  check(
    'assess_change error mentions input validation',
    badAssess.errorMessage?.includes('input validation failed') ?? false,
  )

  const badTriage = await runSkill('triage_incident', {} as never, ctx, { skipProvenance: true })
  check('triage_incident rejects empty input', badTriage.status === 'validation_failed')

  const badRoute = await runSkill(
    'route_request',
    { entity: { type: 'change' } } as never,
    ctx,
    { skipProvenance: true },
  )
  check('route_request rejects malformed input', badRoute.status === 'validation_failed')

  // 5. Per-skill: build a valid input, verify prompt builds without error
  console.log('\n5. Per-skill prompt build (with valid minimal input)')

  type Sample = { name: Parameters<typeof getSkill>[0]; input: unknown }
  const samples: Sample[] = [
    {
      name: 'assess_change',
      input: {
        change: {
          id: 'c1',
          ticketId: 'CHG-1',
          title: 't',
          description: 'd',
          owner: 'o',
          ownerTeam: 'ot',
          service: 'payment-service',
          environment: 'production',
          riskLevel: 'medium',
          linkedPRs: [],
          ciStatus: 'passing',
          maintenanceWindow: null,
          maintenanceWindowStart: null,
          maintenanceWindowEnd: null,
          rollbackPlan: true,
        },
      },
    },
    {
      name: 'analyze_blast_radius',
      input: {
        change: {
          id: 'c1',
          ticketId: 'CHG-1',
          title: 't',
          description: 'd',
          service: 'payment-service',
          environment: 'production',
          linkedPRs: [],
        },
        candidates: [
          {
            name: 'payment-service',
            type: 'service',
            sourceOfDiscovery: 'service_catalog',
            rawSignal: 'primary',
          },
        ],
        serviceCatalogSnippet: {
          'payment-service': { team: 'Payments', criticality: 'critical', downstream: [] },
        },
      },
    },
    {
      name: 'triage_incident',
      input: {
        incident: {
          id: 'i1',
          incidentId: 'INC-1',
          title: 't',
          description: 'd',
          requester: 'r',
          affectedService: 'payment-service',
          severity: 'sev2',
          assignmentGroup: 'Payments',
          relatedCI: [],
          isRecurring: false,
        },
      },
    },
    {
      name: 'evaluate_access_request',
      input: {
        request: {
          id: 'a1',
          requestId: 'AR-1',
          requester: 'r',
          requesterEmail: 'r@x',
          requestedSystem: 'data-warehouse',
          requestedRole: 'read',
          justification: 'j',
          manager: 'm',
          systemOwner: 'so',
          riskLevel: 'medium',
          entitlementCheck: 'review_required',
        },
        requesterContext: {
          role: 'engineer',
          team: 'Payments',
          managerId: null,
          systemsOwned: [],
          pastRequests: [],
        },
        systemContext: {
          catalogTier: 'high',
          rolePrivilegeLevel: 'read',
          activeFreezeAffectingSystem: false,
        },
      },
    },
    {
      name: 'support_approval_decision',
      input: {
        approval: {
          id: 'ap1',
          type: 'change',
          title: 't',
          requester: 'r',
          impactedSystem: 'payment-service',
          riskLevel: 'high',
          reason: 'r',
          recommendedAction: 'a',
          linkedObjectId: 'c1',
          coApprovals: [{ role: 'SRE-Owner', name: 'J. Wu', status: 'pending' }],
        },
        linkedEntity: { type: 'change', data: {} },
        policyContext: {
          activePolicyRules: [],
          activeFreezesAffecting: [],
        },
      },
    },
    {
      name: 'route_request',
      input: {
        entity: {
          type: 'change',
          id: 'c1',
          title: 't',
          relevantFields: { service: 'payment-service' },
        },
        policyContext: {
          requiredApproverRoles: ['SRE-Owner'],
          activeFreezesAffecting: [],
        },
        orgCatalog: {
          usersByRole: { 'SRE-Owner': [{ id: 'u1', name: 'J. Wu', team: 'SRE' }] },
          serviceOwners: { 'payment-service': [{ id: 'u1', name: 'J. Wu', team: 'SRE' }] },
          managerHierarchy: { u1: null },
        },
        mode: 'construct_chain',
      },
    },
    {
      name: 'propose_bounded_remediation',
      input: {
        incident: {
          id: 'i1',
          incidentId: 'INC-1',
          title: 't',
          description: 'd',
          affectedService: 'payment-service',
          severity: 'sev2',
        },
        authorContext: {
          name: 'M. Liu',
          role: 'engineer',
          team: 'Payments',
          systemsOwned: ['payment-service'],
        },
        intent: 'rollback',
      },
    },
    {
      name: 'draft_approval_packet',
      input: {
        change: {
          id: 'c1',
          ticketId: 'CHG-1',
          title: 't',
          description: 'd',
          owner: 'o',
          service: 'payment-service',
          environment: 'production',
          riskLevel: 'high',
        },
        approval: null,
        policyContext: {
          policyDecision: 'escalate',
          matchedRule: 'freeze-window-overlap',
          activeFreezesAffecting: ['frz-001'],
        },
        audience: 'approver_review',
      },
    },
    {
      name: 'draft_work_note',
      input: {
        incident: {
          id: 'i1',
          incidentId: 'INC-1',
          title: 't',
          description: 'd',
          affectedService: 'payment-service',
          severity: 'sev2',
          status: 'investigating',
          assignmentGroup: 'Payments',
          likelyIssueType: 'elevated 5xx',
          rootCauseCategory: 'deploy-correlated',
          relatedChanges: ['CHG-1'],
          isRecurring: false,
        },
        authorContext: { name: 'M. Liu', role: 'engineer', team: 'Payments' },
        intent: 'investigation_update',
      },
    },
    {
      name: 'draft_customer_response',
      input: {
        incident: {
          incidentId: 'INC-1',
          title: 't',
          description: 'd',
          affectedService: 'payment-service',
          severity: 'sev2',
          status: 'investigating',
          likelyIssueType: 'elevated 5xx',
        },
        channel: 'status_page',
        intent: 'investigating',
      },
    },
    {
      name: 'explain_policy_decision',
      input: {
        decision: 'deny',
        matchedRule: {
          name: 'freeze-window-overlap',
          description: 'Blocks during active freeze',
          bundle: 'core',
          scope: 'production',
          appliesTo: ['change'],
        },
        context: {
          objectType: 'change',
          objectId: 'CHG-1',
          objectTitle: 't',
          relevantFields: { environment: 'production' },
        },
        audience: { role: 'operator', name: 'M. Liu' },
      },
    },
    {
      name: 'summarize_decision_impact',
      input: {
        approval: {
          id: 'ap1',
          type: 'change',
          title: 't',
          riskLevel: 'high',
          decisionImpact: { approve: 'a', deny: 'd', escalate: 'e' },
          coApprovals: [],
          condition: null,
        },
        format: 'one_line',
      },
    },
  ]

  for (const s of samples) {
    const spec = getSkill(s.name)
    const inputCheck = spec.inputSchema.safeParse(s.input)
    check(`${s.name}: sample input parses`, inputCheck.success)
    if (inputCheck.success) {
      const { system, user } = spec.buildPrompt(inputCheck.data, ctx)
      check(`${s.name}: system prompt non-empty`, system.length > 0)
      check(`${s.name}: user message contains JSON`, user.includes('```json'))
    }
  }

  // 6. Final tally
  console.log('\n==================')
  console.log(`Pass: ${pass}`)
  console.log(`Fail: ${fail}`)
  console.log(fail === 0 ? 'OK\n' : 'FAILED\n')
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('Smoke test crashed:', err)
  process.exit(2)
})
