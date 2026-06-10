import { useState, useRef, useEffect } from 'react'
import {
  Bot,
  Send,
  Lock,
  Lightbulb,
  FileText,
  Shield,
  AlertTriangle,
  CheckCircle,
  XCircle,
  ArrowUpRight,
  Play,
  MessageSquare,
  Code,
  ChevronDown,
  Loader2,
  Maximize2,
  Minimize2,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { chatStream, api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useRole, type Role } from '@/lib/roles'

type MessageType = 'text' | 'explanation' | 'recommendation' | 'policy_rationale' | 'action_result' | 'guardrail' | 'draft_artifact' | 'code_snippet'

interface ActionResult {
  decision: 'allow' | 'deny' | 'simulate_only' | 'escalate'
  summary: string
  policyRule?: string
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  type: MessageType
  actionResult?: ActionResult
}

interface QuickAction {
  label: string
  prompt: string
}

interface ContextualAssistantProps {
  /** Entity type being viewed */
  entityType: 'change' | 'incident' | 'access_request'
  /** Entity ID for context */
  entityId: string
  /** Entity title for context */
  entityTitle: string
  /** Quick actions specific to this entity */
  quickActions?: QuickAction[]
}


const typeIcons: Record<MessageType, typeof Lightbulb> = {
  text: MessageSquare,
  explanation: FileText,
  recommendation: Lightbulb,
  policy_rationale: Shield,
  action_result: CheckCircle,
  guardrail: Lock,
  draft_artifact: FileText,
  code_snippet: Code,
}

const typeLabels: Record<MessageType, string> = {
  text: '',
  explanation: 'Explanation',
  recommendation: 'Recommendation',
  policy_rationale: 'Policy',
  action_result: 'Result',
  guardrail: 'Guardrail',
  draft_artifact: 'Draft',
  code_snippet: 'Code',
}

const resultStyles: Record<string, { bg: string; text: string; icon: typeof CheckCircle }> = {
  allow: { bg: 'bg-status-approved/10 border-status-approved/20', text: 'text-status-approved', icon: CheckCircle },
  deny: { bg: 'bg-risk-critical/10 border-risk-critical/20', text: 'text-risk-critical', icon: XCircle },
  escalate: { bg: 'bg-status-escalated/10 border-status-escalated/20', text: 'text-status-escalated', icon: ArrowUpRight },
  simulate_only: { bg: 'bg-status-simulated/10 border-status-simulated/20', text: 'text-status-simulated', icon: Play },
}

export function ContextualAssistant({ entityType, entityId, entityTitle, quickActions }: ContextualAssistantProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  // Fullscreen-ish overlay mode so long agent replies + diffs are readable
  // when the right rail is too narrow. Renders the same widget inside a
  // centered modal — same state, same handlers, just more breathing room.
  const [isMaximized, setIsMaximized] = useState(false)
  // Persist message history to localStorage keyed by entity so navigating
  // away and back (or full page reload) doesn't wipe the conversation.
  // Capped at last 200 messages to keep storage bounded.
  const messagesKey = `sentinel.chat.entity.${entityType}.${entityId}.messages`
  const [messages, setMessages] = useState<Message[]>(() => {
    try {
      const raw = localStorage.getItem(messagesKey)
      if (!raw) return []
      const parsed = JSON.parse(raw) as Message[]
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  })
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  // Deterministic session id per entity. Backend filters by userId so two
  // users with the same key still only see their own messages — but the
  // SAME user on any device generates the SAME key and rehydrates the same
  // conversation. Old random IDs (kept in localStorage from earlier
  // sessions) would isolate per browser, breaking cross-device.
  const [sessionId] = useState(() => `entity-${entityType}-${entityId}`)
  const { role, config } = useRole()
  const { isAuthenticated } = useAuth()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Write-through to localStorage every time the conversation grows.
  // Trims to the most recent 200 messages so we never overflow quota on
  // a long-running session. Wrapped in try/catch — localStorage may be
  // unavailable (private mode, quota full); we degrade silently rather
  // than break the chat.
  useEffect(() => {
    try {
      const trimmed = messages.slice(-200)
      localStorage.setItem(messagesKey, JSON.stringify(trimmed))
    } catch {
      /* storage quota or disabled */
    }
  }, [messages, messagesKey])

  // Backend rehydration. Gated on `isAuthenticated` so we don't fire the
  // GET before login completes (would 401 + silently fail forever). Re-runs
  // when auth flips to true (eg fresh login on a new browser).
  useEffect(() => {
    if (!isAuthenticated) return
    let cancelled = false
    api
      .getChatHistory(sessionId, 200)
      .then((res) => {
        if (cancelled || res.messages.length === 0) return
        const serverMsgs: Message[] = res.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          type: (m.type as MessageType) ?? 'text',
        }))
        setMessages((local) => (serverMsgs.length > local.length ? serverMsgs : local))
      })
      .catch(() => {
        /* offline or 401 — silently fall back to localStorage */
      })
    return () => {
      cancelled = true
    }
  }, [sessionId, isAuthenticated])

  // Clean up stream on unmount
  useEffect(() => {
    return () => { abortRef.current?.abort() }
  }, [])

  const defaultQuickActions: QuickAction[] = quickActions || [
    { label: 'Assess this', prompt: `Give me an assessment of ${entityTitle}` },
    { label: 'What should I do?', prompt: `What is the recommended next action for ${entityTitle}?` },
    { label: 'Policy check', prompt: `What policies apply to ${entityTitle}?` },
  ]

  const sendMessage = async (text: string) => {
    if (!text.trim() || isStreaming) return

    const userMsg: Message = {
      id: `ctx-${Date.now()}`,
      role: 'user',
      content: text.trim(),
      type: 'text',
    }

    const assistantMsgId = `ctx-${Date.now() + 1}`
    const assistantMsg: Message = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      type: 'text',
    }

    setMessages(prev => [...prev, userMsg, assistantMsg])
    setInput('')
    setIsStreaming(true)

    // Build message history for API
    const allMessages = [...messages, userMsg].map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }))

    const controller = await chatStream(
      allMessages,
      {
        pagePath: window.location.pathname,
        entityType: entityType === 'access_request' ? 'access_request' : entityType,
        entityId,
        sessionId,
      },
      // onChunk
      (chunk) => {
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantMsgId
              ? { ...m, content: m.content + chunk }
              : m
          )
        )
      },
      // onDone
      () => {
        setIsStreaming(false)
        abortRef.current = null
      },
      // onError
      (err) => {
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantMsgId
              ? { ...m, content: `Error: ${err}` }
              : m
          )
        )
        setIsStreaming(false)
        abortRef.current = null
      },
    )

    abortRef.current = controller
  }

  // Header is split into two regions: the click target (left, toggles
  // expand) and the action buttons (right, maximize). Stopping propagation
  // on the maximize button so it doesn't also collapse the panel.
  const header = (
    <div className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/60 transition-colors">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2.5 flex-1 text-left"
      >
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/15 text-primary">
          <Bot className="w-4 h-4" />
        </div>
        <span className="text-sm font-semibold text-foreground">Sentinel Assistant</span>
        <span className="text-xs px-2 py-0.5 rounded-full bg-primary/15 text-primary font-medium">{config.label}</span>
      </button>
      <div className="flex items-center gap-1 flex-shrink-0">
        {!isMaximized && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setIsMaximized(true)
              setIsExpanded(true)
            }}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Expand assistant"
            title="Expand"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        )}
        {!isMaximized && (
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label={isExpanded ? 'Collapse' : 'Expand'}
          >
            <ChevronDown className={cn('w-4 h-4 transition-transform', isExpanded && 'rotate-180')} />
          </button>
        )}
      </div>
    </div>
  )

  return (
    <>
    <div className="rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden">
      {/* Header */}
      {header}

      {isExpanded && (
        <div className="border-t border-border">
          {/* Guardrail strip */}
          <div className="px-4 py-2 bg-muted/40 text-xs text-muted-foreground flex items-center gap-2 border-b border-border/60">
            <Lock className="w-3.5 h-3.5 flex-shrink-0" />
            <span>{config.label} mode — actions are policy-governed</span>
          </div>

          {/* Messages area */}
          <div className="max-h-[340px] overflow-y-auto px-4 py-3 flex flex-col gap-3">
            {messages.length === 0 && (
              <div className="flex flex-col gap-2.5">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Ask about this {entityType.replace('_', ' ')}</p>
                <div className="flex flex-col gap-1.5">
                  {defaultQuickActions.map(qa => (
                    <button
                      key={qa.label}
                      onClick={() => sendMessage(qa.prompt)}
                      className="w-full text-left flex items-center gap-2.5 px-3 py-2.5 rounded-md bg-muted/50 border border-border text-sm text-foreground/85 hover:text-foreground hover:border-primary/30 hover:bg-muted transition-colors"
                    >
                      <Lightbulb className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                      {qa.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map(msg => (
              <div key={msg.id}>
                {msg.role === 'user' ? (
                  <div className="flex justify-end">
                    <div className="bg-primary text-white rounded-lg px-3 py-2 text-sm max-w-[90%]">
                      {msg.content}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {typeLabels[msg.type] && (
                      <div className="flex items-center gap-1">
                        {(() => { const Icon = typeIcons[msg.type]; return <Icon className={`w-3 h-3 ${msg.type === 'guardrail' ? 'text-risk-high' : 'text-primary'}`} /> })()}
                        <span className={`text-xs font-medium uppercase tracking-wider ${msg.type === 'guardrail' ? 'text-risk-high' : 'text-primary'}`}>
                          {typeLabels[msg.type]}
                        </span>
                      </div>
                    )}
                    <div className={cn(
                      'rounded-lg px-3 py-2 text-sm leading-relaxed',
                      msg.type === 'guardrail'
                        ? 'bg-risk-high/10 text-risk-high border border-risk-high/20'
                        : msg.type === 'code_snippet'
                        ? 'bg-background text-foreground border border-border font-mono text-xs'
                        : 'bg-muted text-foreground/85 border border-border'
                    )}>
                      {msg.content}
                    </div>
                    {msg.actionResult && (() => {
                      const style = resultStyles[msg.actionResult.decision]
                      if (!style) return null
                      const Icon = style.icon
                      return (
                        <div className={`${style.bg} border rounded p-2 space-y-1`}>
                          <div className="flex items-center gap-1.5">
                            <Icon className={`w-3 h-3 ${style.text}`} />
                            <span className={`text-xs font-semibold uppercase tracking-wider ${style.text}`}>
                              {msg.actionResult.decision.replace('_', ' ')}
                            </span>
                          </div>
                          <p className="text-xs text-foreground/85">{msg.actionResult.summary}</p>
                          {msg.actionResult.policyRule && (
                            <div className="flex items-center gap-1">
                              <Shield className="w-3 h-3 text-muted-foreground" />
                              <span className="text-xs text-muted-foreground font-mono">{msg.actionResult.policyRule}</span>
                            </div>
                          )}
                        </div>
                      )
                    })()}
                  </div>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick actions when there are messages */}
          {messages.length > 0 && !isStreaming && (
            <div className="px-4 pb-3">
              <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
                {defaultQuickActions.map(qa => (
                  <button
                    key={qa.label}
                    onClick={() => sendMessage(qa.prompt)}
                    className="flex-shrink-0 px-3 py-1.5 rounded-full bg-muted/60 border border-border text-xs font-medium text-muted-foreground hover:text-primary hover:border-primary/30 hover:bg-muted transition-colors"
                  >
                    {qa.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input */}
          <div className="px-4 py-3 border-t border-border bg-muted/20">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !isStreaming && sendMessage(input)}
                placeholder={isStreaming ? 'Thinking...' : 'Ask about this record...'}
                disabled={isStreaming}
                className="flex-1 h-10 rounded-md border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
              />
              <button
                onClick={() => sendMessage(input)}
                disabled={!input.trim() || isStreaming}
                className="flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isStreaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>

    {/* Maximized overlay — same widget rendered into a centered modal so
        long agent replies, code blocks, and diff snippets are actually
        readable. Wraps the existing panel body in its own scroll area. */}
    {isMaximized && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
        onClick={() => setIsMaximized(false)}
      >
        <div
          className="relative flex flex-col w-[92vw] h-[88vh] max-w-5xl rounded-2xl border bg-card text-card-foreground shadow-2xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/15 text-primary">
                <Bot className="w-5 h-5" />
              </div>
              <div className="flex flex-col">
                <span className="text-base font-semibold text-foreground">Sentinel Assistant</span>
                <span className="text-xs text-muted-foreground">{entityTitle}</span>
              </div>
              <span className="text-xs px-2 py-0.5 rounded-full bg-primary/15 text-primary font-medium">
                {config.label}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setIsMaximized(false)}
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                aria-label="Minimize"
                title="Minimize"
              >
                <Minimize2 className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setIsMaximized(false)}
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                aria-label="Close"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="px-5 py-2 bg-muted/40 text-xs text-muted-foreground flex items-center gap-2 border-b border-border/60">
            <Lock className="w-3.5 h-3.5 flex-shrink-0" />
            <span>{config.label} mode — actions are policy-governed</span>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-4">
            {messages.length === 0 && (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-muted-foreground">
                  Ask about this {entityType.replace('_', ' ')}:
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {defaultQuickActions.map((qa) => (
                    <button
                      key={qa.label}
                      onClick={() => sendMessage(qa.prompt)}
                      className="flex items-center gap-2 px-3 py-2.5 rounded-md bg-muted border border-border text-sm text-foreground/85 hover:text-foreground hover:border-primary/30 transition-colors text-left"
                    >
                      <Lightbulb className="w-4 h-4 text-primary flex-shrink-0" />
                      {qa.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg) => (
              <div key={msg.id}>
                {msg.role === 'user' ? (
                  <div className="flex justify-end">
                    <div className="bg-primary text-primary-foreground rounded-lg px-4 py-2.5 text-sm max-w-[80%] whitespace-pre-wrap leading-relaxed">
                      {msg.content}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {typeLabels[msg.type] && (
                      <div className="flex items-center gap-1.5">
                        {(() => {
                          const Icon = typeIcons[msg.type]
                          return (
                            <Icon
                              className={cn(
                                'w-3.5 h-3.5',
                                msg.type === 'guardrail' ? 'text-risk-high' : 'text-primary',
                              )}
                            />
                          )
                        })()}
                        <span
                          className={cn(
                            'text-xs font-semibold uppercase tracking-wider',
                            msg.type === 'guardrail' ? 'text-risk-high' : 'text-primary',
                          )}
                        >
                          {typeLabels[msg.type]}
                        </span>
                      </div>
                    )}
                    <div
                      className={cn(
                        'rounded-lg px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap',
                        msg.type === 'guardrail'
                          ? 'bg-risk-high/10 text-risk-high border border-risk-high/20'
                          : msg.type === 'code_snippet'
                            ? 'bg-background text-foreground border border-border font-mono text-xs'
                            : 'bg-muted text-foreground/90 border border-border',
                      )}
                    >
                      {msg.content}
                    </div>
                  </div>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {messages.length > 0 && !isStreaming && (
            <div className="px-5 pb-2 pt-2 border-t border-border/60">
              <div className="flex gap-2 overflow-x-auto no-scrollbar">
                {defaultQuickActions.map((qa) => (
                  <button
                    key={qa.label}
                    onClick={() => sendMessage(qa.prompt)}
                    className="flex-shrink-0 px-3 py-1.5 rounded-full bg-muted border border-border text-xs text-foreground/80 hover:text-primary hover:border-primary/30 transition-colors"
                  >
                    {qa.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (input.trim() && !isStreaming) sendMessage(input.trim())
            }}
            className="border-t border-border px-5 py-4 flex items-center gap-3"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={`Ask about this ${entityType.replace('_', ' ')}…`}
              disabled={isStreaming}
              className="flex-1 h-11 rounded-md bg-background border border-input px-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!input.trim() || isStreaming}
              className="flex h-11 w-11 items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              aria-label="Send"
            >
              {isStreaming ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </form>
        </div>
      </div>
    )}
    </>
  )
}
