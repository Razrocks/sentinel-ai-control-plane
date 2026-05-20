/**
 * Chat memory service — context loader for the T3 (conversation) and T4
 * (audit slice) tiers of SkillContext, plus chat persistence.
 *
 * Aligns with the documented memory ontology (T1-T6, see docs/agents/memory-model.md):
 *   - T3 = per-user conversation memory: chat history + this user's invocations
 *   - T4 = system-wide audit slice: recent activity any user/system performed
 *
 * Used by:
 *   - chat route — load T3 + T4 each request, save user/assistant turns after
 *   - any skill that opts in via `includeT3: true` in its prompt options
 *
 * Privacy:
 *   - T3 is scoped to the requesting user (userId filter).
 *   - T4 is global within the org (audit trail is already org-public).
 *
 * Cost:
 *   - Each chat call adds ~500-2000 tokens (memory section). With prompt
 *     caching: cached portion stays warm so re-issues are near-free.
 */

import { prisma } from '../lib/prisma.js'
import type { ChatMessageRole } from '@prisma/client'
import type { T3Context, T4Context } from './skills/types.js'

// Tuneable limits. Conservative defaults to bound prompt size.
export const DEFAULT_USER_HISTORY_LIMIT = 10
export const DEFAULT_AUDIT_LIMIT = 15
export const DEFAULT_INVOCATION_LIMIT = 5

// ─── T3 loader (per-user conversation memory) ───────────

export interface LoadT3Options {
  userId: string
  /** Stable session id; included in T3.session metadata. */
  sessionId?: string
  pagePath?: string
  userHistoryLimit?: number
  invocationLimit?: number
}

/**
 * Load T3 tier for a user. Pulls chat history + recent skill invocations.
 */
export async function loadT3FromUser(opts: LoadT3Options): Promise<T3Context> {
  const userLimit = opts.userHistoryLimit ?? DEFAULT_USER_HISTORY_LIMIT
  const invLimit = opts.invocationLimit ?? DEFAULT_INVOCATION_LIMIT

  const [userMsgs, invs] = await Promise.all([
    userLimit > 0
      ? prisma.chatMessage.findMany({
          where: { userId: opts.userId },
          orderBy: { createdAt: 'desc' },
          take: userLimit,
          select: { role: true, content: true, createdAt: true, sessionId: true },
        })
      : Promise.resolve([]),
    invLimit > 0
      ? prisma.agentInvocation.findMany({
          where: { actor: opts.userId },
          orderBy: { createdAt: 'desc' },
          take: invLimit,
          select: { skill: true, status: true, confidence: true, createdAt: true },
        })
      : Promise.resolve([]),
  ])

  const t3: T3Context = {
    userHistory: userMsgs.reverse().map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
      createdAt: m.createdAt.toISOString(),
      sessionId: m.sessionId,
    })),
    recentInvocations: invs.map((i) => ({
      skill: i.skill,
      status: i.status,
      confidence: i.confidence,
      createdAt: i.createdAt.toISOString(),
    })),
  }

  if (opts.sessionId) {
    t3.session = { sessionId: opts.sessionId, pagePath: opts.pagePath }
  }

  return t3
}

// ─── T4 loader (system-wide audit slice) ────────────────

export interface LoadT4Options {
  /** Optional filter: limit to events on a specific objectId. */
  objectId?: string
  /** Optional filter: limit to events on a specific objectType. */
  objectType?: 'change' | 'incident' | 'access' | 'execution' | 'approval'
  limit?: number
}

/**
 * Load T4 tier — recent audit events. Defaults to org-wide; filter for
 * entity-specific slices.
 */
export async function loadT4RecentAudit(opts: LoadT4Options = {}): Promise<T4Context> {
  const limit = opts.limit ?? DEFAULT_AUDIT_LIMIT
  const where: Parameters<typeof prisma.auditEvent.findMany>[0]['where'] = {}
  if (opts.objectId) where.objectId = opts.objectId
  if (opts.objectType) where.objectType = opts.objectType

  const events = await prisma.auditEvent.findMany({
    where,
    orderBy: { timestamp: 'desc' },
    take: limit,
    select: {
      timestamp: true,
      actor: true,
      action: true,
      objectType: true,
      objectId: true,
      objectTitle: true,
      result: true,
    },
  })

  return {
    recentAuditEvents: events.map((e) => ({
      timestamp: e.timestamp.toISOString(),
      actor: e.actor,
      action: e.action,
      objectType: e.objectType,
      objectId: e.objectId,
      objectTitle: e.objectTitle,
      result: e.result,
    })),
  }
}

// ─── Persistence (chat turns) ───────────────────────────

/**
 * Save a chat message to the cross-session memory store.
 * Called on both user-sent and assistant-streamed messages.
 */
export async function saveChatMessage(opts: {
  userId: string
  sessionId: string
  role: ChatMessageRole
  content: string
  context?: Record<string, unknown>
}): Promise<void> {
  // Truncate absurdly long messages to bound storage. 32k chars is generous.
  const content =
    opts.content.length > 32_000 ? opts.content.slice(0, 32_000) + '…[truncated]' : opts.content
  await prisma.chatMessage.create({
    data: {
      userId: opts.userId,
      sessionId: opts.sessionId,
      role: opts.role,
      content,
      contextJson: opts.context ? JSON.stringify(opts.context) : null,
    },
  })
}
