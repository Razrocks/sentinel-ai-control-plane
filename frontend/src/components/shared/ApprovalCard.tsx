import { cn } from '@/lib/utils';
import { RiskBadge } from './RiskBadge';
import { CheckCircle, XCircle } from 'lucide-react';

interface Approval {
  id: string;
  type: string;
  title: string;
  requester: string;
  impactedSystem: string;
  riskLevel: 'critical' | 'high' | 'medium' | 'low';
  reason: string;
  recommendedAction: string;
  createdAt: string;
}

interface ApprovalCardProps {
  approval: Approval;
  onApprove?: (id: string) => void;
  onDeny?: (id: string) => void;
}

export function ApprovalCard({ approval, onApprove, onDeny }: ApprovalCardProps) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wide text-text-muted font-semibold">
              {approval.type}
            </span>
            <RiskBadge level={approval.riskLevel} />
          </div>
          <h3 className="mt-1 text-sm font-semibold text-text-primary truncate">
            {approval.title}
          </h3>
        </div>
      </div>

      {/* Details */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <span className="text-text-muted">Requester</span>
          <p className="text-text-secondary">{approval.requester}</p>
        </div>
        <div>
          <span className="text-text-muted">Impacted System</span>
          <p className="text-text-secondary font-mono">{approval.impactedSystem}</p>
        </div>
      </div>

      <p className="text-sm text-text-secondary">{approval.reason}</p>

      <div className="text-xs text-text-muted">
        <span>Recommended:</span>{' '}
        <span className="text-text-secondary">{approval.recommendedAction}</span>
      </div>

      <div className="text-[10px] text-text-muted">{approval.createdAt}</div>

      {/* Actions */}
      {(onApprove || onDeny) && (
        <div className="flex items-center gap-2 pt-1 border-t border-border-subtle">
          {onApprove && (
            <button
              onClick={() => onApprove(approval.id)}
              className={cn(
                'flex items-center gap-1 rounded px-3 py-1.5 text-xs font-medium',
                'bg-status-approved/20 text-status-approved hover:bg-status-approved/30 transition-colors'
              )}
            >
              <CheckCircle className="h-3.5 w-3.5" />
              Approve
            </button>
          )}
          {onDeny && (
            <button
              onClick={() => onDeny(approval.id)}
              className={cn(
                'flex items-center gap-1 rounded px-3 py-1.5 text-xs font-medium',
                'bg-status-denied/20 text-status-denied hover:bg-status-denied/30 transition-colors'
              )}
            >
              <XCircle className="h-3.5 w-3.5" />
              Deny
            </button>
          )}
        </div>
      )}
    </div>
  );
}
