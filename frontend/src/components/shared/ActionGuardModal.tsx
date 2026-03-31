import { cn } from '@/lib/utils';
import { AlertTriangle, Info, ShieldAlert } from 'lucide-react';

interface ActionGuardModalProps {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: 'danger' | 'warning' | 'info';
}

const variantConfig = {
  danger: {
    icon: ShieldAlert,
    iconClass: 'text-risk-critical',
    confirmClass: 'bg-risk-critical hover:bg-risk-critical/80 text-white',
  },
  warning: {
    icon: AlertTriangle,
    iconClass: 'text-risk-medium',
    confirmClass: 'bg-risk-medium hover:bg-risk-medium/80 text-black',
  },
  info: {
    icon: Info,
    iconClass: 'text-accent',
    confirmClass: 'bg-accent hover:bg-accent-hover text-white',
  },
};

export function ActionGuardModal({
  isOpen,
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
  variant = 'danger',
}: ActionGuardModalProps) {
  if (!isOpen) return null;

  const config = variantConfig[variant];
  const Icon = config.icon;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onCancel}
      />
      {/* Modal */}
      <div className="relative w-full max-w-md rounded-lg border border-border bg-surface-overlay p-6 shadow-2xl">
        <div className="flex items-start gap-3">
          <Icon className={cn('h-5 w-5 mt-0.5 shrink-0', config.iconClass)} />
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
            <p className="text-sm text-text-secondary">{description}</p>
          </div>
        </div>
        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-raised transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={cn(
              'rounded px-3 py-1.5 text-xs font-medium transition-colors',
              config.confirmClass
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
