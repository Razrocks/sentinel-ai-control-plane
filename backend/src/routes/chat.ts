import { FastifyInstance } from 'fastify'
import Anthropic from '@anthropic-ai/sdk'
import { requireAuth } from '../middleware/auth.js'
import { prisma } from '../lib/prisma.js'
import { config } from '../config.js'
import {
  buildChatSystemPrompt,
  buildContextualSystemPrompt,
  isConfigured,
} from '../services/claude.js'
import {
  loadT3FromUser,
  loadT4RecentAudit,
  saveChatMessage,
} from '../services/chat-memory.js'
import { renderT3Context, renderT4Context } from '../services/skills/index.js'
import { CHAT_TOOLS, executeTool } from '../services/chat-tools.js'

const MAX_TOOL_ITERATIONS = 5
const CHAT_MODEL = 'claude-sonnet-4-20250514'
const CHAT_MAX_TOKENS = 1024

// Lazy Anthropic client (config-checked before use)
let _client: Anthropic | null = null
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: config.anthropicApiKey })
  return _client
}

export async function chatRoutes(app: FastifyInstance) {
  // POST /api/chat — streaming Claude response via SSE
  app.post('/api/chat', { preHandler: [requireAuth] }, async (request, reply) => {
    // Check if Anthropic API key is configured
    if (!isConfigured()) {
      return reply.status(503).send({
        error: 'AI_NOT_CONFIGURED',
        message: 'Anthropic API key not set. Add ANTHROPIC_API_KEY to your environment.',
      })
    }

    const body = request.body as {
      messages?: Array<{ role: 'user' | 'assistant'; content: string }>
      context?: {
        pagePath?: string
        entityType?: 'change' | 'incident' | 'access_request'
        entityId?: string
        /** Stable id for this conversation. Frontend should generate once + reuse. */
        sessionId?: string
      }
    }

    const messages = body?.messages
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return reply.status(400).send({
        error: 'VALIDATION_ERROR',
        message: 'messages array is required and must contain at least one message',
      })
    }

    const context = body.context || {}
    const role = request.user!.role
    const pagePath = context.pagePath || '/'
    const userId = request.user!.userId
    // Frontend may pass a sessionId; if not, fall back to user-scoped pseudo-session.
    const sessionId = context.sessionId || `default-${userId}`

    // Load T3 (per-user conversation memory) + T4 (org-wide audit slice).
    // Both align with the documented memory ontology (see docs/agents/memory-model.md).
    // Errors are non-fatal — chat still works without memory.
    let memorySection = ''
    try {
      const [t3, t4] = await Promise.all([
        loadT3FromUser({ userId, sessionId, pagePath }),
        loadT4RecentAudit({ limit: 15 }),
      ])
      const t3Block = renderT3Context(t3)
      const t4Block = renderT4Context(t4)
      memorySection = [t3Block, t4Block].filter(Boolean).join('\n\n')
    } catch (err) {
      app.log.warn({ err }, 'chat memory load failed; continuing without memory')
    }

    // Build system prompt — contextual if entity provided, otherwise general
    let systemPrompt: string

    if (context.entityType && context.entityId) {
      const entityData = await loadEntityData(context.entityType, context.entityId)
      if (entityData) {
        systemPrompt = buildContextualSystemPrompt(role, context.entityType, entityData)
      } else {
        systemPrompt = buildChatSystemPrompt(role, pagePath)
      }
    } else {
      systemPrompt = buildChatSystemPrompt(role, pagePath)
    }

    // Append memory block at end of system prompt so it doesn't interfere
    // with the cached identity/role portion. Memory varies per call → stays
    // outside any future cache breakpoint.
    if (memorySection) {
      systemPrompt = `${systemPrompt}\n\n${memorySection}`
    }

    // Persist the latest user message (most recent in array) BEFORE streaming.
    // Saving the assistant response happens after the stream completes.
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')
    if (lastUserMsg) {
      try {
        await saveChatMessage({
          userId,
          sessionId,
          role: 'user',
          content: lastUserMsg.content,
          context: { pagePath, entityType: context.entityType, entityId: context.entityId },
        })
      } catch (err) {
        app.log.warn({ err }, 'chat memory save (user msg) failed; continuing')
      }
    }

    // Set SSE headers and hijack the response.
    // CORS-with-credentials requires a specific origin echo, NOT "*".
    // The Fastify CORS plugin's headers don't reach reply.raw, so we set them manually.
    const requestOrigin = request.headers.origin as string | undefined
    const allowedOrigin = requestOrigin && requestOrigin === config.corsOrigin ? requestOrigin : config.corsOrigin
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Credentials': 'true',
      'X-Accel-Buffering': 'no',
    })

    // Hijack BEFORE async work so connection stays open.
    reply.hijack()

    let aborted = false
    request.raw.on('close', () => {
      aborted = true
    })

    try {
      const client = getClient()
      // Convert incoming messages to Anthropic typed shape; allow content as string OR block array.
      const workingMessages: Array<Anthropic.MessageParam> = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }))

      let finalText = ''
      let toolIterations = 0

      // Tool-use loop: call model with tools enabled. If response contains
      // tool_use blocks, execute them and feed results back. Loop until
      // stop_reason = end_turn or max iterations.
      while (toolIterations < MAX_TOOL_ITERATIONS && !aborted) {
        const response = await client.messages.create({
          model: CHAT_MODEL,
          max_tokens: CHAT_MAX_TOKENS,
          system: systemPrompt,
          tools: CHAT_TOOLS as unknown as Anthropic.Tool[],
          messages: workingMessages,
        })

        // Accumulate any text emitted in this turn (interim or final).
        const turnText = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('')
        if (turnText) {
          finalText += (finalText ? '\n\n' : '') + turnText
        }

        // If stop reason wasn't tool_use, we have the final answer.
        if (response.stop_reason !== 'tool_use') {
          break
        }

        // Collect tool_use blocks
        const toolUses = response.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
        )
        if (toolUses.length === 0) break

        // Append assistant turn (full content, including tool_use blocks)
        workingMessages.push({ role: 'assistant', content: response.content })

        // Execute tools, build tool_result blocks for the next user turn
        const toolResultBlocks: Anthropic.ToolResultBlockParam[] = []
        for (const tu of toolUses) {
          if (aborted) break
          app.log.info({ tool: tu.name, input: tu.input }, 'chat tool call')
          const result = await executeTool(tu.name, tu.input as Record<string, unknown>)
          toolResultBlocks.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: result.content,
            is_error: result.isError ?? false,
          })
        }
        workingMessages.push({ role: 'user', content: toolResultBlocks })
        toolIterations++
      }

      if (aborted) {
        reply.raw.end()
        return
      }

      // Emit final answer as one chunk (tool-loop architecture; not token-streamed).
      // UI still receives event: chunk + event: done → no client change needed.
      if (!finalText) {
        finalText = '(no response)'
      }
      reply.raw.write(`event: chunk\ndata: ${JSON.stringify({ content: finalText })}\n\n`)
      reply.raw.write(`event: done\ndata: {}\n\n`)
      reply.raw.end()

      // Persist assistant turn fire-and-forget
      saveChatMessage({
        userId,
        sessionId,
        role: 'assistant',
        content: finalText,
        context: { pagePath, entityType: context.entityType, entityId: context.entityId },
      }).catch((err) => app.log.warn({ err }, 'chat memory save (assistant msg) failed'))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Chat error'
      app.log.error(error, 'chat tool loop error')
      try {
        reply.raw.write(`event: error\ndata: ${JSON.stringify({ message })}\n\n`)
      } catch {
        /* connection already closed */
      }
      reply.raw.end()
    }
  })
}

