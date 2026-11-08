/**
 * Sighty's voice: text-to-speech with caption tracking, and speech recognition for voice commands.
 *
 * Spec (Figma "Spec — Text-to-speech on Welcome"):
 *  1. Phones block audio until the first tap, so A0 makes the whole screen one button (unlock()).
 *  2. Screens auto-read title → description → main button.
 *  3. Touching the screen pauses; Replay repeats; Slower drops the rate.
 *  4. Captions = speech: the banner shows exactly what is said, words light up as they're spoken.
 *  5. Then it listens for a few seconds for spoken commands.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

export type SpeechState = {
  text: string
  /** Characters already spoken (for the caption highlight). */
  spokenTo: number
  status: 'idle' | 'speaking' | 'paused'
}

let state: SpeechState = { text: '', spokenTo: 0, status: 'idle' }
const listeners = new Set<() => void>()
const set = (patch: Partial<SpeechState>) => {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

let baseRate = 1
let slower = false
let voiceName: string | null = null
let unlocked = false
let enabled = true
let current: SpeechSynthesisUtterance | null = null

const synth = () => (typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null)

export const voice = {
  subscribe(l: () => void) {
    listeners.add(l)
    return () => listeners.delete(l)
  },
  get: () => state,

  /** Must run inside a tap (iOS Safari only lets a page speak after a user gesture). */
  unlock() {
    unlocked = true
    const s = synth()
    if (!s) return
    const u = new SpeechSynthesisUtterance(' ')
    u.volume = 0
    s.speak(u)
  },
  get unlocked() {
    return unlocked
  },

  configure(opts: { rate?: number; voice?: string | null; enabled?: boolean }) {
    if (opts.rate !== undefined) baseRate = opts.rate
    if (opts.voice !== undefined) voiceName = opts.voice
    if (opts.enabled !== undefined) {
      enabled = opts.enabled
      if (!enabled) voice.stop()
    }
  },

  /** Speaks text, interrupting anything already being said. Resolves when it finishes or is cut off. */
  say(text: string, opts: { force?: boolean } = {}): Promise<void> {
    const s = synth()
    if (!s || !text || (!enabled && !opts.force) || !unlocked) {
      // Not speaking: show the whole caption as already read.
      set({ text, spokenTo: text.length, status: 'idle' })
      return Promise.resolve()
    }
    set({ text, spokenTo: 0, status: 'idle' })
    s.cancel()
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text)
      u.rate = baseRate * (slower ? 0.8 : 1)
      const v = voiceName && s.getVoices().find((x) => x.name === voiceName)
      if (v) u.voice = v
      u.onstart = () => set({ status: 'speaking' })
      u.onboundary = (e) => {
        if (current !== u) return
        const end = text.indexOf(' ', e.charIndex + 1)
        set({ spokenTo: end === -1 ? text.length : end })
      }
      const done = () => {
        if (current === u) {
          current = null
          set({ status: 'idle', spokenTo: text.length })
        }
        resolve()
      }
      u.onend = done
      u.onerror = done
      current = u
      s.speak(u)
    })
  },

  pause() {
    synth()?.pause()
    set({ status: 'paused' })
  },
  resume() {
    synth()?.resume()
    set({ status: state.text && current ? 'speaking' : 'idle' })
  },
  replay() {
    return voice.say(state.text, { force: true })
  },
  slower() {
    slower = !slower
    return voice.replay()
  },
  get isSlower() {
    return slower
  },
  stop() {
    current = null
    synth()?.cancel()
    set({ status: 'idle', spokenTo: state.text.length })
  },
}

export function useSpeech() {
  return useSyncExternalStore(voice.subscribe, voice.get, voice.get)
}

/** Reads `text` aloud when the screen opens (and when `text` changes). */
export function useAutoRead(text: string, active = true) {
  useEffect(() => {
    if (!active) return
    voice.say(text)
    return () => voice.stop()
  }, [text, active])
}

/** Short buzz on phones that support it (Android; iOS Safari ignores it). */
export function buzz(pattern: number | number[] = 60) {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    // not supported
  }
}

// ---- Speech recognition -----------------------------------------------------------------------

type Recognition = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}
type RecognitionCtor = new () => Recognition

