import type { Alert } from './api'

/**
 * iPhones only let a page speak after a tap. Call this from the tap that starts the walk,
 * so later alerts (which arrive with no tap) can play.
 */
export function unlockSpeech(text = 'Starting walk') {
  speechSynthesis.speak(new SpeechSynthesisUtterance(text))
}

/** Spoken alert through the earbuds. The harness buzz is sent by the server. */
export function speakAlert(alert: Alert) {
  if (!alert.speak) return
  if (alert.urgency === 'high') speechSynthesis.cancel() // urgent alerts interrupt
  const utterance = new SpeechSynthesisUtterance(alert.speak)
  utterance.rate = alert.speech_rate
  speechSynthesis.speak(utterance)
}
