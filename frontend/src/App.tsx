import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { RoleProvider } from '@/lib/roles'
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
import Login from '@/pages/Login'

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth()

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

  return <>{children}</>
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginGuard />} />
          <Route
            element={
              <AuthGuard>
                <RoleProvider>
                  <AppShell />
                </RoleProvider>
              </AuthGuard>
            }
          >
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
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

/** Redirect to dashboard if already logged in */
function LoginGuard() {
  const { isAuthenticated, isLoading } = useAuth()
  if (isLoading) return null
  if (isAuthenticated) return <Navigate to="/" replace />
  return <Login />
}