const Recognition: RecognitionCtor | undefined =
  typeof window === 'undefined'
    ? undefined
    : ((window as unknown as { SpeechRecognition?: RecognitionCtor }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: RecognitionCtor }).webkitSpeechRecognition)

export const canListen = !!Recognition

export type Heard = { final: string; interim: string }

/**
 * Listens while `active` (and while Sighty isn't talking, so it doesn't hear itself).
 * onFinal fires with each finished phrase.
 */
export function useListen(active: boolean, onFinal: (text: string) => void, opts: { continuous?: boolean } = {}) {
  const speech = useSpeech()
  const [heard, setHeard] = useState<Heard>({ final: '', interim: '' })
  const [listening, setListening] = useState(false)
  const cb = useRef(onFinal)
  useEffect(() => {
    cb.current = onFinal
  })
  const talking = speech.status === 'speaking'
  const continuous = opts.continuous ?? false

  useEffect(() => {
    if (!active || talking || !Recognition) return
    let stopped = false
    let rec: Recognition | null = null
    let restart: ReturnType<typeof setTimeout> | undefined

    const begin = () => {
      if (stopped) return
      rec = new Recognition()
      rec.lang = navigator.language || 'en-CA'
      rec.continuous = continuous
      rec.interimResults = true
      rec.onresult = (e) => {
        let interim = ''
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i]
          const t = r[0].transcript
          if (r.isFinal) {
            setHeard({ final: t.trim(), interim: '' })
            cb.current(t.trim())
          } else interim += t
        }
        if (interim) setHeard((h) => ({ ...h, interim }))
      }
      rec.onerror = () => {}
      rec.onend = () => {
        setListening(false)
        // Browsers end a session after a pause; keep listening until the screen is done.
        if (!stopped) restart = setTimeout(begin, 300)
      }
      try {
        rec.start()
        setListening(true)
      } catch {
        // already started
      }
    }
    begin()
    return () => {
      stopped = true
      clearTimeout(restart)
      rec?.abort()
      setListening(false)
    }
  }, [active, talking, continuous])

  return { heard, listening, reset: () => setHeard({ final: '', interim: '' }) }
}

/** Calls the matching handler when a phrase contains one of the keys (case-insensitive). */
export function useVoiceCommands(commands: Record<string, () => void>, active = true) {
  const keys = Object.keys(commands)
  return useListen(active, (text) => {
    const t = text.toLowerCase()
    const key = keys.find((k) => t.includes(k.toLowerCase()))
    if (key) commands[key]()
  })
}

// ---- Spoken-input helpers ----------------------------------------------------------------------

const NUMBER_WORDS: Record<string, string> = {
  zero: '0', oh: '0', one: '1', two: '2', to: '2', too: '2', three: '3', four: '4', for: '4', five: '5',
  six: '6', seven: '7', eight: '8', ate: '8', nine: '9',
}

/** "donna at u b c dot c a" → "donna@ubc.ca" */
export function spokenToEmail(text: string) {
  return text
    .toLowerCase()
    .replace(/\s+at\s+/g, '@')
    .replace(/\s+dot\s+/g, '.')
    .replace(/\s+(underscore)\s+/g, '_')
    .replace(/\s+(dash|hyphen)\s+/g, '-')
    .replace(/\s+/g, '')
}

/** Digits in a spoken phrase, e.g. "four eight 2 9 one seven" → "482917". */
export function spokenToDigits(text: string) {
  return text
    .toLowerCase()
    .split(/[\s,.-]+/)
    .map((w) => NUMBER_WORDS[w] ?? w.replace(/\D/g, ''))
    .join('')
}

/** "Donna" → "D-O-N-N-A" */
export const spellOut = (word: string) => word.toUpperCase().split('').join('-')

/** "donna@ubc.ca" → "d-o-n-n-a at u-b-c dot c-a" */
export const spellEmail = (email: string) =>
  email
    .split('@')
    .map((part) => part.split('.').map((s) => s.split('').join('-')).join(' dot '))
    .join(' at ')

export const firstWord = (text: string) => {
  const w = text.trim().split(/\s+/).pop() ?? ''
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase().replace(/[^a-z'-]/g, '')
}
