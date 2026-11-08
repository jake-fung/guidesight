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
import { api, ApiError } from '../../lib/api'

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
/** A phone voice picked in Settings. null = Sighty's ElevenLabs voice (server /api/tts). */
let voiceName: string | null = null
let unlocked = false
let enabled = true

/** Bumped on every say() and stop(), so a clip or utterance from an older job is ignored. */
let job = 0
/** What the current job is doing, for pause/resume. */
let mode: 'loading' | 'clip' | 'phone' | null = null
/** Ends the current job: stops its sound and resolves its say() promise. */
let endJob: (() => void) | null = null
let aborter: AbortController | null = null
/** Settles the clip or utterance that's playing (speechSynthesis.cancel() doesn't always fire onend). */
let dropSound: (() => void) | null = null

// ElevenLabs voices only go from 0.7x to 1.2x. Other rates are reached by playing the clip
// faster or slower (the browser keeps the pitch).
const VOICE_SPEED = { min: 0.7, max: 1.2 }
// A tiny silent WAV, played inside the first tap to unlock audio playback on iPhones.
const SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='
let player: HTMLAudioElement | null = null
/** Set after a 503 (no ElevenLabs key on the server), so we stop asking for the rest of the session. */
let elevenLabsOff = false
/** Recent clips, so Replay and repeated screen reads don't fetch again. */
const clips = new Map<string, Blob>()
const MAX_CLIPS = 30

const synth = () => (typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null)
const audio = () => (player ??= new Audio())

/** One AudioContext for mic volume checks. iPhones only let it run once it's resumed inside a tap. */
let sharedCtx: AudioContext | null = null
export function audioContext(): AudioContext | null {
  if (sharedCtx) return sharedCtx
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  return Ctx ? (sharedCtx = new Ctx()) : null
}

/** Highlights captions up to the end of the word at char `at`. */
function spokenUpTo(text: string, at: number) {
  const end = text.indexOf(' ', at)
  const spokenTo = end === -1 ? text.length : end
  if (spokenTo !== state.spokenTo) set({ spokenTo })
}

function halt() {
  job++
  mode = null
  aborter?.abort()
  aborter = null
  player?.pause()
  synth()?.cancel()
  dropSound?.()
  dropSound = null
  const end = endJob
  endJob = null
  end?.()
}

async function fetchClip(text: string, speed: number, signal: AbortSignal): Promise<Blob | null> {
  const key = `${speed}|${text}`
  const cached = clips.get(key)
  if (cached) return cached
  try {
    const blob = await api.speech(text, speed, signal)
    clips.set(key, blob)
    if (clips.size > MAX_CLIPS) clips.delete(clips.keys().next().value!)
    return blob
  } catch (e) {
    if (e instanceof ApiError && e.status === 503) elevenLabsOff = true
    else if (!signal.aborted) console.warn('ElevenLabs voice failed, using the phone voice', e)
    return null
  }
}

/** Plays an ElevenLabs clip. Resolves true when it finished, false if it couldn't play. */
function playClip(id: number, text: string, blob: Blob, playbackRate: number): Promise<boolean> {
  return new Promise((resolve) => {
    const el = audio()
    const url = URL.createObjectURL(blob)
    let frame = 0
    let settled = false
    const done = (played: boolean) => {
      if (settled) return
      settled = true
      if (dropSound === stop) dropSound = null
      cancelAnimationFrame(frame)
      el.onplaying = el.onended = el.onerror = null
      URL.revokeObjectURL(url)
      resolve(played)
    }
    // No word timings from the clip, so captions follow the share of the clip played so far.
    const track = () => {
      if (Number.isFinite(el.duration) && el.duration > 0) {
        spokenUpTo(text, Math.floor((el.currentTime / el.duration) * text.length))
      }
      if (!el.paused && !el.ended) frame = requestAnimationFrame(track)
    }
    el.onplaying = () => {
      if (id !== job) return
      set({ status: 'speaking' })
      track()
    }
    el.onended = () => done(true)
    el.onerror = () => done(false)
    const stop = () => done(true)
    dropSound = stop
    el.src = url
    el.defaultPlaybackRate = el.playbackRate = playbackRate
    mode = 'clip'
    // AbortError = paused before it started; resume() plays it again.
    if (state.status !== 'paused') el.play().catch((e) => e?.name !== 'AbortError' && done(false))
  })
}

