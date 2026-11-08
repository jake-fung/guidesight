import type { Alert } from '../../lib/api'

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
