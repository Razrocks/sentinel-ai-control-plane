/**
 * Badge — small status tag. Bigger than the legacy 10px badges so the
 * risk level / status is readable at a glance.
 */
import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground hover:bg-primary/80',
        secondary: 'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
        destructive: 'border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80',
        outline: 'text-foreground border-border',
        success: 'border-transparent bg-status-approved/15 text-status-approved',
        warning: 'border-transparent bg-status-pending/15 text-status-pending',
        danger: 'border-transparent bg-status-denied/15 text-status-denied',
        risk_critical: 'border-transparent bg-risk-critical/15 text-risk-critical',
        risk_high: 'border-transparent bg-risk-high/15 text-risk-high',
        risk_medium: 'border-transparent bg-risk-medium/15 text-risk-medium',
        risk_low: 'border-transparent bg-risk-low/15 text-risk-low',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}