function speakWithPhone(id: number, text: string, rate: number, phoneVoice: SpeechSynthesisVoice | null): Promise<void> {
  const s = synth()
  if (!s) return Promise.resolve()
  mode = 'phone'
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text)
    u.rate = rate
    if (phoneVoice) u.voice = phoneVoice
    u.onstart = () => id === job && set({ status: 'speaking' })
    u.onboundary = (e) => id === job && spokenUpTo(text, e.charIndex + 1)
    u.onend = u.onerror = () => {
      if (dropSound === resolve) dropSound = null
      resolve()
    }
    dropSound = resolve
    s.speak(u)
  })
}

export const voice = {
  subscribe(l: () => void) {
    listeners.add(l)
    return () => listeners.delete(l)
  },
  get: () => state,

  /** Must run inside a tap (iOS Safari only lets a page speak after a user gesture). */
  unlock() {
    unlocked = true
    const el = audio()
    el.src = SILENCE
    el.play().catch(() => {})
    audioContext()?.resume().catch(() => {})
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
    halt()
    if (!text || (!enabled && !opts.force) || !unlocked) {
      // Not speaking: show the whole caption as already read.
      set({ text, spokenTo: text.length, status: 'idle' })
      return Promise.resolve()
    }
    const id = job
    const rate = baseRate * (slower ? 0.8 : 1)
    const phoneVoice = (voiceName && synth()?.getVoices().find((x) => x.name === voiceName)) || null
    const useClip = !phoneVoice && !elevenLabsOff
    // 'speaking' while the clip downloads too, so the mic doesn't start listening in between.
    set({ text, spokenTo: 0, status: useClip ? 'speaking' : 'idle' })

    return new Promise((resolve) => {
      endJob = resolve
      const finish = () => {
        if (id !== job) return // already ended by halt()
        endJob = null
        mode = null
        set({ status: 'idle', spokenTo: text.length })
        resolve()
      }
      ;(async () => {
        if (useClip) {
          mode = 'loading'
          aborter = new AbortController()
          const speed = Math.min(Math.max(rate, VOICE_SPEED.min), VOICE_SPEED.max)
          const blob = await fetchClip(text, speed, aborter.signal)
          if (id !== job) return
          if (blob && (await playClip(id, text, blob, rate / speed))) return finish()
          if (id !== job) return
        }
        if (state.status === 'paused') set({ status: 'idle' })
        await speakWithPhone(id, text, rate, phoneVoice)
        finish()
      })().catch((e) => {
        console.warn('speech failed', e)
        finish()
      })
    })
  },

  pause() {
    if (mode === 'clip') player?.pause()
    else synth()?.pause()
    set({ status: 'paused' })
  },
  resume() {
    if (state.status !== 'paused') return
    set({ status: mode ? 'speaking' : 'idle' })
    if (mode === 'clip') player?.play().catch(() => {})
    else if (mode === 'phone') synth()?.resume()
    // 'loading': the clip starts playing when it arrives.
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
    halt()
    set({ status: 'idle', spokenTo: state.text.length })
  },
}

// Phones only allow sound after a tap. A0 unlocks it, but a reload (or a link straight to a screen)
// skips A0, so the first tap anywhere unlocks it too.
if (typeof document !== 'undefined') {
  const unlockOnTap = () => {
    if (!unlocked) voice.unlock()
    document.removeEventListener('pointerdown', unlockOnTap, true)
  }
  document.addEventListener('pointerdown', unlockOnTap, true)
}

export function useSpeech() {
  return useSyncExternalStore(voice.subscribe, voice.get, voice.get)
}

/** Priority of what announce() is saying right now (0 = nothing). */
let announcing = 0
let announced: Promise<void> = Promise.resolve()

/**
 * Speaks during a walk without cutting off something more important: news with a lower priority
 * waits for the current announcement to end (and is dropped if that takes over 10 s). Equal or higher
 * priority interrupts. Use 3 for obstacles, 2 for turns and answers, 1 for the rest.
 */
