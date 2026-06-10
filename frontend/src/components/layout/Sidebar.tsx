/**
 * Sidebar — vertical left nav. Simple fixed-width design.
 *
 * Keeps the look of the previous (working) sidebar but uses the new
 * theme tokens (sidebar-foreground, sidebar-primary, etc.) and the
 * Badge primitive for the approval count.
 */
import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  GitPullRequest,
  AlertTriangle,
  KeyRound,
  CheckCircle2,
  ScrollText,
  Shield,
  Settings,
  Activity,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useRole } from '@/lib/roles'
import { Badge } from '@/components/ui/badge'

interface SidebarProps {
  approvalCount: number
}

interface NavItem {
  to: string
  label: string
  icon: typeof LayoutDashboard
  hasBadge?: boolean
}

interface NavGroup {
  label: string
  items: NavItem[]
}

const navGroups: NavGroup[] = [
  {
    label: 'Overview',
    items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard }],
  },
  {
    label: 'Workflow',
    items: [
      { to: '/changes', label: 'Changes', icon: GitPullRequest },
      { to: '/incidents', label: 'Incidents', icon: AlertTriangle },
      { to: '/access-requests', label: 'Access Requests', icon: KeyRound },
      { to: '/approvals', label: 'Approvals', icon: CheckCircle2, hasBadge: true },
    ],
  },
  {
    label: 'Governance',
    items: [
      { to: '/audit', label: 'Audit Trail', icon: ScrollText },
      { to: '/policies', label: 'Policies', icon: Shield },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/settings', label: 'Settings', icon: Settings },
      { to: '/admin', label: 'Admin Metrics', icon: Activity },
    ],
  },
]

export function Sidebar({ approvalCount }: SidebarProps) {
  const { canAccess, config } = useRole()

  return (
    <aside
      className="fixed inset-y-0 left-0 z-30 flex flex-col border-r border-sidebar-border bg-sidebar"
      style={{ width: '15rem' }}
    >
      {/* Brand */}
      <div className="flex h-16 items-center gap-2.5 border-b border-sidebar-border px-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground flex-shrink-0">
          <Shield className="h-4 w-4" />
        </div>
        <span className="font-heading text-base font-semibold text-sidebar-foreground tracking-tight">
          Sentinel
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 flex flex-col gap-5">
        {navGroups.map((group) => {
          const visible = group.items.filter((item) => canAccess(item.to))
          if (visible.length === 0) return null
          return (
            <div key={group.label} className="flex flex-col gap-1">
              <div className="px-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.label}
              </div>
              {visible.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    cn(
                      'flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                        : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground',
                    )
                  }
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.hasBadge && approvalCount > 0 && (
                    <Badge variant="default" className="h-5 min-w-5 px-1.5 text-[10px]">
                      {approvalCount}
                    </Badge>
                  )}
                </NavLink>
              ))}
            </div>
          )
        })}
      </nav>

      {/* Footer — current role */}
      <div className="border-t border-sidebar-border px-5 py-3">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Current role
        </div>
        <div className="text-sm font-medium text-sidebar-foreground">{config.label}</div>
      </div>
    </aside>
  )
}
