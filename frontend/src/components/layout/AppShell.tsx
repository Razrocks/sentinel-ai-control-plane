/**
 * AppShell — fixed sidebar + main column with sticky TopBar.
 */
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { ChatPanel } from '@/components/shared/ChatPanel'

export function AppShell() {
  return (
    <div className="min-h-screen bg-background">
      <Sidebar approvalCount={5} />
      <div className="min-w-0 flex flex-col" style={{ marginLeft: '15rem' }}>
        <TopBar />
        <main className="min-w-0 overflow-x-hidden flex-1">
          <div
            className="w-full"
            style={{
              maxWidth: '1700px',
              paddingLeft: '4rem',
              paddingRight: '3rem',
              paddingTop: '2.5rem',
              paddingBottom: '6rem',
            }}
          >
            <Outlet />
          </div>
        </main>
      </div>
      <ChatPanel />
    </div>
  )
}
