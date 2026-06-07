/**
 * Sidebar — vertical nav, dark only, larger touch targets.
 *
 * Phase 4 design:
 *   - Width 15rem (was 13rem) — more breathing room for labels
 *   - Items h-10 with text-sm font-medium — readable, click-friendly
 *   - Active state uses primary fill, not just text colour
 *   - Sections grouped: Workflow / Governance / System
 *   - Approval count badge larger + always visible when > 0
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
import { Separator } from '@/components/ui/separator'

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
      className="fixed inset-y-0 left-0 z-30 flex flex-col bg-card border-r border-border"
      style={{ width: '15rem' }}
    >
      {/* Brand */}
      <div className="flex h-16 items-center px-5 border-b border-border">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-md bg-primary flex items-center justify-center">
            <Shield className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="text-base font-semibold text-foreground tracking-tight">Sentinel</span>
        </div>
      </div>

      {/* Nav groups */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {navGroups.map((group) => {
          const visible = group.items.filter((item) => canAccess(item.to))
          if (visible.length === 0) return null
          return (
            <div key={group.label}>
              <div className="px-2.5 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.label}
              </div>
              <div className="space-y-0.5">
                {visible.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    className={({ isActive }) =>
                      cn(
                        'flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
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
            </div>
          )
        })}
      </nav>

      <Separator />

      {/* Role footer */}
      <div className="px-5 py-3">
        <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
          Current role
        </div>
        <div className="text-sm font-medium text-foreground">{config.label}</div>
      </div>
    </aside>
  )
}
