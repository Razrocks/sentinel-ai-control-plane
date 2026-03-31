import { useState, useRef, useEffect } from 'react'
import {
  MessageSquare,
  Send,
  Bot,
  Shield,
  Lightbulb,
  FileText,
  AlertTriangle,
  CheckCircle,
  XCircle,
  ArrowUpRight,
  Play,
  Zap,
  ChevronUp,
  Lock,
  Code,
  HelpCircle,
  Wrench,
  KeyRound,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useRole, type Role } from '@/lib/roles'

type MessageType =
  | 'text'
  | 'explanation'
  | 'recommendation'
  | 'policy_rationale'
  | 'action_proposal'
  | 'draft_artifact'
  | 'action_result'
  | 'guardrail'
  | 'code_snippet'

interface ActionResult {
  decision: 'allow' | 'deny' | 'simulate_only' | 'escalate'
  summary: string
  policyRule?: string
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  type: MessageType
  actionResult?: ActionResult
}

interface QuickAction {
  label: string
  prompt: string
  icon: typeof Lightbulb
}

// Role-specific guardrail descriptions
const roleGuardrails: Record<Role, { label: string; constraints: string[] }> = {
  operator: {
    label: 'Operator',
    constraints: ['Can assess, triage, draft, escalate', 'Cannot approve or execute', 'All production actions require escalation'],
  },
  approver: {
    label: 'Approver',
    constraints: ['Can approve or deny requests', 'Cannot execute changes directly', 'Must provide rationale for denials'],
  },
  engineer: {
    label: 'Engineer',
    constraints: ['Can inspect code, PRs, blast radius', 'Can simulate and open PRs', 'Cannot approve or execute production changes'],
  },
  it_support: {
    label: 'IT Support',
    constraints: ['Can triage incidents and route requests', 'Can trigger safe remediations', 'Cannot approve access or execute changes'],
  },
  access_approver: {
    label: 'Access Approver',
    constraints: ['Can approve/deny access for owned systems', 'Cannot bypass manager approval chain', 'Cannot modify entitlement rules'],
  },
  admin: {
    label: 'Admin',
    constraints: ['Full access to all actions', 'Policy overrides require audit trail', 'All actions are logged'],
  },
}

