import { FastifyRequest, FastifyReply } from 'fastify'
import { ForbiddenError, UnauthorizedError } from '../lib/errors.js'

type Role = 'operator' | 'engineer' | 'it_support' | 'approver' | 'access_approver' | 'admin'

/**
 * Create a preHandler that requires one of the specified roles.
 * Must be used AFTER requireAuth middleware.
 */
export function requireRole(...roles: Role[]) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    if (!request.user) {
      throw new UnauthorizedError('Authentication required')
    }

    if (!roles.includes(request.user.role as Role)) {
      throw new ForbiddenError(`Role '${request.user.role}' is not authorized for this action. Required: ${roles.join(', ')}`)
    }
  }
}

/**
 * Route-level action guard.
 * Maps action names to allowed roles (mirrors frontend roles.tsx).
 */
const actionRoles: Record<string, Role[]> = {
  approve: ['approver', 'access_approver', 'admin'],
  deny: ['approver', 'access_approver', 'admin'],
  approve_with_condition: ['approver', 'admin'],
  execute: ['admin'],
  simulate: ['engineer', 'approver', 'admin'],
  draft: ['engineer', 'it_support', 'admin'],
  escalate: ['operator', 'engineer', 'it_support', 'approver', 'access_approver', 'admin'],
  create_pr: ['engineer', 'admin'],
  edit_policy: ['admin'],
}

export function requireAction(action: string) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    if (!request.user) {
      throw new UnauthorizedError('Authentication required')
    }

    const allowed = actionRoles[action]
    if (!allowed) {
      throw new ForbiddenError(`Unknown action: ${action}`)
    }

    if (!allowed.includes(request.user.role as Role)) {
      throw new ForbiddenError(`Role '${request.user.role}' cannot perform action '${action}'`)
    }
  }
}
