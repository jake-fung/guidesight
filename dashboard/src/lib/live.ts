/**
 * Live link to the server (server/app/live.py): harness online/offline status and the
 * harness's obstacle/stop/pull events, pushed as they happen. Reconnects on its own.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, socketUrl, type HarnessEvent } from './api'
import { getIdToken } from './auth'

const PING_MS = 25_000 // keeps tunnels and proxies from closing an idle socket
const MAX_RETRY_MS = 10_000

type Message =
  | { type: 'harness_status'; harness_id: string | null; online: boolean }
  | { type: 'harness_event'; event: HarnessEvent }

export type LiveLink = {
  /** null until the server has answered. */
  harnessOnline: boolean | null
  /** Re-reads harness status, e.g. right after the harness id changes. */
  refresh: () => Promise<void>
  /** Sets the handler for harness events (null to clear). Stable across renders. */
  setEventHandler: (handler: ((e: HarnessEvent) => void) | null) => void
}

export function useLiveLink(): LiveLink {
  const [harnessOnline, setHarnessOnline] = useState<boolean | null>(null)
  const onEvent = useRef<((e: HarnessEvent) => void) | null>(null)

  useEffect(() => {
    let ws: WebSocket | null = null
    let stopped = false
    let attempt = 0
    let retryTimer: ReturnType<typeof setTimeout> | undefined

    async function connect() {
      const token = await getIdToken().catch(() => '')
      if (stopped) return
      ws = new WebSocket(socketUrl('/live'))
      ws.onopen = () => {
        attempt = 0
        ws?.send(JSON.stringify({ type: 'auth', token }))
      }
      ws.onmessage = (m) => {
        try {
          const msg = JSON.parse(m.data) as Message
          if (msg.type === 'harness_status') setHarnessOnline(msg.online)
          else if (msg.type === 'harness_event') onEvent.current?.(msg.event)
        } catch {
          // ignore malformed messages
        }
      }
      ws.onclose = () => {
        if (stopped) return
        retryTimer = setTimeout(connect, Math.min(1000 * 2 ** attempt++, MAX_RETRY_MS))
      }
    }

    connect()
    const ping = setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send('ping'), PING_MS)
    return () => {
      stopped = true
      clearTimeout(retryTimer)
      clearInterval(ping)
      ws?.close()
    }
  }, [])

  const refresh = useCallback(async () => {
    setHarnessOnline((await api.harnessStatus()).online)
  }, [])
  const setEventHandler = useCallback((handler: ((e: HarnessEvent) => void) | null) => {
    onEvent.current = handler
  }, [])

  return { harnessOnline, refresh, setEventHandler }
}
