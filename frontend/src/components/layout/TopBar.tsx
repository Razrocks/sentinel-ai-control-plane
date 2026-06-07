/**
 * TopBar — search, environment, role badge, user menu.
 *
 * Phase 4: bigger search input (h-10), user menu collapsed to avatar +
 * dropdown, environment + policy indicators pulled into compact pill row.
 */
import { useState } from 'react'
import { Search, ChevronDown, LogOut, Shield, Settings as SettingsIcon, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useRole, roles, type Role } from '@/lib/roles'
import { useAuth } from '@/lib/auth'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const environments = [
  { id: 'production', label: 'Production', color: 'bg-risk-critical' },
  { id: 'staging', label: 'Staging', color: 'bg-status-pending' },
  { id: 'development', label: 'Development', color: 'bg-status-approved' },
  { id: 'sandbox', label: 'Sandbox', color: 'bg-primary' },
]

const roleList = Object.values(roles)

export function TopBar() {
  const { role, config, setRole } = useRole()
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [activeEnv, setActiveEnv] = useState(environments[0])

  const canSwitchRole = user?.role === 'admin'

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  // Compact initials for the user avatar.
  const initials =
    user?.name
      ?.split(' ')
      .map((s) => s[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() ?? '?'

  return (
    <header
      className="fixed top-0 right-0 z-20 flex h-16 items-center gap-4 border-b border-border bg-card px-6"
      style={{ left: '15rem' }}
    >
      {/* Search */}
      <div className="relative flex-1 max-w-xl">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search changes, incidents, requests..."
          className="pl-10 bg-background border-border"
        />
      </div>

      <div className="flex items-center gap-2 ml-auto">
        {/* Environment selector */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2 h-9">
              <span className={cn('h-2 w-2 rounded-full', activeEnv.color)} />
              <span>{activeEnv.label}</span>
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>Environment</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {environments.map((env) => (
              <DropdownMenuItem key={env.id} onSelect={() => setActiveEnv(env)}>
                <span className={cn('h-2 w-2 rounded-full', env.color)} />
                <span>{env.label}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Policy status — minimal pill */}
        <div className="hidden md:flex items-center gap-1.5 px-3 h-9 rounded-md border border-border bg-secondary text-xs text-muted-foreground">
          <span className="h-2 w-2 rounded-full bg-status-approved" />
          <span>Policy Active</span>
        </div>

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-2 h-9 pl-2 pr-3">
              <div className="h-7 w-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold">
                {initials}
              </div>
              <span className="hidden md:inline text-sm font-medium">{user?.name ?? 'Guest'}</span>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-foreground">{user?.name}</span>
                <span className="text-xs text-muted-foreground normal-case tracking-normal">
                  {user?.email}
                </span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />

            <DropdownMenuItem disabled>
              <User className="h-4 w-4" />
              <span>Profile</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate('/settings')}>
              <SettingsIcon className="h-4 w-4" />
              <span>Settings</span>
            </DropdownMenuItem>

            {canSwitchRole && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Impersonate role (admin)</DropdownMenuLabel>
                {roleList.map((r) => (
                  <DropdownMenuItem
                    key={r.id}
                    onSelect={() => setRole(r.id as Role)}
                    className={cn(role === r.id && 'bg-secondary')}
                  >
                    <Shield className="h-4 w-4" />
                    <span>{r.label}</span>
                  </DropdownMenuItem>
                ))}
              </>
            )}

            {!canSwitchRole && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled>
                  <Shield className="h-4 w-4" />
                  <span>Role: {config.label}</span>
                </DropdownMenuItem>
              </>
            )}

            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={handleLogout} className="text-destructive focus:text-destructive">
              <LogOut className="h-4 w-4" />
              <span>Sign out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
