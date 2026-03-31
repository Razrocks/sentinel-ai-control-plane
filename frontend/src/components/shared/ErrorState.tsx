import { AlertTriangle } from 'lucide-react'

interface ErrorStateProps {
  title?: string
  description: string
  onRetry?: () => void
}

export function ErrorState({
  title = 'Something went wrong',
  description,
  onRetry,
}: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-surface px-6 py-12 text-center">
      <div className="mb-4 rounded-full bg-surface-raised p-3">
        <AlertTriangle className="h-6 w-6 text-red-500" />
      </div>
      <h3 className="text-base font-semibold text-text-primary">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-text-secondary">{description}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          Try again
        </button>
      )}
    </div>
  )
}
