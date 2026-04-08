import { prisma } from '../lib/prisma.js'
import type { PolicyDecision } from '@prisma/client'

// ─── Types ──────────────────────────────────────────────

export interface PolicyEvaluation {
  allowed: boolean
  decision: PolicyDecision
  matchedRule: string | null
  reason: string
}

export interface ExecutionCheck {
  allowed: boolean
  rule: string | null
  reason: string
}

// ─── Policy Evaluation ──────────────────────────────────

/**
 * Evaluate an action against active policy rules.
 *
 * Loads all active rules whose `appliesTo` includes the given objectType,
 * then matches by scope against the object's environment.
 *
 * Returns the most restrictive matching policy (deny > escalate > simulate_only > allow).
 */
export async function evaluatePolicy(
  objectType: string,
  context: {
    environment?: string
    riskLevel?: string
    service?: string
  }
): Promise<PolicyEvaluation> {
  // Load all active policy rules that apply to this object type
  const rules = await prisma.policyRule.findMany({
    where: {
      isActive: true,
      appliesTo: { has: objectType },
    },
  })

  if (rules.length === 0) {
    return {
      allowed: true,
      decision: 'allow',
      matchedRule: null,
      reason: 'No active policy rules apply to this object type.',
    }
  }

  // Filter by scope — match rules whose scope includes the object's environment
  const matchingRules = rules.filter(rule => {
    const scope = rule.scope.toLowerCase()

    // "all" or "all-environments" matches everything
    if (scope === 'all' || scope === 'all-environments') return true

    // Match environment name directly
    if (context.environment && scope.includes(context.environment.toLowerCase())) return true

    // Match "production" scope for production environment
    if (context.environment?.toLowerCase() === 'production' && scope.includes('production')) return true

    return false
  })

  if (matchingRules.length === 0) {
    return {
      allowed: true,
      decision: 'allow',
      matchedRule: null,
      reason: 'No policy rules match the current scope.',
    }
  }

  // Priority ordering: deny > escalate > simulate_only > allow
  const priorityOrder: PolicyDecision[] = ['deny', 'escalate', 'simulate_only', 'allow']

  // Sort by priority (most restrictive first)
  matchingRules.sort((a, b) => {
    return priorityOrder.indexOf(a.decision) - priorityOrder.indexOf(b.decision)
  })

  const topRule = matchingRules[0]

  return {
    allowed: topRule.decision === 'allow',
    decision: topRule.decision,
    matchedRule: topRule.name,
    reason: topRule.description,
  }
}

// ─── Execution Checks ───────────────────────────────────

/**
 * Check whether a change can be executed (deployed).
 *
 * Validates:
 * 1. Change exists
 * 2. Approval state is 'approved'
 * 3. Policy decision is not 'deny'
 * 4. Maintenance window (if set) — currently informational only
 *
 * Returns { allowed, rule, reason } for the action endpoint to use.
 */
export async function checkExecutionAllowed(changeId: string): Promise<ExecutionCheck> {
  const change = await prisma.change.findFirst({
    where: {
      OR: [
        { id: changeId },
        { ticketId: changeId },
      ],
    },
  })

  if (!change) {
    return {
      allowed: false,
      rule: null,
      reason: `Change '${changeId}' not found.`,
    }
  }

  // 1. Check approval state
  if (change.approvalState !== 'approved') {
    return {
      allowed: false,
      rule: 'approval-required',
      reason: `Change requires approval before execution. Current approval state: ${change.approvalState}`,
    }
  }

  // 2. Check policy decision
  if (change.policyDecision === 'deny') {
    return {
      allowed: false,
      rule: 'policy-denied',
      reason: 'Change execution is denied by policy.',
    }
  }

  if (change.policyDecision === 'simulate_only') {
    return {
      allowed: false,
      rule: 'simulate-only',
      reason: 'Policy allows simulation only. Direct execution is blocked.',
    }
  }

  if (change.policyDecision === 'escalate') {
    return {
      allowed: false,
      rule: 'escalation-required',
      reason: 'Change requires escalation review before execution.',
    }
  }

  // 3. Evaluate against active policy rules for the change's environment
  const policyEval = await evaluatePolicy('change', {
    environment: change.environment,
    riskLevel: change.riskLevel,
    service: change.service,
  })

  if (!policyEval.allowed && policyEval.decision === 'deny') {
    return {
      allowed: false,
      rule: policyEval.matchedRule || 'policy-denied',
      reason: policyEval.reason,
    }
  }

  // 4. Check maintenance window (informational — log it but don't block for MVP)
  // In production, this would check if current time is within the maintenance window

  return {
    allowed: true,
    rule: null,
    reason: 'All checks passed. Execution is allowed.',
  }
}

/**
 * Check whether simulation is allowed for a change.
 * Simulation is generally more permissive — it's allowed even on
 * changes that aren't fully approved, as long as policy doesn't explicitly deny.
 */
export async function checkSimulationAllowed(changeId: string): Promise<ExecutionCheck> {
  const change = await prisma.change.findFirst({
    where: {
      OR: [
        { id: changeId },
        { ticketId: changeId },
      ],
    },
  })

  if (!change) {
    return {
      allowed: false,
      rule: null,
      reason: `Change '${changeId}' not found.`,
    }
  }

  // Only deny simulation if policy explicitly denies the change
  if (change.policyDecision === 'deny') {
    const policyEval = await evaluatePolicy('change', {
      environment: change.environment,
      riskLevel: change.riskLevel,
      service: change.service,
    })

    // Even with deny, check if any rule specifically blocks simulation
    if (policyEval.decision === 'deny') {
      return {
        allowed: false,
        rule: policyEval.matchedRule || 'policy-denied',
        reason: 'Policy denies all operations on this change, including simulation.',
      }
    }
  }

  return {
    allowed: true,
    rule: null,
    reason: 'Simulation is allowed.',
  }
}
