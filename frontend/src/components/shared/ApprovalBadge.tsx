import { cn } from '@/lib/utils';

interface ApprovalBadgeProps {
  state: 'approved' | 'pending' | 'denied' | 'not_required';
}

const stateStyles: Record<ApprovalBadgeProps['state'], string> = {
  approved: 'bg-status-approved/20 text-status-approved border-status-approved/30',
  pending: 'bg-status-pending/20 text-status-pending border-status-pending/30',
  denied: 'bg-status-denied/20 text-status-denied border-status-denied/30',
  not_required: 'bg-border/20 text-text-muted border-border/30',
};

const stateLabels: Record<ApprovalBadgeProps['state'], string> = {
  approved: 'Approved',
  pending: 'Pending',
  denied: 'Denied',
  not_required: 'Not Required',
};

export function ApprovalBadge({ state }: ApprovalBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        stateStyles[state]
      )}
    >
      {stateLabels[state]}
    </span>
  );
}