export async function announce(text: string, priority = 1) {
  const asked = Date.now()
  while (announcing > priority) {
    await announced
    if (Date.now() - asked > 10_000) return
  }
  const said = voice.say(text, { force: true })
  announcing = priority
  announced = said
  await said
  if (announced === said) announcing = 0
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
export type RecognitionCtor = new () => Recognition

export const Recognition: RecognitionCtor | undefined =
  typeof window === 'undefined'
    ? undefined
    : ((window as unknown as { SpeechRecognition?: RecognitionCtor }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: RecognitionCtor }).webkitSpeechRecognition)

export const canListen = !!Recognition

export type Heard = { final: string; interim: string }

/** Recogniser errors that won't fix themselves by restarting (SpeechRecognitionErrorEvent.error). */
const FATAL_LISTEN_ERRORS: Record<string, string> = {
  'not-allowed': 'Microphone access is blocked for this site.',
  'service-not-allowed': 'This browser’s speech recognition is turned off.',
  'audio-capture': 'No microphone was found.',
  network: 'Speech recognition needs an internet connection.',
  'language-not-supported': 'Speech recognition doesn’t support this language.',
}

/**
 * Listens while `active` (and while Sighty isn't talking, so it doesn't hear itself).
 * onFinal fires with each finished phrase.
 */
export function useListen(active: boolean, onFinal: (text: string) => void, opts: { continuous?: boolean } = {}) {
  const speech = useSpeech()
  const [heard, setHeard] = useState<Heard>({ final: '', interim: '' })
  const [listening, setListening] = useState(false)
  /** Why listening stopped for good, e.g. the mic is blocked. null while it's working. */
  const [error, setError] = useState<string | null>(null)
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
      rec.onerror = (e) => {
        // 'no-speech' and 'aborted' are normal (a quiet moment, or another recogniser took over).
        if (e.error === 'no-speech' || e.error === 'aborted') return
        console.warn('[listen] speech recognition error:', e.error)
        const fatal = FATAL_LISTEN_ERRORS[e.error]
        if (fatal) {
          stopped = true
          setError(fatal)
        }
      }
      rec.onend = () => {
        setListening(false)
        // Browsers end a session after a pause; keep listening until the screen is done.
        if (!stopped) restart = setTimeout(begin, 300)
      }
      try {
        rec.start()
        setListening(true)
      } catch (e) {
        console.warn('[listen] could not start speech recognition:', e)
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

  return { heard, listening, error, reset: () => setHeard({ final: '', interim: '' }) }
}

/**
 * Calls onPause once someone has spoken and then gone quiet for `silenceMs`, judged from the mic's
 * volume alone, so it works in browsers whose speech recognition is missing or failing.
 * Also calls it after `maxMs` no matter what. onPause gets whether anyone spoke (true when the
 * volume couldn't be read, e.g. audio is still locked). Returns a function that stops watching.
 */
export function watchForPause(stream: MediaStream, onPause: (spoke: boolean) => void, { silenceMs = 1500, maxMs = 30_000 } = {}) {
  const ctx = audioContext()
  if (!ctx) return () => {}
  ctx.resume().catch(() => {})
  const source = ctx.createMediaStreamSource(stream)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 1024
  source.connect(analyser)
  const samples = new Float32Array(analyser.fftSize)

  const FRAME_MS = 50
  const SPEECH_FRAMES = 4 // 200 ms of sound in a row counts as speech, so a click or bump doesn't
  const started = Date.now()
  let noiseFloor = 0.005 // background level, tracked as the quietest recent volume
  let loudFrames = 0
  let spoke = false
  let lastSpeech = 0

  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(samples)
    let sum = 0
    for (const s of samples) sum += s * s
    const volume = Math.sqrt(sum / samples.length)
    // Falls straight to quiet moments, creeps up slowly (~4%/s) so a noisy street raises it.
    noiseFloor = Math.min(volume, noiseFloor * 1.002 + 1e-6)
    const now = Date.now()
    if (volume > Math.max(noiseFloor * 3, 0.01)) {
      loudFrames++
      if (loudFrames >= SPEECH_FRAMES) spoke = true
      if (spoke) lastSpeech = now
    } else loudFrames = 0
    if ((spoke && now - lastSpeech > silenceMs) || now - started > maxMs) {
      stop()
      onPause(spoke || ctx.state !== 'running')
    }
  }, FRAME_MS)

  function stop() {
    clearInterval(timer)
    source.disconnect()
  }
  return stop
}

