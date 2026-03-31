'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { ChevronDown } from 'lucide-react';

interface AuditEvent {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  objectType: string;
  objectId: string;
  objectTitle: string;
  policyRule: string | null;
  result: string;
  details: string;
}

interface AuditEventRowProps {
  event: AuditEvent;
}

const resultStyles: Record<string, string> = {
  allowed: 'bg-status-approved/20 text-status-approved',
  denied: 'bg-status-denied/20 text-status-denied',
  escalated: 'bg-status-escalated/20 text-status-escalated',
  success: 'bg-status-approved/20 text-status-approved',
  failed: 'bg-status-denied/20 text-status-denied',
  error: 'bg-status-denied/20 text-status-denied',
  pending: 'bg-status-pending/20 text-status-pending',
};

function getResultStyle(result: string): string {
  return resultStyles[result.toLowerCase()] ?? 'bg-border/20 text-text-muted';
}

export function AuditEventRow({ event }: AuditEventRowProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-b border-border-subtle">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-raised/50 transition-colors"
      >
        <time className="w-36 shrink-0 text-xs font-mono text-text-muted">
          {event.timestamp}
        </time>
        <span className="w-28 shrink-0 text-xs text-text-secondary truncate">
          {event.actor}
        </span>
        <span className="w-32 shrink-0 text-xs font-medium text-text-primary">
          {event.action}
        </span>
        <span className="min-w-0 flex-1 text-xs text-text-secondary truncate">
          <span className="text-text-muted">{event.objectType}/</span>
          {event.objectTitle}
        </span>
        {event.policyRule && (
          <span className="shrink-0 rounded bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
            {event.policyRule}
          </span>
        )}
        <span
          className={cn(
            'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase',
            getResultStyle(event.result)
          )}
        >
          {event.result}
        </span>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-text-muted transition-transform',
            expanded && 'rotate-180'
          )}
        />
      </button>
      {expanded && (
        <div className="px-3 pb-3 pl-[calc(0.75rem+9rem)]">
          <p className="text-xs text-text-muted whitespace-pre-wrap">
            {event.details}
          </p>
        </div>
      )}
    </div>
  );
}
