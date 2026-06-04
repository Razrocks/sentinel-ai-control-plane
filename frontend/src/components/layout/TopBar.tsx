import { useState, useRef, useEffect } from 'react';
import { Search, ChevronDown, Bell, CircleUser, Check, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRole, roles, type Role } from '@/lib/roles';
import { useAuth } from '@/lib/auth';
import { useNavigate } from 'react-router-dom';

const environments = [
  { id: 'production', label: 'Production', color: 'bg-risk-critical' },
  { id: 'staging', label: 'Staging', color: 'bg-status-pending' },
  { id: 'development', label: 'Development', color: 'bg-status-approved' },
  { id: 'sandbox', label: 'Sandbox', color: 'bg-accent' },
];

const roleList = Object.values(roles);

export function TopBar() {
  const { role, config, setRole } = useRole();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [envOpen, setEnvOpen] = useState(false);
  const [roleOpen, setRoleOpen] = useState(false);
  // Only admins may impersonate other roles. Everyone else sees a static
  // label of their own role so the UI still shows context, but the
  // dropdown that lets a non-admin grant themselves additional permissions
  // is hidden. The backend still enforces RBAC on every mutation — this is
  // a UX guard, not the security boundary.
  const canSwitchRole = user?.role === 'admin';

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };
  const [activeEnv, setActiveEnv] = useState(environments[0]);
  const envRef = useRef<HTMLDivElement>(null);
  const roleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (envRef.current && !envRef.current.contains(e.target as Node)) setEnvOpen(false);
      if (roleRef.current && !roleRef.current.contains(e.target as Node)) setRoleOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header className="fixed top-0 right-0 z-20 flex h-14 items-center gap-6 border-b border-border bg-surface px-8" style={{ left: '13rem' }}>
      {/* Search — grows to fill available space */}
      <div className="relative flex-1 max-w-lg">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
        <input
          type="text"
          placeholder="Search changes, incidents, requests..."
          className={cn(
            'h-9 w-full rounded-md border border-border-subtle bg-surface-raised pl-10 pr-4 text-sm text-text-primary',
            'placeholder:text-text-muted',
            'focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent'
          )}
        />
      </div>

      {/* Right-side controls */}
      <div className="flex items-center gap-3 ml-auto flex-shrink-0">
        {/* Environment selector */}
        <div className="relative" ref={envRef}>
          <button
            type="button"
            onClick={() => setEnvOpen(!envOpen)}
            className="flex items-center gap-2 rounded-md border border-border-subtle bg-surface-raised px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors whitespace-nowrap"
          >
            <span className={cn('h-2 w-2 rounded-full flex-shrink-0', activeEnv.color)} />
            <span className="hidden xl:inline">{activeEnv.label}</span>
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform flex-shrink-0', envOpen && 'rotate-180')} />
          </button>

          {envOpen && (
            <div className="absolute right-0 top-full mt-1 w-48 rounded-lg border border-border bg-surface-raised shadow-lg py-1 z-50">
              {environments.map(env => (
                <button
                  key={env.id}
                  onClick={() => { setActiveEnv(env); setEnvOpen(false); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-text-secondary hover:bg-surface-overlay hover:text-text-primary transition-colors"
                >
                  <span className={cn('h-2 w-2 rounded-full', env.color)} />
                  <span className="flex-1 text-left">{env.label}</span>
                  {env.id === activeEnv.id && <Check className="h-3.5 w-3.5 text-accent" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Policy status */}
        <div className="flex items-center gap-1.5 text-xs text-text-secondary whitespace-nowrap">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          <span className="hidden lg:inline">Policy Active</span>
        </div>

        {/* Notifications */}
        <button
          type="button"
          className="relative rounded-md p-2 text-text-secondary hover:bg-surface-raised hover:text-text-primary transition-colors"
        >
          <Bell className="h-4 w-4" />
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-red-500" />
        </button>

        {/* Role badge / switcher — non-admins see a static badge of their own
            role; admins get the dropdown for impersonation during demos and
            governance reviews. */}
        {canSwitchRole ? (
          <div className="relative" ref={roleRef}>
            <button
              type="button"
              onClick={() => setRoleOpen(!roleOpen)}
              className="flex items-center gap-2 rounded-md border border-border-subtle bg-surface-raised px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors whitespace-nowrap"
              title="Impersonate role (admin only)"
            >
              <CircleUser className="h-4 w-4 flex-shrink-0" />
              <span className="hidden sm:inline">{config.label}</span>
              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform flex-shrink-0', roleOpen && 'rotate-180')} />
            </button>

            {roleOpen && (
              <div className="absolute right-0 top-full mt-1 w-64 rounded-lg border border-border bg-surface-raised shadow-lg py-1 z-50">
                <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-text-muted border-b border-border-subtle">
                  Impersonate (admin)
                </div>
                {roleList.map(r => (
                  <button
                    key={r.id}
                    onClick={() => { setRole(r.id); setRoleOpen(false); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-surface-overlay transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className={cn('text-sm', r.id === role ? 'text-text-primary font-medium' : 'text-text-secondary')}>{r.label}</div>
                      <div className="text-xs text-text-muted truncate">{r.description}</div>
                    </div>
                    {r.id === role && <Check className="h-3.5 w-3.5 text-accent flex-shrink-0" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-md border border-border-subtle bg-surface-raised px-3 py-1.5 text-sm text-text-secondary whitespace-nowrap">
            <CircleUser className="h-4 w-4 flex-shrink-0" />
            <span className="hidden sm:inline">{config.label}</span>
          </div>
        )}

        {/* User name + Logout */}
        {user && (
          <>
            <span className="text-xs text-text-secondary hidden lg:inline truncate max-w-[120px]">{user.name}</span>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-md p-2 text-text-secondary hover:bg-surface-raised hover:text-red-400 transition-colors"
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </>
        )}
      </div>
    </header>
  );
}
