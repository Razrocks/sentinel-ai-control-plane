import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

export type Role = 'operator' | 'engineer' | 'it_support' | 'approver' | 'access_approver' | 'admin'

export interface ActionPermission {
  action: string
  label: string
  allowed: boolean
  reason?: string // Why blocked — shown to user
}

export interface RoleConfig {
  id: Role
  label: string
  description: string
  nav: string[]
  actions: string[]
  blockedActions: { action: string; label: string; reason: string }[]
}

export const roles: Record<Role, RoleConfig> = {
  operator: {
    id: 'operator',
    label: 'Operator',
    description: 'Change review, release readiness, escalation, controlled execution',
    nav: ['/', '/changes', '/incidents', '/access-requests', '/approvals', '/audit'],
    actions: [
      'assess', 'triage', 'draft', 'escalate', 'request_review', 'simulate',
      'route', 'attach_notes', 'request_evidence', 'prepare_approval',
      'block_workflow', 'pause_workflow', 'open_pr_draft',
    ],
    blockedActions: [
      { action: 'approve', label: 'Approve', reason: 'Operators cannot self-approve. Route to an Approver.' },
      { action: 'deny', label: 'Deny', reason: 'Approval decisions require Approver role.' },
      { action: 'execute', label: 'Execute', reason: 'Direct execution blocked by policy. Use simulation or escalate.' },
      { action: 'override_policy', label: 'Override Policy', reason: 'Policy overrides require Admin role.' },
      { action: 'execute_grant', label: 'Grant Access', reason: 'Access grants require Access Approver or Admin.' },
    ],
  },
  engineer: {
    id: 'engineer',
    label: 'Engineer',
    description: 'Impact analysis, code review, patch generation, technical implementation',
    nav: ['/', '/changes', '/incidents', '/audit'],
    actions: [
      'assess', 'request_review', 'simulate', 'open_pr', 'draft',
      'attach_notes', 'generate_patch', 'generate_tests', 'generate_migration',
      'create_branch', 'inspect_execution', 'request_escalation',
    ],
    blockedActions: [
      { action: 'approve', label: 'Approve', reason: 'Engineers cannot approve changes. Request review from an Approver.' },
      { action: 'deny', label: 'Deny', reason: 'Approval decisions require Approver role.' },
      { action: 'execute', label: 'Deploy to Production', reason: 'Production deployment requires approval and controlled execution mode.' },
      { action: 'merge', label: 'Merge to Main', reason: 'Merge requires approval unless policy explicitly allows.' },
      { action: 'execute_grant', label: 'Grant Access', reason: 'Access grants are outside Engineer scope.' },
    ],
  },
  it_support: {
    id: 'it_support',
    label: 'IT Support',
    description: 'Incidents, service requests, KB remediation, safe operational fixes',
    nav: ['/', '/incidents', '/access-requests', '/approvals', '/audit'],
    actions: [
      'triage', 'draft_response', 'work_note', 'route', 'trigger_fix',
      'link_kb', 'escalate', 'request_info', 'connect_related',
      'mark_awaiting', 'reassign',
    ],
    blockedActions: [
      { action: 'approve', label: 'Approve', reason: 'IT Support cannot approve requests. Escalate to Approver.' },
      { action: 'execute', label: 'Execute High-Risk Fix', reason: 'High-risk remediation requires approval. Use escalation path.' },
      { action: 'override_policy', label: 'Override Routing', reason: 'Routing rules are policy-governed and cannot be overridden.' },
      { action: 'execute_grant', label: 'Grant Access', reason: 'Access grants require Access Approver role.' },
      { action: 'modify_system', label: 'Modify Protected System', reason: 'Protected system modifications blocked by policy.' },
    ],
  },
  approver: {
    id: 'approver',
    label: 'Approver',
    description: 'Reviews changes, access requests, remediation approvals',
    nav: ['/', '/approvals', '/changes', '/incidents', '/access-requests', '/audit'],
    actions: [
      'approve', 'deny', 'approve_with_condition', 'escalate', 'request_info', 'attach_notes',
      'review_evidence', 'open_details',
    ],
    blockedActions: [
      { action: 'execute', label: 'Execute Change', reason: 'Approvers review and decide — execution is handled by the system or Operator.' },
      { action: 'edit_policy', label: 'Edit Policy', reason: 'Policy management requires Admin role.' },
      { action: 'generate_patch', label: 'Generate Patch', reason: 'Code generation is an Engineer action.' },
      { action: 'self_approve', label: 'Self-Approve', reason: 'Cannot approve your own requests. Requires independent reviewer.' },
      { action: 'bypass_coapproval', label: 'Skip Co-Approval', reason: 'Co-approval required by policy. Cannot bypass.' },
    ],
  },
  access_approver: {
    id: 'access_approver',
    label: 'Access Approver',
    description: 'System owner — approves access to specific systems, roles, entitlements',
    nav: ['/', '/access-requests', '/approvals', '/audit'],
    actions: [
      'approve', 'deny', 'request_info', 'route',
      'review_evidence', 'review_grant_readiness',
    ],
    blockedActions: [
      { action: 'execute_grant', label: 'Direct Grant', reason: 'Access grants are executed by the system after all approvals clear.' },
      { action: 'bypass_manager', label: 'Skip Manager Approval', reason: 'Manager approval is required by policy before system owner sign-off.' },
      { action: 'modify_entitlements', label: 'Modify Entitlement Rules', reason: 'Entitlement rule changes require Admin role.' },
      { action: 'execute', label: 'Execute Change', reason: 'Change execution is outside Access Approver scope.' },
      { action: 'edit_policy', label: 'Edit Policy', reason: 'Policy management requires Admin role.' },
    ],
  },
  admin: {
    id: 'admin',
    label: 'Admin',
    description: 'Guardrails, integrations, policy bundles, governance configuration',
    nav: ['/', '/changes', '/incidents', '/access-requests', '/approvals', '/audit', '/policies', '/settings'],
    actions: [
      'approve', 'deny', 'assess', 'triage', 'draft', 'escalate', 'simulate',
      'open_pr', 'block', 'request_review', 'route', 'trigger_fix', 'link_kb',
      'draft_response', 'work_note', 'request_info', 'attach_notes',
      'execute_grant', 'route_manager', 'route_owner',
      'update_policy', 'update_role_mapping', 'manage_integrations',
      'manage_environments', 'inspect_denied', 'review_restrictions',
    ],
    blockedActions: [
      { action: 'bypass_audit', label: 'Bypass Audit', reason: 'All actions are logged. Audit trail cannot be bypassed.' },
      { action: 'silent_execute', label: 'Silent Execution', reason: 'All production actions require audit trail and policy path.' },
      { action: 'mutate_prod_direct', label: 'Direct Prod Mutation', reason: 'Production mutations require controlled execution mode.' },
    ],
  },
}

