import { useEffect, useLayoutEffect, useRef } from 'react'

/** Two taps closer together than this are a double-tap. */
const DOUBLE_TAP_MS = 320

/**
 * Whole-screen tap targets for people who can't see the screen: returns a click handler that calls
 * `single` for one tap and `double` for a quick double-tap (waiting briefly to tell them apart).
 */
export function useTaps(single: () => void, double: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Latest handlers, so a tap waiting on the timer runs with the current screen state.
  const handlers = useRef({ single, double })
  useLayoutEffect(() => {
    handlers.current = { single, double }
  })
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  return () => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
      handlers.current.double()
      return
    }
    timer.current = setTimeout(() => {
      timer.current = null
      handlers.current.single()
    }, DOUBLE_TAP_MS)
  }
}