// Role-specific quick actions — what each role would actually do
const roleQuickActions: Record<Role, Record<string, QuickAction[]>> = {
  operator: {
    '/': [
      { label: 'What needs triage?', prompt: 'What items need triage right now?', icon: AlertTriangle },
      { label: 'Priority queue', prompt: 'Show me the priority queue sorted by urgency', icon: Zap },
      { label: 'Escalation status', prompt: 'Are there any pending escalations I need to follow up on?', icon: ArrowUpRight },
    ],
    '/changes': [
      { label: 'Assess this change', prompt: 'Give me a risk assessment for this change', icon: AlertTriangle },
      { label: 'Blast radius?', prompt: 'What is the blast radius? Which teams should I notify?', icon: Zap },
      { label: 'Route for review', prompt: 'Who should review this? Draft the routing recommendation.', icon: ArrowUpRight },
    ],
    '/incidents': [
      { label: 'Triage this', prompt: 'Help me triage this incident — what category and priority?', icon: AlertTriangle },
      { label: 'Draft response', prompt: 'Draft an initial response for this incident', icon: FileText },
      { label: 'Escalate?', prompt: 'Does this need escalation? What\'s the severity assessment?', icon: ArrowUpRight },
    ],
    '/access-requests': [
      { label: 'Route to manager', prompt: 'Who should approve this? Draft the routing.', icon: ArrowUpRight },
      { label: 'Check eligibility', prompt: 'Is this user eligible based on entitlement policy?', icon: Shield },
    ],
    '/approvals': [
      { label: 'Prioritize queue', prompt: 'Which approvals should I handle first?', icon: AlertTriangle },
      { label: 'Batch actions?', prompt: 'Can any of these be batch-processed?', icon: Zap },
    ],
  },
  approver: {
    '/': [
      { label: 'Pending decisions', prompt: 'What decisions are waiting for me?', icon: CheckCircle },
      { label: 'High risk items', prompt: 'Show me only high-risk items that need approval', icon: AlertTriangle },
    ],
    '/changes': [
      { label: 'Should I approve?', prompt: 'What is your recommendation — approve, deny, or request more info?', icon: CheckCircle },
      { label: 'Risk assessment', prompt: 'What are the risks if I approve this change?', icon: AlertTriangle },
      { label: 'Missing requirements?', prompt: 'Is anything missing before I can approve?', icon: Shield },
    ],
    '/approvals': [
      { label: 'Review all pending', prompt: 'Walk me through each pending approval with your recommendation', icon: FileText },
      { label: 'Which to deny?', prompt: 'Are there any I should deny? Why?', icon: XCircle },
      { label: 'Batch approve safe items', prompt: 'Which items are safe to batch-approve?', icon: Zap },
    ],
    '/access-requests': [
      { label: 'Approve or deny?', prompt: 'What does the policy say? Should I approve this access?', icon: CheckCircle },
      { label: 'Entitlement check', prompt: 'Verify this user\'s entitlement eligibility', icon: Shield },
    ],
  },
  engineer: {
    '/': [
      { label: 'My changes', prompt: 'What changes need my attention?', icon: Code },
      { label: 'CI status', prompt: 'Are any of my changes failing CI?', icon: AlertTriangle },
    ],
    '/changes': [
      { label: 'Show me the code', prompt: 'What files and code are affected by this change?', icon: Code },
      { label: 'Run simulation', prompt: 'Simulate this change and show me the results', icon: Play },
      { label: 'Blast radius analysis', prompt: 'Deep dive into the blast radius — show me downstream dependencies', icon: Zap },
      { label: 'Generate PR', prompt: 'Generate a PR description for this change', icon: FileText },
    ],
    '/incidents': [
      { label: 'Root cause?', prompt: 'What\'s the likely root cause? Show me related code changes.', icon: Lightbulb },
      { label: 'Related PRs', prompt: 'Were there any recent PRs that could have caused this?', icon: Code },
      { label: 'Fix suggestion', prompt: 'Suggest a code fix for this issue', icon: Wrench },
    ],
  },
  it_support: {
    '/': [
      { label: 'Open tickets', prompt: 'What tickets are assigned to me?', icon: Wrench },
      { label: 'Recurring issues', prompt: 'Are there any recurring incidents I should know about?', icon: AlertTriangle },
    ],
    '/incidents': [
      { label: 'Diagnose this', prompt: 'What\'s the likely issue? Check the KB for known solutions.', icon: Lightbulb },
      { label: 'KB articles', prompt: 'Find relevant knowledge base articles for this issue', icon: FileText },
      { label: 'Safe to fix?', prompt: 'Is the recommended fix safe to trigger? What are the risks?', icon: Shield },
      { label: 'Draft customer response', prompt: 'Draft a customer-facing status update for this incident', icon: FileText },
    ],
    '/access-requests': [
      { label: 'User eligible?', prompt: 'Check if this user is eligible for the requested access', icon: KeyRound },
      { label: 'Route this request', prompt: 'Who should this request go to for approval?', icon: ArrowUpRight },
      { label: 'Similar requests', prompt: 'Have there been similar access requests recently?', icon: HelpCircle },
    ],
    '/approvals': [
      { label: 'What needs action?', prompt: 'Which approvals are waiting for IT Support input?', icon: AlertTriangle },
    ],
  },
  access_approver: {
    '/': [
      { label: 'Pending requests', prompt: 'What access requests are waiting for my approval?', icon: KeyRound },
      { label: 'High risk access', prompt: 'Are there any high-risk access requests I should prioritize?', icon: AlertTriangle },
    ],
    '/access-requests': [
      { label: 'Is user eligible?', prompt: 'Is this user eligible for the requested access based on entitlement?', icon: Shield },
      { label: 'Approve or deny?', prompt: 'What does the policy say? Should I approve this access request?', icon: CheckCircle },
      { label: 'Prior access history', prompt: 'Does this user have a history of similar access requests?', icon: FileText },
      { label: 'Draft denial reason', prompt: 'Draft a denial reason for this access request', icon: XCircle },
    ],
    '/approvals': [
      { label: 'My owned systems', prompt: 'Which pending approvals are for systems I own?', icon: Shield },
      { label: 'Auto-grant eligible?', prompt: 'Are any of these requests eligible for auto-grant?', icon: Zap },
    ],
  },
  admin: {
    '/': [
      { label: 'System health', prompt: 'Give me a full system health check — connectors, policies, integrations', icon: Shield },
      { label: 'Policy violations', prompt: 'Were there any policy violations or blocks today?', icon: AlertTriangle },
      { label: 'Full overview', prompt: 'Full operational summary across all lanes', icon: FileText },
    ],
    '/changes': [
      { label: 'Override policy?', prompt: 'Can I override the policy block on this change? What are the implications?', icon: Shield },
      { label: 'Full assessment', prompt: 'Complete risk and blast radius assessment', icon: AlertTriangle },
    ],
    '/policies': [
      { label: 'Active rules', prompt: 'What policy rules are currently active and what do they enforce?', icon: Shield },
      { label: 'Recent blocks', prompt: 'What actions were blocked by policy recently?', icon: XCircle },
    ],
    '/settings': [
      { label: 'Connector health', prompt: 'Are all integrations and connectors healthy?', icon: Wrench },
      { label: 'Role audit', prompt: 'Show me the current role distribution and permissions', icon: KeyRound },
    ],
  },
}

