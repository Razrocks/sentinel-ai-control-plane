import { User } from 'lucide-react';

interface OwnerChipProps {
  name: string;
}

export function OwnerChip({ name }: OwnerChipProps) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-surface-raised px-1.5 py-0.5 text-xs text-text-secondary border border-border-subtle">
      <User className="h-3 w-3 text-text-muted" />
      <span>{name}</span>
    </span>
  );
}
