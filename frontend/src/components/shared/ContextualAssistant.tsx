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
    <div className="bg-surface rounded-lg border border-border overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-surface-raised transition-colors"
      >
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-accent" />
          <span className="text-xs font-semibold text-text-primary">Sentinel Assistant</span>
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-accent/10 text-accent font-medium">{config.label}</span>
        </div>
        <ChevronDown className={cn('w-3.5 h-3.5 text-text-muted transition-transform', isExpanded && 'rotate-180')} />
      </button>

      {isExpanded && (
        <div className="border-t border-border">
          {/* Guardrail strip */}
          <div className="px-3 py-1.5 bg-surface-raised/50 text-[9px] text-text-muted flex items-center gap-1.5">
            <Lock className="w-2.5 h-2.5 flex-shrink-0" />
            <span>{config.label} mode — actions are policy-governed</span>
          </div>

          {/* Messages area */}
          <div className="max-h-[300px] overflow-y-auto px-3 py-2 space-y-2">
            {messages.length === 0 && (
              <div className="space-y-2">
                <p className="text-[10px] text-text-muted">Ask about this {entityType.replace('_', ' ')}:</p>
                <div className="space-y-1">
                  {defaultQuickActions.map(qa => (
                    <button
                      key={qa.label}
                      onClick={() => sendMessage(qa.prompt)}
                      className="w-full text-left flex items-center gap-1.5 px-2 py-1.5 rounded bg-surface-raised border border-border text-[11px] text-text-secondary hover:text-text-primary hover:border-accent/30 transition-colors"
                    >
                      <Lightbulb className="w-3 h-3 text-accent flex-shrink-0" />
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
                    <div className="bg-accent text-white rounded-lg px-2.5 py-1.5 text-[11px] max-w-[90%]">
                      {msg.content}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {typeLabels[msg.type] && (
                      <div className="flex items-center gap-1">
                        {(() => { const Icon = typeIcons[msg.type]; return <Icon className={`w-2.5 h-2.5 ${msg.type === 'guardrail' ? 'text-risk-high' : 'text-accent'}`} /> })()}
                        <span className={`text-[9px] font-medium uppercase tracking-wider ${msg.type === 'guardrail' ? 'text-risk-high' : 'text-accent'}`}>
                          {typeLabels[msg.type]}
                        </span>
                      </div>
                    )}
                    <div className={cn(
                      'rounded-lg px-2.5 py-1.5 text-[11px] leading-relaxed',
                      msg.type === 'guardrail'
                        ? 'bg-risk-high/10 text-risk-high border border-risk-high/20'
                        : msg.type === 'code_snippet'
                        ? 'bg-background text-text-primary border border-border font-mono text-[10px]'
                        : 'bg-surface-raised text-text-secondary border border-border'
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
                            <span className={`text-[9px] font-semibold uppercase tracking-wider ${style.text}`}>
                              {msg.actionResult.decision.replace('_', ' ')}
                            </span>
                          </div>
                          <p className="text-[10px] text-text-secondary">{msg.actionResult.summary}</p>
                          {msg.actionResult.policyRule && (
                            <div className="flex items-center gap-1">
                              <Shield className="w-2.5 h-2.5 text-text-muted" />
                              <span className="text-[9px] text-text-muted font-mono">{msg.actionResult.policyRule}</span>
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
            <div className="px-3 pb-1.5">
              <div className="flex gap-1 overflow-x-auto no-scrollbar">
                {defaultQuickActions.map(qa => (
                  <button
                    key={qa.label}
                    onClick={() => sendMessage(qa.prompt)}
                    className="flex-shrink-0 px-2 py-0.5 rounded-full bg-surface-raised border border-border text-[10px] text-text-muted hover:text-accent hover:border-accent/30 transition-colors"
                  >
                    {qa.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input */}
          <div className="px-3 py-2 border-t border-border">
            <div className="flex gap-1.5">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !isStreaming && sendMessage(input)}
                placeholder={isStreaming ? 'Thinking...' : 'Ask about this record...'}
                disabled={isStreaming}
                className="flex-1 h-7 rounded border border-border-subtle bg-surface-raised px-2 text-[11px] text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-60"
              />
              <button
                onClick={() => sendMessage(input)}
                disabled={!input.trim() || isStreaming}
                className="h-7 px-2 rounded bg-accent text-white hover:bg-accent-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isStreaming ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