const canRecord =
  typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

/**
 * Listens while `active` (and while Sighty isn't talking) by recording one phrase at a time and
 * sending it to the server's speech-to-text (ElevenLabs). Works on iPhones, where the browser's own
 * recogniser misses most phrases. `off` turns true when the server has no speech-to-text set up.
 */
export function usePhraseListen(active: boolean, onText: (text: string) => void, { silenceMs = 700, maxMs = 6000 } = {}) {
  const speech = useSpeech()
  const talking = speech.status === 'speaking'
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [off, setOff] = useState(!canRecord)
  const cb = useRef(onText)
  useEffect(() => {
    cb.current = onText
  })

  useEffect(() => {
    // Mic off while Sighty talks, so it doesn't hear itself (and iPhones keep playing on the speaker).
    if (!active || talking || off) return
    let stopped = false
    let stream: MediaStream | null = null
    let rec: MediaRecorder | null = null
    let stopWatching = () => {}
    const aborter = new AbortController()

    const record = () => {
      if (stopped || !stream) return
      const r = new MediaRecorder(stream)
      const chunks: Blob[] = []
      let spoke = false
      rec = r
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data)
      r.onstop = () => {
        if (stopped) return
        record() // keep listening while this phrase is transcribed
        const clip = new Blob(chunks, { type: r.mimeType || 'audio/mp4' })
        if (!spoke || !clip.size) return
        api.transcribe(clip, aborter.signal)
          .then((text) => !stopped && text && cb.current(text))
          .catch((e) => {
            if (stopped) return
            if (e instanceof ApiError && e.status === 503) setOff(true)
            else console.warn('[listen] speech-to-text failed:', e)
          })
      }
      r.start()
      stopWatching = watchForPause(stream, (s) => {
        spoke = s
        if (r.state !== 'inactive') r.stop()
      }, { silenceMs, maxMs })
    }

    navigator.mediaDevices.getUserMedia({ audio: true })
      .then((s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop())
        stream = s
        setError(null)
        setListening(true)
        record()
      })
      .catch((e) => {
        if (stopped) return
        console.warn('[listen] no microphone:', e)
        setError(e?.name === 'NotAllowedError' ? 'Microphone access is blocked for this site.' : 'No microphone was found.')
      })

    return () => {
      stopped = true
      aborter.abort()
      stopWatching()
      if (rec && rec.state !== 'inactive') rec.stop()
      stream?.getTracks().forEach((t) => t.stop())
      setListening(false)
    }
  }, [active, talking, off, silenceMs, maxMs])

  return { listening, error, off }
}

/**
 * Hears whole phrases: the server's speech-to-text, or the browser's recogniser when the server
 * can't. `interim` (live words) only comes from the browser's recogniser.
 * Short commands suit the default 0.7 s pause; give dictation (emails) longer.
 */
export function usePhrases(active: boolean, onText: (text: string) => void, opts: { silenceMs?: number; maxMs?: number } = {}) {
  const server = usePhraseListen(active, onText, opts)
  const browser = useListen(active && server.off, onText)
  return server.off
    ? { listening: browser.listening, error: browser.error, interim: browser.heard.interim }
    : { listening: server.listening, error: server.error, interim: '' }
}

/** Lowercase words only, so "Low-vision." matches "low vision". */
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9']+/g, ' ').trim()

/** Calls the matching handler when a phrase contains one of the keys (case-insensitive). */
export function useVoiceCommands(commands: Record<string, () => void>, active = true) {
  return usePhrases(active, (text) => {
    const t = ` ${words(text)} `
    const key = Object.keys(commands).find((k) => t.includes(` ${words(k)} `))
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