// Role-specific mock responses
const roleResponses: Record<Role, { content: string; type: MessageType; actionResult?: ActionResult }[]> = {
  operator: [
    { type: 'explanation', content: 'Based on the current queue, CHG-2024-0851 (schema migration) is the highest priority — it\'s escalated with a high blast radius affecting 5 services. I recommend reviewing the blast radius tab before routing for approval.' },
    { type: 'recommendation', content: 'I\'d suggest triaging INC-2024-1205 next. The connection pool issue on payment-service is recurring and has a safe config-only fix available. You can draft the remediation and escalate for approval.' },
    { type: 'action_result', content: 'Triage assessment complete.', actionResult: { decision: 'escalate', summary: 'High blast radius detected. Routing to senior engineer for review.', policyRule: 'blast-radius-threshold' } },
    { type: 'guardrail', content: 'You don\'t have permission to approve this directly. I\'ve prepared the assessment — route it to an Approver for sign-off.' },
  ],
  approver: [
    { type: 'explanation', content: 'This access request for daniel.kwon → orders-db (read_write) is pending your approval. The entitlement check passed, and the policy requires manager sign-off for database write access.' },
    { type: 'recommendation', content: 'I recommend approving the schema migration (CHG-2024-0851) with conditions: require a maintenance window and confirm the backfill can be paused. The blast radius is high but the rollback plan exists.' },
    { type: 'action_result', content: 'Approval evaluation complete.', actionResult: { decision: 'allow', summary: 'All policy checks passed. Entitlement verified. Manager approval is the final gate.', policyRule: 'dual-approval-prod-access' } },
  ],
  engineer: [
    { type: 'explanation', content: 'The blast radius for this schema migration shows 5 affected systems. The order-api and orders-db are critical dependencies. CI is currently failing on the migration — the NOT NULL constraint needs the backfill to complete first.' },
    { type: 'code_snippet', content: '```sql\n-- Migration: Add NOT NULL constraint\nALTER TABLE orders\n  ALTER COLUMN customer_id\n  SET NOT NULL;\n\n-- Backfill required first:\nUPDATE orders\n  SET customer_id = fallback_lookup(order_id)\n  WHERE customer_id IS NULL;\n-- Estimated: ~1.2M rows\n```\n\nThe backfill must complete before the constraint can be applied. I\'d recommend running it in batches of 1000.' },
    { type: 'recommendation', content: 'Run a simulation first. The migration involves 1.2M rows and the backfill strategy should be validated in staging before requesting production approval.' },
    { type: 'draft_artifact', content: '**PR Description Draft:**\n\n## What\nAdd NOT NULL constraint to `orders.customer_id`\n\n## Why\nEnforce referential integrity after backfill migration\n\n## Blast Radius\n- order-api (direct)\n- orders-db (schema change)\n- payment-service, analytics-pipeline (downstream)\n\n## Rollback\n`ALTER TABLE orders ALTER COLUMN customer_id DROP NOT NULL`' },
  ],
  it_support: [
    { type: 'explanation', content: 'INC-2024-1205 is a connection pool exhaustion on payment-service. This is a recurring issue — KB-4521 has the standard fix. The recommended remediation is a config-only change to increase pool size from 20 to 40.' },
    { type: 'recommendation', content: 'The fix is safe to trigger — it\'s a config-only change that requires a rolling restart. No maintenance window needed. I can draft the remediation response for the requester.' },
    { type: 'action_result', content: 'Remediation check complete.', actionResult: { decision: 'allow', summary: 'Config-only change. Safe remediation path confirmed. No code changes required.', policyRule: 'safe-remediation-auto-propose' } },
    { type: 'draft_artifact', content: '**Customer Response Draft:**\n\nWe\'ve identified the root cause as connection pool exhaustion on payment-service. Our team is increasing the HikariCP max-pool-size from 20 to 40. This is a rolling restart with no downtime expected.\n\nETA for resolution: 30 minutes.\n\nWe\'ll update this ticket once the fix has been applied and verified.' },
  ],
  access_approver: [
    { type: 'explanation', content: 'This access request is for daniel.kwon requesting read_write access to orders-db (PostgreSQL). The entitlement check passed — the user is on the order-api team. Manager approval has been obtained. As system owner, your approval is the final gate.' },
    { type: 'recommendation', content: 'I recommend approving with a 90-day time-bound. The user has a legitimate business need and the entitlement policy is satisfied. No prior access violations on record.' },
    { type: 'action_result', content: 'Entitlement evaluation complete.', actionResult: { decision: 'allow', summary: 'User eligible. Manager approved. Entitlement check passed. System owner approval is the final step.', policyRule: 'system-owner-approval' } },
    { type: 'guardrail', content: 'Manager approval has not been received yet. You cannot approve this request until the manager chain clears. The policy requires manager sign-off before system owner approval.' },
  ],
  admin: [
    { type: 'explanation', content: 'Full system status: 4 active incidents (1 sev2), 5 pending approvals, 2 access requests awaiting action. The production-write-guard policy blocked 1 execution today. All connectors are healthy.' },
    { type: 'policy_rationale', content: 'The "production-write-guard" policy blocked direct execution of CHG-2024-0851 because it\'s a schema migration with blast radius > 3 services. This requires the "controlled_apply" execution mode with dual approval.' },
    { type: 'action_result', content: 'System audit complete.', actionResult: { decision: 'allow', summary: 'All policy engines online. 8 active rules. 2 escalation rules triggered in the last 24h.', policyRule: 'system-health-check' } },
  ],
}

