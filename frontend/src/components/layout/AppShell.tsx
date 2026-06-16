/**
 * AppShell — fixed sidebar + main column with sticky TopBar.
 *
 * NB: we tried keying the outlet container on `location.pathname` to replay
 * the page-in animation on every route change, but that forced full
 * unmount/remount which fought React Strict Mode's double-render and caused
 * "Rendered more hooks than during the previous render" errors on the new
 * route's first render. Trade-off: animation plays on initial app load
 * only, not subsequent route hops. Worth it for stability.
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
            className="w-full animate-page-in"
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