interface RoleContextValue {
  role: Role
  config: RoleConfig
  setRole: (role: Role) => void
  canAccess: (path: string) => boolean
  canAction: (action: string) => boolean
  getBlockedActions: () => { action: string; label: string; reason: string }[]
  getActionPermission: (action: string, label: string) => ActionPermission
}

const RoleContext = createContext<RoleContextValue | null>(null)

export function RoleProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role>('operator')
  const config = roles[role]

  const canAccess = (path: string) => {
    return config.nav.some(p => {
      if (p === '/') return path === '/'
      return path.startsWith(p)
    })
  }

  const canAction = (action: string) => config.actions.includes(action)

  const getBlockedActions = () => config.blockedActions

  const getActionPermission = (action: string, label: string): ActionPermission => {
    if (config.actions.includes(action)) {
      return { action, label, allowed: true }
    }
    const blocked = config.blockedActions.find(b => b.action === action)
    if (blocked) {
      return { action, label, allowed: false, reason: blocked.reason }
    }
    return { action, label, allowed: false, reason: `Not available for ${config.label} role.` }
  }

  return (
    <RoleContext.Provider value={{ role, config, setRole, canAccess, canAction, getBlockedActions, getActionPermission }}>
      {children}
    </RoleContext.Provider>
  )
}

export function useRole() {
  const ctx = useContext(RoleContext)
  if (!ctx) throw new Error('useRole must be used within RoleProvider')
  return ctx
}
