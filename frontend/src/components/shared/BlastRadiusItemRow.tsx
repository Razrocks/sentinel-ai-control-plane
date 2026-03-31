'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { ChevronDown, Server, Database, Globe, Shield, Box } from 'lucide-react';
import { RiskBadge } from './RiskBadge';
import { ConfidenceBadge } from './ConfidenceBadge';
import { OwnerChip } from './OwnerChip';

interface BlastRadiusItem {
  id: string;
  name: string;
  type: string;
  reason: string;
  confidence: 'high' | 'medium' | 'low';
  criticality: 'critical' | 'high' | 'medium' | 'low';
  ownerTeam: string;
  details: string;
}

interface BlastRadiusItemRowProps {
  item: BlastRadiusItem;
}

const typeIcons: Record<string, typeof Server> = {
  service: Server,
  database: Database,
  api: Globe,
  policy: Shield,
};

export function BlastRadiusItemRow({ item }: BlastRadiusItemRowProps) {
  const [expanded, setExpanded] = useState(false);
  const Icon = typeIcons[item.type.toLowerCase()] ?? Box;

  return (
    <div className="border-b border-border-subtle">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-raised/50 transition-colors"
      >
        <Icon className="h-4 w-4 shrink-0 text-text-muted" />
        <div className="min-w-0 flex-1">
          <span className="text-sm font-medium text-text-primary">{item.name}</span>
          <span className="ml-2 text-xs text-text-muted">{item.reason}</span>
        </div>
        <ConfidenceBadge level={item.confidence} />
        <RiskBadge level={item.criticality} />
        <OwnerChip name={item.ownerTeam} />
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-text-muted transition-transform',
            expanded && 'rotate-180'
          )}
        />
      </button>
      {expanded && (
        <div className="px-3 pb-3 pl-10">
          <p className="text-xs text-text-muted whitespace-pre-wrap">
            {item.details}
          </p>
        </div>
      )}
    </div>
  );
}
