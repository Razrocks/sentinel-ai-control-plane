import { Loader2 } from 'lucide-react'

interface LoadingStateProps {
  text?: string
}

export function LoadingState({ text = 'Loading...' }: LoadingStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-surface px-6 py-12 text-center">
      <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
      <p className="mt-3 text-sm text-text-secondary">{text}</p>
    </div>
  )
}
