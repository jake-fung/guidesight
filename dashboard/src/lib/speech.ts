/**
 * Spoken alerts through the earbuds, in the ElevenLabs voice (server /api/tts).
 * Falls back to the phone's built-in voice if the server has no ElevenLabs key or a clip fails,
 * so an alert is never dropped. The harness buzz is sent by the server.
 */
import { api, ApiError, type Alert } from './api'

// ElevenLabs voices only go from 0.7x to 1.2x. Rates outside that are reached by playing the clip
// faster or slower (pitch is kept).
const VOICE_SPEED = { min: 0.7, max: 1.2 }
// A tiny silent WAV, played inside a tap to unlock audio playback on iPhones.
const SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='

let player: HTMLAudioElement | null = null
let elevenLabsOff = false // set after a 503, so we stop asking for the rest of the session
let queue: Promise<void> = Promise.resolve()
let aborter = new AbortController() // aborted by stopSpeech(): cancels queued and in-flight clips
let finishCurrent: (() => void) | null = null

function audio() {
  player ??= new Audio()
  return player
}

/**
 * iPhones only let a page play sound after a tap. Call this from the tap that starts the walk,
 * so later alerts (which arrive with no tap) can play.
 */
export function unlockSpeech(text = 'Starting walk') {
  const el = audio()
  el.src = SILENCE
  el.play().catch(() => {})
  speechSynthesis.speak(new SpeechSynthesisUtterance('')) // unlock the fallback voice too
  speak(text, 1)
}

/** Spoken alert. Urgent alerts cut off whatever is playing and skip the queue. */
export function speakAlert(alert: Alert) {
  if (!alert.speak) return
  if (alert.urgency === 'high') stopSpeech()
  speak(alert.speak, alert.speech_rate)
}

/** Stop talking now and drop anything queued (e.g. before recording a question). */
export function stopSpeech() {
  aborter.abort()
  aborter = new AbortController()
  finishCurrent?.()
  speechSynthesis.cancel()
}

function speak(text: string, rate: number) {
  const { signal } = aborter
  const voiceSpeed = Math.min(Math.max(rate, VOICE_SPEED.min), VOICE_SPEED.max)
  // Start fetching right away, so the clip downloads while earlier alerts are still playing.
  const clip = fetchClip(text, voiceSpeed, signal)
  queue = queue
    .then(async () => {
      const blob = await clip
      if (signal.aborted) return
      const played = blob && (await playClip(blob, rate / voiceSpeed))
      if (!played && !signal.aborted) await speakWithPhoneVoice(text, rate)
    })
    .catch((e) => console.warn('speech failed', e))
}

async function fetchClip(text: string, speed: number, signal: AbortSignal): Promise<Blob | null> {
  if (elevenLabsOff) return null
  try {
    return await api.speech(text, speed, signal)
  } catch (e) {
    if (e instanceof ApiError && e.status === 503) elevenLabsOff = true
    else if (!signal.aborted) console.warn('ElevenLabs voice failed, using the phone voice', e)
    return null
  }
}

/** Resolves true when the clip finishes (or is stopped), false if it couldn't play. */
function playClip(blob: Blob, playbackRate: number): Promise<boolean> {
  return new Promise((resolve) => {
    const el = audio()
    const url = URL.createObjectURL(blob)
    const done = (played: boolean) => {
      el.onended = el.onerror = null
      finishCurrent = null
      URL.revokeObjectURL(url)
      resolve(played)
    }
    finishCurrent = () => {
      el.pause()
      done(true)
    }
    el.onended = () => done(true)
    el.onerror = () => done(false)
    el.src = url
    el.defaultPlaybackRate = el.playbackRate = playbackRate
    el.play().catch(() => done(false))
  })
}

function speakWithPhoneVoice(text: string, rate: number): Promise<void> {
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = rate
    utterance.onend = utterance.onerror = () => {
      finishCurrent = null
      resolve()
    }
    finishCurrent = resolve // speechSynthesis.cancel() doesn't always fire onend
    speechSynthesis.speak(utterance)
  })
}
