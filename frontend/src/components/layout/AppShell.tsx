import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { ChatPanel } from '@/components/shared/ChatPanel';

export function AppShell() {
  return (
    <div className="min-h-screen bg-background">
      <Sidebar approvalCount={5} />
      <TopBar />
      <main
        className="pb-20 min-w-0 overflow-x-hidden"
        style={{ marginLeft: '13rem', paddingLeft: '2rem', paddingRight: '2rem', paddingBottom: '2rem', paddingTop: 'calc(3.5rem + 2rem)' }}
      >
        <Outlet />
      </main>
      <ChatPanel />
    </div>
  );
}
