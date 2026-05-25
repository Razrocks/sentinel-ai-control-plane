import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
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
import Login from '@/pages/Login'

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
      <Routes>
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
