import { cn } from '@/lib/utils';

interface PolicyBadgeProps {
  decision: 'allow' | 'deny' | 'escalate' | 'simulate_only';
}

const decisionStyles: Record<PolicyBadgeProps['decision'], string> = {
  allow: 'bg-status-approved/20 text-status-approved border-status-approved/30',
  deny: 'bg-status-denied/20 text-status-denied border-status-denied/30',
  escalate: 'bg-status-escalated/20 text-status-escalated border-status-escalated/30',
  simulate_only: 'bg-status-simulated/20 text-status-simulated border-status-simulated/30',
};

const decisionLabels: Record<PolicyBadgeProps['decision'], string> = {
  allow: 'Allow',
  deny: 'Deny',
  escalate: 'Escalate',
  simulate_only: 'Simulate Only',
};

export function PolicyBadge({ decision }: PolicyBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        decisionStyles[decision]
      )}
    >
      {decisionLabels[decision]}
    </span>
  );
}
