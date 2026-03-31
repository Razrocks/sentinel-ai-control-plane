import { cn } from '@/lib/utils';
import { CheckCircle, Clock, AlertTriangle } from 'lucide-react';

interface Recommendation {
  id: string;
  title: string;
  reason: string;
  evidence: string;
  classification: 'required_now' | 'recommended' | 'optional_optimization' | 'out_of_scope';
  expectedBenefit: string;
  requiredApprovals: string[];
  executableNow: boolean;
  draftOnly: boolean;
}

interface RecommendationCardProps {
  recommendation: Recommendation;
}

const classificationStyles: Record<Recommendation['classification'], { label: string; className: string }> = {
  required_now: {
    label: 'Required Now',
    className: 'bg-risk-critical/20 text-risk-critical border-risk-critical/30',
  },
  recommended: {
    label: 'Recommended',
    className: 'bg-risk-medium/20 text-risk-medium border-risk-medium/30',
  },
  optional_optimization: {
    label: 'Optional',
    className: 'bg-status-draft/20 text-status-draft border-status-draft/30',
  },
  out_of_scope: {
    label: 'Out of Scope',
    className: 'bg-border/20 text-text-muted border-border/30',
  },
};

export function RecommendationCard({ recommendation }: RecommendationCardProps) {
  const cls = classificationStyles[recommendation.classification];

  return (
    <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-text-primary">
          {recommendation.title}
        </h3>
        <span
          className={cn(
            'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
            cls.className
          )}
        >
          {cls.label}
        </span>
      </div>

      {/* Reason */}
      <p className="text-sm text-text-secondary">{recommendation.reason}</p>

      {/* Evidence */}
      <div className="rounded bg-surface-raised px-3 py-2 text-xs text-text-muted font-mono">
        {recommendation.evidence}
      </div>

      {/* Benefit */}
      <div className="text-xs text-text-secondary">
        <span className="text-text-muted">Expected benefit:</span>{' '}
        {recommendation.expectedBenefit}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-3 pt-1 text-xs">
        {recommendation.executableNow ? (
          <span className="flex items-center gap-1 text-status-approved">
            <CheckCircle className="h-3 w-3" />
            Executable now
          </span>
        ) : (
          <span className="flex items-center gap-1 text-text-muted">
            <Clock className="h-3 w-3" />
            Not executable
          </span>
        )}

        {recommendation.draftOnly && (
          <span className="flex items-center gap-1 text-status-draft">
            <AlertTriangle className="h-3 w-3" />
            Draft only
          </span>
        )}

        {recommendation.requiredApprovals.length > 0 && (
          <span className="text-text-muted">
            Approvals: {recommendation.requiredApprovals.join(', ')}
          </span>
        )}
      </div>
    </div>
  );
}
