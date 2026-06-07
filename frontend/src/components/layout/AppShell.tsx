/**
 * AppShell — shell layout wrapping every authenticated page.
 *
 * Phase 4: tighter responsive margin math, bigger content gutter so
 * cards have room to render the new larger primitives.
 */
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { ChatPanel } from '@/components/shared/ChatPanel'

export function AppShell() {
  return (
    <div className="min-h-screen bg-background">
      <Sidebar approvalCount={5} />
      <TopBar />
      <main
        className="min-w-0 overflow-x-hidden"
        style={{
          marginLeft: '15rem',
          paddingLeft: '2rem',
          paddingRight: '2rem',
          paddingBottom: '3rem',
          paddingTop: 'calc(4rem + 2rem)',
        }}
      >
        <Outlet />
      </main>
      <ChatPanel />
    </div>
  )
}
