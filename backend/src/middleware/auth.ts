import { FastifyRequest, FastifyReply } from 'fastify'
import jwt from 'jsonwebtoken'
import { config } from '../config.js'
import { UnauthorizedError } from '../lib/errors.js'

export interface AuthUser {
  userId: string
  email: string
  role: string
  name: string
  team: string
}

// Extend FastifyRequest to include user
declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser
  }
}

/**
 * Auth middleware — verifies JWT and injects user into request.
 * Use as a preHandler on protected routes.
 */
export async function requireAuth(request: FastifyRequest, _reply: FastifyReply) {
  const authHeader = request.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Authentication required')
  }

  try {
    const token = authHeader.slice(7)
    const decoded = jwt.verify(token, config.jwtSecret) as AuthUser
    request.user = decoded
  } catch {
    throw new UnauthorizedError('Invalid or expired token')
  }
}

/**
 * Optional auth — extracts user if token present, but doesn't fail if missing.
 * Useful for routes that work differently for authenticated users.
 */
export async function optionalAuth(request: FastifyRequest, _reply: FastifyReply) {
  const authHeader = request.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return

  try {
    const token = authHeader.slice(7)
    const decoded = jwt.verify(token, config.jwtSecret) as AuthUser
    request.user = decoded
  } catch {
    // Token invalid — just continue without user
  }
}
