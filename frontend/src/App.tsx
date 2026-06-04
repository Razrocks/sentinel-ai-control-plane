import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { RoleProvider, type Role } from '@/lib/roles'
import { AuthProvider, useAuth } from '@/lib/auth'
import { AppShell } from '@/components/layout'
import Dashboard from '@/pages/Dashboard'
import Changes from '@/pages/Changes'
import ChangeDetail from '@/pages/ChangeDetail'
import Incidents from '@/pages/Incidents'
import IncidentDetail from '@/pages/IncidentDetail'
import AccessRequests from '@/pages/AccessRequests'
import AccessRequestDetail from '@/pages/AccessRequestDetail'
import Approvals from '@/pages/Approvals'
import AuditTrail from '@/pages/AuditTrail'
import Policies from '@/pages/Policies'
import Settings from '@/pages/Settings'
import AdminMetrics from '@/pages/AdminMetrics'
import Setup from '@/pages/Setup'
import Login from '@/pages/Login'
import { useSetupStatus } from '@/hooks/useSetup'

/**
 * Setup guard — admins see the bootstrap wizard until SetupState says it's
 * done. Non-admins fall through (the seed already creates non-admin users,
 * so they shouldn't be blocked by an admin-only setup task).
 *
 * Always allow `/setup` itself to render, so we don't bounce in a loop.
 */
function SetupGuard({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const location = useLocation()
  const { data, isLoading } = useSetupStatus()

  // Only admins are gated by setup. Other users continue to the app even
  // if setup is in progress — they don't have the perms to fix it anyway.
  const shouldGate = user?.role === 'admin'

  if (!shouldGate) return <>{children}</>
  if (isLoading || !data) return <>{children}</>
  if (data.onboardingComplete) return <>{children}</>
  if (location.pathname === '/setup') return <>{children}</>
  return <Navigate to="/setup" replace />
}

/** Authenticated app shell — reads auth user and passes role to RoleProvider */
function AuthenticatedRoutes() {
  const { isAuthenticated, isLoading, user } = useAuth()

  if (isLoading) {
    return (
      <div className="min-h-screen bg-bg-primary flex items-center justify-center">
        <div className="text-text-secondary">Loading...</div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return (
    <RoleProvider initialRole={user?.role as Role}>
      <SetupGuard>
        <Routes>
          {/* Setup wizard renders outside AppShell so it gets a full-screen layout */}
          <Route path="/setup" element={<Setup />} />
          <Route element={<AppShell />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/changes" element={<Changes />} />
            <Route path="/changes/:id" element={<ChangeDetail />} />
            <Route path="/incidents" element={<Incidents />} />
            <Route path="/incidents/:id" element={<IncidentDetail />} />
            <Route path="/access-requests" element={<AccessRequests />} />
            <Route path="/access-requests/:id" element={<AccessRequestDetail />} />
            <Route path="/approvals" element={<Approvals />} />
            <Route path="/audit" element={<AuditTrail />} />
            <Route path="/policies" element={<Policies />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/admin" element={<AdminMetrics />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </SetupGuard>
    </RoleProvider>
  )
}

/** Redirect to dashboard if already logged in */
function LoginRoute() {
  const { isAuthenticated, isLoading } = useAuth()
  if (isLoading) return null
  if (isAuthenticated) return <Navigate to="/" replace />
  return <Login />
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginRoute />} />
          <Route path="/*" element={<AuthenticatedRoutes />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
