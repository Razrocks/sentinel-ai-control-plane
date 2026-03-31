import { cn } from '@/lib/utils';

interface TimelineEvent {
  id: string;
  timestamp: string;
  action: string;
  actor: string;
  result: string;
}

interface StatusTimelineProps {
  events: TimelineEvent[];
}

const resultColors: Record<string, string> = {
  approved: 'bg-status-approved',
  success: 'bg-status-approved',
  denied: 'bg-status-denied',
  failed: 'bg-status-denied',
  error: 'bg-status-denied',
  pending: 'bg-status-pending',
  escalated: 'bg-status-escalated',
  blocked: 'bg-status-blocked',
};

function getResultDotColor(result: string): string {
  return resultColors[result.toLowerCase()] ?? 'bg-text-muted';
}

function getResultTextColor(result: string): string {
  const map: Record<string, string> = {
    approved: 'text-status-approved',
    success: 'text-status-approved',
    denied: 'text-status-denied',
    failed: 'text-status-denied',
    error: 'text-status-denied',
    pending: 'text-status-pending',
    escalated: 'text-status-escalated',
    blocked: 'text-status-blocked',
  };
  return map[result.toLowerCase()] ?? 'text-text-muted';
}

export function StatusTimeline({ events }: StatusTimelineProps) {
  return (
    <div className="space-y-0">
      {events.map((event, index) => (
        <div key={event.id} className="relative flex gap-3 pb-4 last:pb-0">
          {/* Vertical line */}
          {index < events.length - 1 && (
            <div className="absolute left-[5px] top-3 h-full w-px bg-border" />
          )}
          {/* Dot */}
          <div
            className={cn(
              'relative mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full border-2 border-surface',
              getResultDotColor(event.result)
            )}
          />
          {/* Content */}
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-medium text-text-primary">
                {event.action}
              </span>
              <span className={cn('text-xs font-medium', getResultTextColor(event.result))}>
                {event.result}
              </span>
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-text-muted">
              <span>{event.actor}</span>
              <span>&middot;</span>
              <time>{event.timestamp}</time>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
