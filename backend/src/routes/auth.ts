import { FastifyInstance } from 'fastify'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { prisma } from '../lib/prisma.js'
import { config } from '../config.js'
import { UnauthorizedError, ValidationError } from '../lib/errors.js'

const ACCESS_TOKEN_EXPIRY = '15m'
const REFRESH_TOKEN_EXPIRY = '7d'

function signAccessToken(payload: { userId: string; email: string; role: string; name: string; team: string }) {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: ACCESS_TOKEN_EXPIRY })
}

function signRefreshToken(userId: string) {
  return jwt.sign({ userId, type: 'refresh' }, config.jwtSecret, { expiresIn: REFRESH_TOKEN_EXPIRY })
}

export async function authRoutes(app: FastifyInstance) {
  // POST /api/auth/login
  app.post('/api/auth/login', async (request, reply) => {
    const { email, password } = request.body as { email?: string; password?: string }

    if (!email || !password) {
      throw new ValidationError('Email and password are required')
    }

    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) {
      throw new UnauthorizedError('Invalid email or password')
    }

    const valid = await bcrypt.compare(password, user.passwordHash)
    if (!valid) {
      throw new UnauthorizedError('Invalid email or password')
    }

    const tokenPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      team: user.team,
    }

    const accessToken = signAccessToken(tokenPayload)
    const refreshToken = signRefreshToken(user.id)

    // Set refresh token as httpOnly cookie
    reply.header('Set-Cookie', `refreshToken=${refreshToken}; HttpOnly; Path=/api/auth; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}`)

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        team: user.team,
      },
    }
  })

  // POST /api/auth/refresh
  app.post('/api/auth/refresh', async (request, reply) => {
    // Extract refresh token from cookie
    const cookieHeader = request.headers.cookie || ''
    const match = cookieHeader.match(/refreshToken=([^;]+)/)
    const refreshToken = match?.[1]

    if (!refreshToken) {
      throw new UnauthorizedError('No refresh token provided')
    }

    try {
      const decoded = jwt.verify(refreshToken, config.jwtSecret) as { userId: string; type: string }
      if (decoded.type !== 'refresh') {
        throw new UnauthorizedError('Invalid token type')
      }

      const user = await prisma.user.findUnique({ where: { id: decoded.userId } })
      if (!user) {
        throw new UnauthorizedError('User not found')
      }

      const tokenPayload = {
        userId: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
        team: user.team,
      }

      const accessToken = signAccessToken(tokenPayload)
      const newRefreshToken = signRefreshToken(user.id)

      reply.header('Set-Cookie', `refreshToken=${newRefreshToken}; HttpOnly; Path=/api/auth; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}`)

      return {
        accessToken,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          team: user.team,
        },
      }
    } catch {
      throw new UnauthorizedError('Invalid or expired refresh token')
    }
  })

  // GET /api/auth/me — get current user from access token
  app.get('/api/auth/me', async (request) => {
    const authHeader = request.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedError('No access token provided')
    }

    try {
      const token = authHeader.slice(7)
      const decoded = jwt.verify(token, config.jwtSecret) as {
        userId: string
        email: string
        role: string
        name: string
        team: string
      }

      return {
        id: decoded.userId,
        email: decoded.email,
        name: decoded.name,
        role: decoded.role,
        team: decoded.team,
      }
    } catch {
      throw new UnauthorizedError('Invalid or expired access token')
    }
  })

  // POST /api/auth/logout
  app.post('/api/auth/logout', async (_request, reply) => {
    reply.header('Set-Cookie', 'refreshToken=; HttpOnly; Path=/api/auth; SameSite=Lax; Max-Age=0')
    return { success: true }
  })
}
