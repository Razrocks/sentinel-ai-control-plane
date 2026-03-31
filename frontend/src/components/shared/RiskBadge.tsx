import { cn } from '@/lib/utils';

interface RiskBadgeProps {
  level: 'critical' | 'high' | 'medium' | 'low';
  size?: 'sm' | 'md';
}

const levelStyles: Record<RiskBadgeProps['level'], string> = {
  critical: 'bg-risk-critical/20 text-risk-critical border-risk-critical/30',
  high: 'bg-risk-high/20 text-risk-high border-risk-high/30',
  medium: 'bg-risk-medium/20 text-risk-medium border-risk-medium/30',
  low: 'bg-risk-low/20 text-risk-low border-risk-low/30',
};

export function RiskBadge({ level, size = 'sm' }: RiskBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border font-semibold uppercase tracking-wide',
        size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs',
        levelStyles[level]
      )}
    >
      {level}
    </span>
  );
}
