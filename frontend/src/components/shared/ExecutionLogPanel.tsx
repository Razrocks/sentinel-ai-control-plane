import { cn } from '@/lib/utils';
import { FileText } from 'lucide-react';

interface ExecutionEntry {
  id: string;
  timestamp: string;
  mode: string;
  action: string;
  result: string;
  artifacts: string[];
}

interface ExecutionLogPanelProps {
  entries: ExecutionEntry[];
}

const modeStyles: Record<string, string> = {
  live: 'bg-status-approved/20 text-status-approved',
  dry_run: 'bg-status-simulated/20 text-status-simulated',
  simulation: 'bg-status-simulated/20 text-status-simulated',
  rollback: 'bg-status-escalated/20 text-status-escalated',
};

const resultStyles: Record<string, string> = {
  success: 'text-status-approved',
  failed: 'text-status-denied',
  error: 'text-status-denied',
  pending: 'text-status-pending',
  skipped: 'text-text-muted',
};

function getModeStyle(mode: string): string {
  return modeStyles[mode.toLowerCase()] ?? 'bg-border/20 text-text-muted';
}

function getResultStyle(result: string): string {
  return resultStyles[result.toLowerCase()] ?? 'text-text-muted';
}

export function ExecutionLogPanel({ entries }: ExecutionLogPanelProps) {
  return (
    <div className="space-y-1">
      {entries.map((entry) => (
        <div
          key={entry.id}
          className="flex items-start gap-3 rounded px-3 py-2 hover:bg-surface-raised/50 transition-colors"
        >
          <time className="w-36 shrink-0 pt-0.5 text-xs font-mono text-text-muted">
            {entry.timestamp}
          </time>
          <span
            className={cn(
              'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase',
              getModeStyle(entry.mode)
            )}
          >
            {entry.mode}
          </span>
          <span className="min-w-0 flex-1 text-sm text-text-primary">
            {entry.action}
          </span>
          <span className={cn('shrink-0 text-xs font-medium', getResultStyle(entry.result))}>
            {entry.result}
          </span>
          {entry.artifacts.length > 0 && (
            <div className="flex shrink-0 items-center gap-1">
              {entry.artifacts.map((artifact, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-0.5 text-xs text-accent hover:text-accent-hover cursor-pointer"
                >
                  <FileText className="h-3 w-3" />
                  <span className="underline">{artifact}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
