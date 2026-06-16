/**
 * Shared empty-state surface.
 *
 * Two scopes baked in:
 * - `unfiltered` — the data source itself is empty (no rows in the DB).
 *   Shows a "nothing here yet" tone + optional CTA so users know they
 *   landed on a healthy page, not a broken one.
 * - `filtered` — rows exist but the current filter/search hides them all.
 *   Surfaces a "no matches" tone + optional reset hint.
 *
 * Both render in a centered card with an icon, headline, body, and action
 * slot. Replaces the bare "No results found." text scattered across pages.
 */
import { Inbox, SearchX } from 'lucide-react'
import type { ReactNode } from 'react'

type Variant = 'unfiltered' | 'filtered'

export function EmptyState({
  variant = 'unfiltered',
  title,
  description,
  icon,
  action,
  className,
}: {
  variant?: Variant
  title: string
  description?: string
  /** Override the default icon (Inbox / SearchX). */
  icon?: ReactNode
  /** Optional CTA — eg "Clear filters", "Create the first one". */
  action?: ReactNode
  className?: string
}) {
  const DefaultIcon = variant === 'filtered' ? SearchX : Inbox
  return (
    <div
      className={
        'flex flex-col items-center justify-center text-center px-6 py-16 gap-3 ' +
        (className ?? '')
      }
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        {icon ?? <DefaultIcon className="h-6 w-6" />}
      </div>
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {description && (
        <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
          {description}
        </p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
