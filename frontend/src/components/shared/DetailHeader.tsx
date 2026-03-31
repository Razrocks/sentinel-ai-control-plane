import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

interface DetailHeaderProps {
  backTo: string;
  id: string;
  title: string;
  subtitle?: string;
  badges: ReactNode;
}

export function DetailHeader({ backTo, id, title, subtitle, badges }: DetailHeaderProps) {
  return (
    <div className="flex items-start gap-4">
      <Link to={backTo} className="mt-1 p-1 rounded hover:bg-surface-raised transition-colors">
        <ArrowLeft className="w-5 h-5 text-text-muted" />
      </Link>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3 mb-1">
          <span className="text-sm text-text-muted font-mono">{id}</span>
          {badges}
        </div>
        <h1 className="text-xl font-semibold text-text-primary">{title}</h1>
        {subtitle && <p className="text-sm text-text-secondary mt-1">{subtitle}</p>}
      </div>
    </div>
  );
}
