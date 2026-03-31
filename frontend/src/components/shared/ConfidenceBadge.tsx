import { cn } from '@/lib/utils';

interface ConfidenceBadgeProps {
  level: 'high' | 'medium' | 'low';
}

const dotStyles: Record<ConfidenceBadgeProps['level'], string> = {
  high: 'bg-risk-low',
  medium: 'bg-risk-medium',
  low: 'bg-risk-critical',
};

export function ConfidenceBadge({ level }: ConfidenceBadgeProps) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-text-secondary">
      <span className={cn('h-1.5 w-1.5 rounded-full', dotStyles[level])} />
      <span className="capitalize">{level}</span>
    </span>
  );
}
