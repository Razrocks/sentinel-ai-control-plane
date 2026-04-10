import { useEffect, useRef, useState, useCallback } from 'react'
import type { AuditEvent } from '@/types'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api'
const SSE_URL = `${API_BASE}/audit-events/stream`

export interface AuditStreamState {
  /** New events received via SSE (newest first). Capped to last 200. */
  liveEvents: AuditEvent[]
  /** Whether the SSE connection is currently open */
  connected: boolean
  /** Total count of events received in this session */
  receivedCount: number
}

/**
 * Hook that subscribes to the SSE audit stream.
 *
 * Returns live events that arrive after the component mounts.
 * The component should merge these with the initial page load from useAuditEvents().
 *
 * Automatically reconnects on disconnect with exponential back-off.
 */
export function useAuditStream(enabled = true): AuditStreamState {
  const [liveEvents, setLiveEvents] = useState<AuditEvent[]>([])
  const [connected, setConnected] = useState(false)
  const [receivedCount, setReceivedCount] = useState(0)
  const eventSourceRef = useRef<EventSource | null>(null)
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryCountRef = useRef(0)

  const connect = useCallback(() => {
    if (!enabled) return

    const es = new EventSource(SSE_URL)
    eventSourceRef.current = es

    es.addEventListener('connected', () => {
      setConnected(true)
      retryCountRef.current = 0 // Reset backoff on successful connect
    })

    es.addEventListener('audit', (event) => {
      try {
        const data = JSON.parse(event.data) as AuditEvent
        setLiveEvents(prev => {
          // Deduplicate by id
          if (prev.some(e => e.id === data.id)) return prev
          // Prepend newest, cap at 200
          const next = [data, ...prev]
          return next.length > 200 ? next.slice(0, 200) : next
        })
        setReceivedCount(prev => prev + 1)
      } catch {
        // Ignore parse errors
      }
    })

    es.onerror = () => {
      setConnected(false)
      es.close()
      eventSourceRef.current = null

      // Exponential back-off: 1s, 2s, 4s, 8s, max 30s
      const delay = Math.min(1000 * Math.pow(2, retryCountRef.current), 30_000)
      retryCountRef.current++
      retryTimeoutRef.current = setTimeout(connect, delay)
    }
  }, [enabled])

  useEffect(() => {
    connect()

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current)
        retryTimeoutRef.current = null
      }
      setConnected(false)
    }
  }, [connect])

  return { liveEvents, connected, receivedCount }
}