// ─── Entity data loaders ────────────────────────────────

async function loadEntityData(
  entityType: string,
  entityId: string,
): Promise<Record<string, unknown> | null> {
  try {
    switch (entityType) {
      case 'change':
        return await loadChangeData(entityId)
      case 'incident':
        return await loadIncidentData(entityId)
      case 'access_request':
        return await loadAccessRequestData(entityId)
      default:
        return null
    }
  } catch {
    return null
  }
}

async function loadChangeData(id: string): Promise<Record<string, unknown> | null> {
  const change = await prisma.change.findFirst({
    where: { OR: [{ id }, { ticketId: id }] },
    include: {
      blastRadius: true,
      recommendations: true,
      auditEvents: { orderBy: { timestamp: 'desc' }, take: 10 },
    },
  })
  if (!change) return null

  return {
    ticketId: change.ticketId,
    title: change.title,
    description: change.description,
    owner: change.owner,
    ownerTeam: change.ownerTeam,
    service: change.service,
    environment: change.environment,
    riskLevel: change.riskLevel,
    status: change.status,
    approvalState: change.approvalState,
    policyDecision: change.policyDecision,
    linkedPRs: change.linkedPRs,
    ciStatus: change.ciStatus,
    maintenanceWindow: change.maintenanceWindow,
    rollbackPlan: change.rollbackPlan,
    blastRadius: change.blastRadius.map(br => ({
      name: br.name,
      type: br.type,
      reason: br.reason,
      confidence: br.confidence,
      criticality: br.criticality,
      ownerTeam: br.ownerTeam,
    })),
    recommendations: change.recommendations.map(r => ({
      title: r.title,
      reason: r.reason,
      classification: r.classification,
      expectedBenefit: r.expectedBenefit,
      requiredApprovals: r.requiredApprovals,
      executableNow: r.executableNow,
      draftOnly: r.draftOnly,
    })),
    recentAuditEvents: change.auditEvents.slice(0, 5).map(e => ({
      action: e.action,
      actor: e.actor,
      result: e.result,
      timestamp: e.timestamp.toISOString(),
    })),
  }
}

