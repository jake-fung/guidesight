import type { Alert, Route } from '../../lib/api'

/**
 * /walk?demo shows the prototype's sample content (camera scene, bench detection, canned answers)
 * so the flow can be presented without a server, harness or camera.
 */
export const DEMO = new URLSearchParams(window.location.search).has('demo')

const alert = (speak: string): Alert => ({ speak, urgency: 'low', haptic: null, speech_rate: 1 })

/** Canned answers for demo mode, matched on a word in the question. */
export function demoAnswer(question: string) {
  const q = question.toLowerCase()
  const speak = q.includes('read')
    ? '“Bus stop 14. Downtown, via Main Street.” Next bus in 6 minutes.'
    : q.includes('else')
      ? 'There’s a crosswalk about 10 metres ahead, and a pole on your left.'
      : q.includes('describe') || q.includes('around')
        ? 'You’re on a wide sidewalk. A bench is about 4 metres ahead on your right, and the path is clear.'
        : 'Yes — a bench is about 4 metres ahead, slightly to your right.'
  return new Promise<{ transcript: string; alert: Alert }>((r) =>
    setTimeout(() => r({ transcript: question || 'Is there a bench nearby?', alert: alert(speak) }), 700))
}

/** Demo mode's destination: the bench from the prototype, 180 m away (no server or GPS). */
export function demoRoute(query: string): Route {
  const start = { lat: 43.6532, lng: -79.3832 }
  const corner = { lat: 43.6541, lng: -79.3832 }
  const bench = { lat: 43.6541, lng: -79.3821 }
  return {
    destination: { name: /bench/i.test(query) || !query ? 'the bench' : query, address: 'Queen Street West, Toronto', location: bench },
    distance_m: 180,
    duration_s: 140,
    steps: [
      { instruction: 'Head north on Bay St toward Queen St W', maneuver: 'DEPART', distance_m: 100, duration_s: 80,
        start, end: corner, points: [[start.lat, start.lng], [corner.lat, corner.lng]] },
      { instruction: 'Turn right onto Queen St W. Destination will be on the right', maneuver: 'TURN_RIGHT', distance_m: 80,
        duration_s: 60, start: corner, end: bench, points: [[corner.lat, corner.lng], [bench.lat, bench.lng]] },
    ],
  }
}
