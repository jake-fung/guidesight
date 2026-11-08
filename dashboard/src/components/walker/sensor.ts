// Finds and pairs a switched-on GuideSight sensor without typing its ID.
import { useEffect } from 'react'
import { api } from '../../lib/api'
import { useApp } from './state'

/**
 * While `active`, looks for a switched-on sensor that nobody has paired yet (GET /api/setup/sensor)
 * and pairs it on its own when there's exactly one candidate, or exactly one on the phone's network.
 * The server buzzes the sensor on pairing, and link.harnessOnline flips to true.
 */
export function useSensorAutoPair(active: boolean) {
  const { refresh } = useApp().link
  useEffect(() => {
    if (!active) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    async function poll() {
      try {
        const search = await api.findSensor()
        if (stopped) return
        if (search.online) return void (await refresh())
        const local = search.nearby.filter((h) => h.same_network)
        const pick = local.length === 1 ? local[0] : search.nearby.length === 1 ? search.nearby[0] : null
        if (pick) {
          await api.pairSensor(pick.id)
          if (!stopped) await refresh()
          return
        }
      } catch {
        // server unreachable or the sensor was just taken: keep looking
      }
      if (!stopped) timer = setTimeout(poll, 2000)
    }
    poll()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [active, refresh])
}
