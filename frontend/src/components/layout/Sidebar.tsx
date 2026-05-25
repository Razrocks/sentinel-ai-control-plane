import { NavLink } from 'react-router-dom';
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
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRole } from '@/lib/roles';

interface SidebarProps {
  approvalCount: number;
}

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/changes', label: 'Changes', icon: GitPullRequest },
  { to: '/incidents', label: 'Incidents', icon: AlertTriangle },
  { to: '/access-requests', label: 'Access Requests', icon: KeyRound },
  { to: '/approvals', label: 'Approvals', icon: CheckCircle2, hasBadge: true },
  { to: '/audit', label: 'Audit Trail', icon: ScrollText },
  { to: '/policies', label: 'Policies', icon: Shield },
  { to: '/settings', label: 'Settings', icon: Settings },
  { to: '/admin', label: 'Admin Metrics', icon: Activity },
];

export function Sidebar({ approvalCount }: SidebarProps) {
  const { canAccess, config } = useRole();

  const visibleItems = navItems.filter(item => canAccess(item.to));

  return (
    <aside className="fixed inset-y-0 left-0 z-30 flex w-[13rem] flex-col bg-surface border-r border-border">
      <div className="flex h-14 items-center px-4 border-b border-border">
        <span className="text-base font-bold text-text-primary tracking-tight">
          Sentinel
        </span>
      </div>

      <nav className="flex-1 space-y-0.5 px-2 py-3">
        {visibleItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors',
                isActive
                  ? 'bg-accent text-white'
                  : 'text-text-secondary hover:bg-surface-raised hover:text-text-primary'
              )
            }
          >
            <item.icon className="h-4 w-4 shrink-0" />
            <span className="flex-1 truncate">{item.label}</span>
            {item.hasBadge && approvalCount > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[10px] font-semibold text-white">
                {approvalCount}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="px-4 py-3 border-t border-border">
        <div className="text-[10px] text-text-muted">{config.label} · v1.0</div>
      </div>
    </aside>
  );
}
