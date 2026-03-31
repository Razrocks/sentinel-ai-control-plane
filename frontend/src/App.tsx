import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { RoleProvider } from '@/lib/roles'
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

export default function App() {
  return (
    <RoleProvider>
      <BrowserRouter>
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
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </RoleProvider>
  )
}
