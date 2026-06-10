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
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { chatStream } from '@/lib/api'
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
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  // Session id scoped to the entity being viewed; persists across detail-page revisits.
  const [sessionId] = useState(() => {
    const k = `sentinel.chat.entity.${entityType}.${entityId}`
    let v = sessionStorage.getItem(k)
    if (!v) {
      v = `chat-${entityType}-${entityId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      sessionStorage.setItem(k, v)
    }
    return v
  })
  const { role, config } = useRole()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

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

  return (
    <div className="rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/60 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/15 text-primary">
            <Bot className="w-4 h-4" />
          </div>
          <span className="text-sm font-semibold text-foreground">Sentinel Assistant</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-primary/15 text-primary font-medium">{config.label}</span>
        </div>
        <ChevronDown className={cn('w-4 h-4 text-muted-foreground transition-transform', isExpanded && 'rotate-180')} />
      </button>

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
  )
}
