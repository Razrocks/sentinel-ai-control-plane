/**
 * AppShell — fixed sidebar + main column with sticky TopBar.
 *
 * Outlet wrapped in a key'd container so route changes trigger a fresh
 * mount + the page-transition fade-in (defined in index.css). Without the
 * key on `location.pathname`, React reuses the same DOM tree and the
 * animation never replays.
 */
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { ChatPanel } from '@/components/shared/ChatPanel'

export function AppShell() {
  const location = useLocation()
  return (
    <div className="min-h-screen bg-background">
      <Sidebar approvalCount={5} />
      <div className="min-w-0 flex flex-col" style={{ marginLeft: '15rem' }}>
        <TopBar />
        <main className="min-w-0 overflow-x-hidden flex-1">
          {/* Padding scales down on tablets so content doesn't get squeezed
              into a narrow strip. Above lg we use the comfortable 4rem/3rem
              padding; below we shrink to ~1.5rem all-round. */}
          <div
            className="w-full animate-page-in px-6 pt-8 pb-24 mx-auto lg:[padding-left:4rem] lg:[padding-right:3rem] lg:pt-10"
            key={location.pathname}
            style={{ maxWidth: '1700px' }}
          >
            <Outlet />
          </div>
        </main>
      </div>
      <ChatPanel />
    </div>
  )
}