async function loadIncidentData(id: string): Promise<Record<string, unknown> | null> {
  const incident = await prisma.incident.findFirst({
    where: { OR: [{ id }, { incidentId: id }] },
  })
  if (!incident) return null

  return {
    incidentId: incident.incidentId,
    title: incident.title,
    description: incident.description,
    requester: incident.requester,
    affectedService: incident.affectedService,
    severity: incident.severity,
    status: incident.status === 'new_incident' ? 'new' : incident.status,
    assignmentGroup: incident.assignmentGroup,
    relatedCI: incident.relatedCI,
    relatedChanges: incident.relatedChanges,
    likelyIssueType: incident.likelyIssueType,
    rootCauseCategory: incident.rootCauseCategory,
    recommendedFix: incident.recommendedFix,
    kbArticles: incident.kbArticles,
    isRecurring: incident.isRecurring,
  }
}

async function loadAccessRequestData(id: string): Promise<Record<string, unknown> | null> {
  const ar = await prisma.accessRequest.findFirst({
    where: { OR: [{ id }, { requestId: id }] },
  })
  if (!ar) return null

  return {
    requestId: ar.requestId,
    requester: ar.requester,
    requesterEmail: ar.requesterEmail,
    requestedSystem: ar.requestedSystem,
    requestedRole: ar.requestedRole,
    justification: ar.justification,
    manager: ar.manager,
    systemOwner: ar.systemOwner,
    status: ar.status,
    riskLevel: ar.riskLevel,
    policyDecision: ar.policyDecision,
    entitlementCheck: ar.entitlementCheck,
    autoGrantAllowed: ar.autoGrantAllowed,
    managerApprovalRequired: ar.managerApprovalRequired,
    ownerApprovalRequired: ar.ownerApprovalRequired,
    managerApproval: ar.managerApproval,
    ownerApproval: ar.ownerApproval,
    reason: ar.reason,
  }
}
