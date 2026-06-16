/**
 * Top-level React error boundary.
 *
 * Catches uncaught render-cycle exceptions in any descendant component and
 * replaces the broken subtree with a recovery surface instead of letting
 * the whole app go blank. The boundary itself stays mounted, so the user
 * can hit "Reset" to drop the error state without a full page reload.
 *
 * In dev the stack is dumped to console for fast triage; in prod we'd
 * forward to Sentry here (Phase 5 — wire `Sentry.captureException` when
 * the Sentinel-monitors-itself integration is alive).
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { captureException } from '@/lib/self-monitor'

interface Props {
  children: ReactNode
  /** Optional override for the fallback surface; defaults to a simple card. */
  fallback?: (err: Error, reset: () => void) => ReactNode
}

interface State {
  err: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { err: null }

  static getDerivedStateFromError(err: Error): State {
    return { err }
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] uncaught render error', err, info)
    // Phase 5.5: forward to self-monitor (Sentry). No-op when VITE_SENTRY_DSN
    // isn't set so dev still works zero-config.
    captureException(err, { componentStack: info.componentStack })
  }

  reset = () => this.setState({ err: null })

  render() {
    if (!this.state.err) return this.props.children
    if (this.props.fallback) return this.props.fallback(this.state.err, this.reset)

    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="w-full max-w-md rounded-xl border border-destructive/30 bg-card text-card-foreground shadow-lg overflow-hidden">
          <div className="px-6 py-5 border-b border-destructive/20 flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-destructive/15 text-destructive">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="flex flex-col gap-0.5 min-w-0">
              <h1 className="text-base font-semibold text-foreground">
                Something broke in the page
              </h1>
              <p className="text-xs text-muted-foreground">
                Sentinel caught the error before it took the whole app down.
              </p>
            </div>
          </div>
          <div className="px-6 py-4 flex flex-col gap-3">
            <pre className="rounded-md bg-muted px-3 py-2 text-xs font-mono text-foreground/80 max-h-32 overflow-y-auto whitespace-pre-wrap">
              {this.state.err.message || 'Unknown error'}
            </pre>
            <p className="text-sm text-muted-foreground">
              Reset to try to recover, or reload the page. Other actions you've
              taken (notes, decisions) were saved server-side and aren't lost.
            </p>
          </div>
          <div className="px-6 py-4 border-t border-border flex items-center justify-end gap-2">
            <Button variant="outline" onClick={() => window.location.reload()}>
              Reload page
            </Button>
            <Button onClick={this.reset}>
              <RotateCcw />
              Reset
            </Button>
          </div>
        </div>
      </div>
    )
  }
}
