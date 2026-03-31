interface SystemChipProps {
  name: string;
  type?: string;
}

export function SystemChip({ name, type }: SystemChipProps) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-surface-raised px-1.5 py-0.5 font-mono text-xs text-text-secondary border border-border-subtle">
      {type && (
        <span className="text-text-muted text-[10px] uppercase">{type}</span>
      )}
      <span>{name}</span>
    </span>
  );
}