const typeIcons: Record<MessageType, typeof Lightbulb> = {
  text: MessageSquare,
  explanation: FileText,
  recommendation: Lightbulb,
  policy_rationale: Shield,
  action_proposal: Play,
  draft_artifact: FileText,
  action_result: CheckCircle,
  guardrail: Lock,
  code_snippet: Code,
}

const typeLabels: Record<MessageType, string> = {
  text: '',
  explanation: 'Explanation',
  recommendation: 'Recommendation',
  policy_rationale: 'Policy Rationale',
  action_proposal: 'Action Proposal',
  draft_artifact: 'Draft',
  action_result: 'Action Result',
  guardrail: 'Guardrail',
  code_snippet: 'Code',
}

const resultDecisionStyles: Record<string, { bg: string; text: string; icon: typeof CheckCircle }> = {
  allow: { bg: 'bg-status-approved/10 border-status-approved/20', text: 'text-status-approved', icon: CheckCircle },
  deny: { bg: 'bg-risk-critical/10 border-risk-critical/20', text: 'text-risk-critical', icon: XCircle },
  escalate: { bg: 'bg-status-escalated/10 border-status-escalated/20', text: 'text-status-escalated', icon: ArrowUpRight },
  simulate_only: { bg: 'bg-status-simulated/10 border-status-simulated/20', text: 'text-status-simulated', icon: Play },
}

