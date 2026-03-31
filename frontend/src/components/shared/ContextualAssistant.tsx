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
} from 'lucide-react'
import { cn } from '@/lib/utils'
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

// Mock responses keyed by entity type and role
const mockResponses: Record<string, Record<Role, { content: string; type: MessageType; actionResult?: ActionResult }[]>> = {
  change: {
    operator: [
      { type: 'explanation', content: 'This change has a high blast radius affecting 5 downstream services. The migration requires a backfill to complete before the NOT NULL constraint can be applied.' },
      { type: 'recommendation', content: 'Route to SRE and Data Platform for review. Recommend scheduling during the next maintenance window (Sat 02:00 UTC).' },
      { type: 'action_result', content: 'Assessment drafted.', actionResult: { decision: 'escalate', summary: 'High blast radius — requires senior engineer review and SRE sign-off before scheduling.', policyRule: 'blast-radius-threshold' } },
      { type: 'guardrail', content: 'Direct execution is blocked for this change. It requires dual approval (SRE + Data Platform) before it can proceed to controlled execution.' },
    ],
    engineer: [
      { type: 'code_snippet', content: '```sql\nALTER TABLE orders ALTER COLUMN customer_id SET NOT NULL;\n```\nBackfill ~1.2M rows first. Run in batches of 1000.' },
      { type: 'recommendation', content: 'Run simulation first. Validate backfill strategy in staging before requesting production approval.' },
    ],
    approver: [
      { type: 'recommendation', content: 'Approve with conditions: maintenance window required, rollback plan verified, backfill completion confirmed.' },
    ],
    it_support: [
      { type: 'explanation', content: 'This change is currently in review. No IT Support actions are required at this stage.' },
    ],
    access_approver: [
      { type: 'explanation', content: 'This change does not involve access requests. No action needed from Access Approver.' },
    ],
    admin: [
      { type: 'policy_rationale', content: 'production-write-guard policy blocked direct execution. Schema migration with blast radius > 3 services requires controlled_apply mode with dual approval.' },
    ],
  },
  incident: {
    operator: [
      { type: 'explanation', content: 'This is a recurring issue. KB-4521 has the standard fix — config-only change to HikariCP max-pool-size. No code deployment required.' },
      { type: 'recommendation', content: 'Draft the remediation and route for approval. The fix is safe and has been applied successfully 3 times before.' },
      { type: 'action_result', content: 'Triage complete.', actionResult: { decision: 'allow', summary: 'Known issue with safe fix path. Remediation can proceed after approval.', policyRule: 'safe-remediation-auto-propose' } },
    ],
    engineer: [
      { type: 'explanation', content: 'Root cause: HikariCP pool exhaustion under load spike. Config change to max-pool-size from 20→40 resolves it.' },
    ],
    it_support: [
      { type: 'recommendation', content: 'Apply KB-4521 fix. Draft customer response with 30-minute ETA. No code changes required.' },
      { type: 'draft_artifact', content: '**Draft Response:**\nWe\'ve identified the root cause as connection pool exhaustion. A config update is being applied with no expected downtime. ETA: 30 minutes.' },
    ],
    approver: [
      { type: 'recommendation', content: 'The proposed remediation is a config-only change. Approve and monitor.' },
    ],
    access_approver: [
      { type: 'explanation', content: 'This incident does not involve access requests.' },
    ],
    admin: [
      { type: 'explanation', content: 'Recurring incident. 3 occurrences in 30 days. Consider permanent capacity increase.' },
    ],
  },
  access_request: {
    operator: [
      { type: 'explanation', content: 'This access request requires manager approval first, then system owner sign-off. Current status: manager approval pending.' },
      { type: 'recommendation', content: 'Route to the user\'s manager for initial approval. Once manager approves, it routes automatically to the system owner.' },
      { type: 'guardrail', content: 'Access grants require Access Approver or Admin role. You can prepare the routing and add notes but cannot approve directly.' },
    ],
    engineer: [
      { type: 'explanation', content: 'This access request is outside your scope. No engineering actions available.' },
    ],
    it_support: [
      { type: 'recommendation', content: 'Verify the user\'s eligibility and route to the appropriate approver chain.' },
    ],
    approver: [
      { type: 'recommendation', content: 'Entitlement check passed. Recommend approving with a 90-day time-bound scope.' },
    ],
    access_approver: [
      { type: 'explanation', content: 'You are the system owner for this system. Manager approval is required before your sign-off.' },
      { type: 'action_result', content: 'Entitlement check complete.', actionResult: { decision: 'allow', summary: 'User eligible. Manager approval is the only remaining gate.', policyRule: 'dual-approval-access' } },
    ],
    admin: [
      { type: 'explanation', content: 'All checks passed. Awaiting manager and system owner dual approval per policy.' },
    ],
  },
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
  const { role, config } = useRole()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const defaultQuickActions: QuickAction[] = quickActions || [
    { label: 'Assess this', prompt: `Give me an assessment of ${entityTitle}` },
    { label: 'What should I do?', prompt: `What is the recommended next action for ${entityTitle}?` },
    { label: 'Policy check', prompt: `What policies apply to ${entityTitle}?` },
  ]

  const sendMessage = (text: string) => {
    if (!text.trim()) return

    const userMsg: Message = {
      id: `ctx-${Date.now()}`,
      role: 'user',
      content: text.trim(),
      type: 'text',
    }

    const responses = mockResponses[entityType]?.[role] || mockResponses[entityType]?.operator || []
    const response = responses[Math.floor(Math.random() * responses.length)]
    const assistantMsg: Message = response ? {
      id: `ctx-${Date.now() + 1}`,
      role: 'assistant',
      content: response.content,
      type: response.type,
      actionResult: response.actionResult,
    } : {
      id: `ctx-${Date.now() + 1}`,
      role: 'assistant',
      content: `I can help with ${entityTitle}. What specifically would you like to know?`,
      type: 'text',
    }

    setMessages(prev => [...prev, userMsg, assistantMsg])
    setInput('')
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
          {messages.length > 0 && (
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
                onKeyDown={e => e.key === 'Enter' && sendMessage(input)}
                placeholder="Ask about this record..."
                className="flex-1 h-7 rounded border border-border-subtle bg-surface-raised px-2 text-[11px] text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <button
                onClick={() => sendMessage(input)}
                disabled={!input.trim()}
                className="h-7 px-2 rounded bg-accent text-white hover:bg-accent-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Send className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
