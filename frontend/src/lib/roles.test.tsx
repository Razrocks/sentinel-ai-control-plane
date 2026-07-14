import { describe, it, expect } from 'vitest'
import { render, renderHook } from '@testing-library/react'
import { RoleProvider, useRole, roles, type Role } from './roles'

// The role matrix is the frontend half of the RBAC contract. If
// `canAction` drifts here or on the backend, one side blocks a legit
// action and the other lets it through — invisible until an operator
// hits a button that toasts an unexplained error. These tests pin the
// matrix values that show up in the UI action rails.

const wrapper =
  (initialRole: Role) =>
  ({ children }: { children: React.ReactNode }) => (
    <RoleProvider initialRole={initialRole}>{children}</RoleProvider>
  )

describe('roles static matrix', () => {
  it('has all six canonical roles registered', () => {
    const keys = Object.keys(roles).sort()
    expect(keys).toEqual([
      'access_approver',
      'admin',
      'approver',
      'engineer',
      'it_support',
      'operator',
    ])
  })

  it('every role has non-empty label + description + nav', () => {
    for (const key of Object.keys(roles) as Role[]) {
      const r = roles[key]
      expect(r.label.length).toBeGreaterThan(0)
      expect(r.description.length).toBeGreaterThan(0)
      expect(r.nav.length).toBeGreaterThan(0)
      expect(r.actions.length).toBeGreaterThan(0)
    }
  })

  it('admin has the broadest surface (most actions of any role)', () => {
    const admin = roles.admin.actions.length
    for (const key of Object.keys(roles) as Role[]) {
      if (key === 'admin') continue
      expect(admin).toBeGreaterThanOrEqual(roles[key].actions.length)
    }
  })
})

describe('canAction — role-specific', () => {
  it('operator can attach_notes but cannot approve', () => {
    const { result } = renderHook(() => useRole(), { wrapper: wrapper('operator') })
    expect(result.current.canAction('attach_notes')).toBe(true)
    expect(result.current.canAction('approve')).toBe(false)
    expect(result.current.canAction('deny')).toBe(false)
    expect(result.current.canAction('execute')).toBe(false)
  })

  it('engineer can simulate + open_pr but cannot approve or merge', () => {
    const { result } = renderHook(() => useRole(), { wrapper: wrapper('engineer') })
    expect(result.current.canAction('simulate')).toBe(true)
    expect(result.current.canAction('open_pr')).toBe(true)
    expect(result.current.canAction('approve')).toBe(false)
    expect(result.current.canAction('merge')).toBe(false)
  })

  it('approver can approve + deny', () => {
    const { result } = renderHook(() => useRole(), { wrapper: wrapper('approver') })
    expect(result.current.canAction('approve')).toBe(true)
    expect(result.current.canAction('deny')).toBe(true)
  })

  it('access_approver can approve + deny but cannot edit policy', () => {
    const { result } = renderHook(() => useRole(), {
      wrapper: wrapper('access_approver'),
    })
    // Access approvers own approve/deny inside their domain but stay
    // out of policy config — that's Admin territory.
    expect(result.current.canAction('approve')).toBe(true)
    expect(result.current.canAction('deny')).toBe(true)
    expect(result.current.canAction('edit_policy')).toBe(false)
  })

  it('admin can update_policy + manage_integrations — no one else can', () => {
    const admin = renderHook(() => useRole(), { wrapper: wrapper('admin') })
    expect(admin.result.current.canAction('update_policy')).toBe(true)
    expect(admin.result.current.canAction('manage_integrations')).toBe(true)

    for (const r of ['operator', 'engineer', 'it_support', 'approver', 'access_approver'] as const) {
      const { result } = renderHook(() => useRole(), { wrapper: wrapper(r) })
      expect(result.current.canAction('update_policy')).toBe(false)
      expect(result.current.canAction('manage_integrations')).toBe(false)
    }
  })

  it('returns false for unknown actions', () => {
    const { result } = renderHook(() => useRole(), { wrapper: wrapper('admin') })
    expect(result.current.canAction('doesnt_exist')).toBe(false)
  })
})

describe('canAccess — nav gating', () => {
  it('operator can reach the workflow surfaces', () => {
    const { result } = renderHook(() => useRole(), { wrapper: wrapper('operator') })
    expect(result.current.canAccess('/')).toBe(true)
    expect(result.current.canAccess('/changes')).toBe(true)
    expect(result.current.canAccess('/changes/CHG-1')).toBe(true)
    expect(result.current.canAccess('/audit')).toBe(true)
  })

  it("engineer's nav does not include /approvals", () => {
    const { result } = renderHook(() => useRole(), { wrapper: wrapper('engineer') })
    // Confirm the matrix: engineer nav is ['/', '/changes', '/incidents', '/audit']
    expect(result.current.canAccess('/changes')).toBe(true)
    expect(result.current.canAccess('/approvals')).toBe(false)
  })

  it('subpaths of a nav prefix are permitted', () => {
    const { result } = renderHook(() => useRole(), { wrapper: wrapper('operator') })
    expect(result.current.canAccess('/incidents/inc-001')).toBe(true)
    expect(result.current.canAccess('/access-requests/ar-001')).toBe(true)
  })
})

describe('getActionPermission', () => {
  it('returns {allowed: true} for authorized actions', () => {
    const { result } = renderHook(() => useRole(), { wrapper: wrapper('approver') })
    const perm = result.current.getActionPermission('approve', 'Approve')
    expect(perm).toEqual({ action: 'approve', label: 'Approve', allowed: true })
  })

  it('returns {allowed: false, reason: <matrix reason>} for blocked actions', () => {
    const { result } = renderHook(() => useRole(), { wrapper: wrapper('operator') })
    const perm = result.current.getActionPermission('approve', 'Approve')
    expect(perm.allowed).toBe(false)
    // Reason must be the specific reason from the blocked matrix, not
    // the generic fallback — otherwise the UI's action guard modals
    // display the wrong copy.
    expect(perm.reason).toMatch(/cannot self-approve/)
  })

  it('returns a generic fallback reason for actions not in either list', () => {
    const { result } = renderHook(() => useRole(), { wrapper: wrapper('operator') })
    const perm = result.current.getActionPermission('random_new_action', 'Whatever')
    expect(perm.allowed).toBe(false)
    expect(perm.reason).toMatch(/Not available for/)
  })
})

describe('RoleProvider integration', () => {
  it('renders children (smoke)', () => {
    const { container } = render(
      <RoleProvider initialRole="operator">
        <div>child</div>
      </RoleProvider>,
    )
    expect(container.textContent).toBe('child')
  })
})