export function ChatPanel() {
  const [isExpanded, setIsExpanded] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const { role, config } = useRole()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const currentPath = window.location.pathname
  const basePath = '/' + (currentPath.split('/')[1] || '')

  // Hide on detail pages — they use ContextualAssistant instead
  const pathParts = currentPath.split('/').filter(Boolean)
  const isDetailPage = pathParts.length >= 2 && ['changes', 'incidents', 'access-requests'].includes(pathParts[0])
  if (isDetailPage) return null

  const guardrail = roleGuardrails[role]

  // Get quick actions for this role + page context
  const roleActions = roleQuickActions[role] || roleQuickActions.admin
  const quickActions = roleActions[basePath] || roleActions['/'] || []

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    setMessages([])
  }, [role])

  const sendMessage = (text: string) => {
    if (!text.trim()) return

    const userMsg: Message = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: text.trim(),
      timestamp: new Date(),
      type: 'text',
    }

    const responses = roleResponses[role] || roleResponses.admin
    const response = responses[Math.floor(Math.random() * responses.length)]
    const assistantMsg: Message = {
      id: `msg-${Date.now() + 1}`,
      role: 'assistant',
      content: response.content,
      timestamp: new Date(),
      type: response.type,
      actionResult: response.actionResult,
    }

    setMessages(prev => [...prev, userMsg, assistantMsg])
    setInput('')
    if (!isExpanded) setIsExpanded(true)
  }

  const handleSend = () => sendMessage(input)

  const renderAssistantMessage = (msg: Message) => {
    const TypeIcon = typeIcons[msg.type] || MessageSquare
    const label = typeLabels[msg.type]

    return (
      <div className="space-y-2">
        {label && (
          <div className="flex items-center gap-1.5">
            <TypeIcon className={`w-3 h-3 ${msg.type === 'guardrail' ? 'text-risk-high' : msg.type === 'code_snippet' ? 'text-status-approved' : 'text-accent'}`} />
            <span className={`text-[10px] font-medium uppercase tracking-wider ${msg.type === 'guardrail' ? 'text-risk-high' : msg.type === 'code_snippet' ? 'text-status-approved' : 'text-accent'}`}>{label}</span>
          </div>
        )}
        <div className={cn(
          'rounded-lg px-3 py-2 text-sm whitespace-pre-wrap',
          msg.type === 'guardrail'
            ? 'bg-risk-high/10 text-risk-high border border-risk-high/20'
            : msg.type === 'code_snippet'
            ? 'bg-background text-text-primary border border-border font-mono text-xs'
            : 'bg-surface-raised text-text-primary border border-border'
        )}>
          {msg.content}
        </div>
        {msg.actionResult && renderActionResult(msg.actionResult)}
      </div>
    )
  }

  const renderActionResult = (result: ActionResult) => {
    const style = resultDecisionStyles[result.decision]
    if (!style) return null
    const Icon = style.icon

    return (
      <div className={`${style.bg} border rounded-lg p-3 space-y-1.5`}>
        <div className="flex items-center gap-2">
          <Icon className={`w-4 h-4 ${style.text}`} />
          <span className={`text-xs font-semibold uppercase tracking-wider ${style.text}`}>
            {result.decision.replace('_', ' ')}
          </span>
        </div>
        <p className="text-xs text-text-secondary">{result.summary}</p>
        {result.policyRule && (
          <div className="flex items-center gap-1 mt-1">
            <Shield className="w-3 h-3 text-text-muted" />
            <span className="text-[10px] text-text-muted font-mono">{result.policyRule}</span>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={cn(
      'fixed bottom-0 right-0 z-30 bg-surface border-t border-border transition-all duration-200',
      isExpanded ? 'h-[420px]' : 'h-14'
    )} style={{ left: '13rem' }}>
      {/* Collapsed bar / Header */}
      <div
        className="flex items-center justify-between h-14 px-4 cursor-pointer select-none"
        onClick={() => { setIsExpanded(!isExpanded); if (!isExpanded) setTimeout(() => inputRef.current?.focus(), 200) }}
      >
        <div className="flex items-center gap-3">
          <Bot className="w-5 h-5 text-accent" />
          <span className="text-sm font-medium text-text-primary">Sentinel</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent font-medium">{guardrail.label}</span>
          {messages.length > 0 && (
            <span className="text-[10px] text-text-muted bg-surface-raised px-1.5 py-0.5 rounded">
              {messages.filter(m => m.role === 'assistant').length} responses
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {!isExpanded && (
            <div className="hidden md:flex items-center gap-1.5">
              {quickActions.slice(0, 2).map(qa => (
                <button
                  key={qa.label}
                  onClick={e => { e.stopPropagation(); sendMessage(qa.prompt) }}
                  className="px-2.5 py-1 rounded-full bg-surface-raised border border-border text-xs text-text-muted hover:text-accent hover:border-accent/30 transition-colors"
                >
                  {qa.label}
                </button>
              ))}
            </div>
          )}
          <ChevronUp className={cn('w-4 h-4 text-text-muted transition-transform', isExpanded && 'rotate-180')} />
        </div>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="flex flex-col h-[calc(100%-3.5rem)]">
          {/* Guardrail banner */}
          <div className="px-4 py-1.5 bg-surface-raised/50 border-b border-border flex items-center gap-2 text-[10px] text-text-muted overflow-x-auto no-scrollbar">
            <Lock className="w-3 h-3 flex-shrink-0" />
            {guardrail.constraints.map((c, i) => (
              <span key={i} className="flex items-center gap-2 flex-shrink-0">
                {i > 0 && <span className="text-border">·</span>}
                {c}
              </span>
            ))}
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.length === 0 && (
              <div className="py-2">
                <p className="text-xs text-text-muted mb-3">Quick actions for {config.label}:</p>
                <div className="flex flex-wrap gap-1.5">
                  {quickActions.map(qa => {
                    const QAIcon = qa.icon
                    return (
                      <button
                        key={qa.label}
                        onClick={() => sendMessage(qa.prompt)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-surface-raised border border-border text-xs text-text-secondary hover:text-text-primary hover:border-accent/30 transition-colors"
                      >
                        <QAIcon className="w-3 h-3 text-accent" />
                        {qa.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
            {messages.map(msg => (
              <div key={msg.id} className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div className="max-w-[75%]">
                  {msg.role === 'user' ? (
                    <div className="bg-accent text-white rounded-lg px-3 py-2 text-sm">
                      {msg.content}
                    </div>
                  ) : (
                    renderAssistantMessage(msg)
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick actions when there are messages */}
          {messages.length > 0 && (
            <div className="px-4 pb-1.5">
              <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
                {quickActions.slice(0, 3).map(qa => (
                  <button
                    key={qa.label}
                    onClick={() => sendMessage(qa.prompt)}
                    className="flex-shrink-0 px-2.5 py-1 rounded-full bg-surface-raised border border-border text-xs text-text-muted hover:text-accent hover:border-accent/30 transition-colors"
                  >
                    {qa.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input */}
          <div className="px-4 py-2.5 border-t border-border">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSend()}
                placeholder={`Ask Sentinel (${guardrail.label})...`}
                className="flex-1 h-9 rounded-md border border-border-subtle bg-surface-raised px-3 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim()}
                className="h-9 px-3 rounded-md bg-accent text-white hover:bg-accent-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
