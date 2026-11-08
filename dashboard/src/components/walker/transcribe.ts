/**
 * Live transcription for "tap to record, tap again to confirm" answers (voice setup).
 *
 * Words appear while the person is still talking. In order of preference:
 *  1. ElevenLabs Scribe realtime: the mic streams straight to ElevenLabs with a single-use token
 *     from our server (/api/stt/token). Works on iPhones too.
 *  2. The browser's own speech recogniser (when the server has no ElevenLabs key).
 *  3. Recording the answer and transcribing it once it's done (no live words).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { audioContext, Recognition } from './voice'

export type Take = {
  /** Whether words show up while the person talks (false = only once they're done). */
  live: boolean
  /** Stops listening and resolves with everything that was said. */
  finish(): Promise<string>
  /** Stops listening and throws the answer away. */
  cancel(): void
}

type Handlers = { onText: (text: string) => void; onError: (message: string) => void }

const REALTIME_URL = 'wss://api.elevenlabs.io/v1/speech-to-text/realtime'
const RATE = 16_000
/** Set after a 503 (no ElevenLabs key), so we stop asking for a token this session. */
let realtimeOff = false

// iPhones only run audio processing once it's resumed inside a tap. Screens like "Ask" can open
// without one (e.g. from a voice command), so resume it on every tap anywhere.
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', () => {
    const ctx = audioContext()
    if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {})
  }, { capture: true, passive: true })
}

/** Resolves true once the audio context runs; false if the browser keeps it locked. */
async function audioRunning(ctx: AudioContext) {
  if (ctx.state === 'running') return true
  await Promise.race([ctx.resume().catch(() => {}), new Promise((r) => setTimeout(r, 400))])
  return (ctx.state as AudioContextState) === 'running'
}

const joined = (...parts: string[]) => parts.map((p) => p.trim()).filter(Boolean).join(' ')

/** Mic samples at the device rate → 16 kHz 16-bit PCM, base64-encoded for the websocket. */
function toPcm16(input: Float32Array, inRate: number): string {
  const ratio = inRate / RATE
  const out = new Int16Array(Math.floor(input.length / ratio))
  for (let i = 0; i < out.length; i++) {
    // Average the samples that fold into this one (a cheap low-pass before dropping the rate).
    const from = Math.floor(i * ratio)
    const to = Math.min(Math.floor((i + 1) * ratio), input.length)
    let sum = 0
    for (let j = from; j < to; j++) sum += input[j]
    const v = Math.max(-1, Math.min(1, sum / Math.max(1, to - from)))
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff
  }
  const bytes = new Uint8Array(out.buffer)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

const chunk = (audio: string, commit = false) =>
  JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: audio, commit, sample_rate: RATE })

/** 1. ElevenLabs realtime. Rejects if it can't get going, so the caller can fall back. */
async function realtime(stream: MediaStream, { onText, onError }: Handlers): Promise<Take> {
  const ctx = audioContext()
  if (!ctx || realtimeOff) throw new Error('realtime off')
  // A locked context never hands us mic samples, so don't stream silence.
  if (!(await audioRunning(ctx))) throw new Error('realtime: audio is locked until the next tap')

  // Start capturing right away and queue it, so words said while the socket connects aren't lost.
  const queue: string[] = []
  let ws: WebSocket | null = null
  const source = ctx.createMediaStreamSource(stream)
  const proc = ctx.createScriptProcessor(4096, 1, 1)
  const mute = ctx.createGain()
  mute.gain.value = 0
  proc.onaudioprocess = (e) => {
    const audio = toPcm16(e.inputBuffer.getChannelData(0), ctx.sampleRate)
    if (ws?.readyState === WebSocket.OPEN) ws.send(chunk(audio))
    else queue.push(audio)
  }
  source.connect(proc)
  proc.connect(mute) // some browsers only run the processor when it's connected to the output
  mute.connect(ctx.destination)
  const stopCapture = () => {
    proc.onaudioprocess = null
    source.disconnect()
    proc.disconnect()
    mute.disconnect()
  }

  const committed: string[] = []
  let partial = ''
  let onCommit: (() => void) | null = null
  const text = () => joined(...committed, partial)

  try {
    const { token, model_id } = await api.sttToken()
    const lang = (navigator.language || 'en').split('-')[0]
    const url = `${REALTIME_URL}?${new URLSearchParams({
      model_id, token, audio_format: 'pcm_16000', commit_strategy: 'manual', language_code: lang,
    })}`
    ws = new WebSocket(url)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('realtime: no session after 6 s')), 6000)
      ws!.onerror = () => reject(new Error('realtime: websocket failed'))
      ws!.onclose = (e) => reject(new Error(`realtime: closed (${e.code} ${e.reason})`))
      ws!.onmessage = (e) => {
        const msg = JSON.parse(e.data)
        if (msg.message_type === 'session_started') {
          clearTimeout(timer)
          resolve()
        } else if (msg.error) {
          clearTimeout(timer)
          reject(new Error(`realtime: ${msg.message_type}: ${msg.error}`))
        }
      }
    })
  } catch (e) {
    stopCapture()
    ws?.close()
    if (e instanceof ApiError && e.status === 503) realtimeOff = true
    throw e
  }

  const socket = ws
  let closing = false
  socket.onmessage = (e) => {
    const msg = JSON.parse(e.data)
    if (msg.message_type === 'partial_transcript') {
      partial = msg.text ?? ''
      onText(text())
    } else if (msg.message_type === 'committed_transcript') {
      if (msg.text?.trim()) committed.push(msg.text)
      partial = ''
      onText(text())
      onCommit?.()
    } else if (msg.error) {
      console.warn('[transcribe] realtime:', msg.message_type, msg.error)
      // Nothing to commit (e.g. silence): finish() just uses what it has.
      if (msg.message_type === 'commit_throttled' || msg.message_type === 'insufficient_audio_activity') onCommit?.()
    }
  }
  socket.onerror = () => console.warn('[transcribe] realtime websocket error')
  socket.onclose = (e) => {
    stopCapture()
    onCommit?.()
    if (e.code !== 1000 && !closing) onError('Lost the connection while listening. Tap to try again.')
  }
  queue.splice(0).forEach((a) => socket.send(chunk(a)))

  const close = () => {
    closing = true
    stopCapture()
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close(1000)
  }
  return {
    live: true,
    async finish() {
      stopCapture()
      if (socket.readyState === WebSocket.OPEN) {
        // A short bit of silence carries the commit, so the last words are finalised.
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 2500)
          onCommit = () => {
            clearTimeout(timer)
            resolve()
          }
          socket.send(chunk(toPcm16(new Float32Array(RATE / 10), RATE), true))
        })
      }
      close()
      return text()
    },
    cancel: close,
  }
}

/** 2. The browser's recogniser, with live (interim) words. */
function browser({ onText, onError }: Handlers): Take {
  const rec = new Recognition!()
  rec.lang = navigator.language || 'en-CA'
  rec.continuous = true
  rec.interimResults = true
  const finals: string[] = []
  let interim = ''
  let ended = false
  let onEnd: (() => void) | null = null
  rec.onresult = (e) => {
    interim = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]
      if (r.isFinal) finals.push(r[0].transcript)
      else interim += r[0].transcript
    }
    onText(joined(...finals, interim))
  }
  rec.onerror = (e) => {
    if (e.error === 'no-speech' || e.error === 'aborted') return
    console.warn('[transcribe] browser recogniser:', e.error)
    onError(e.error === 'not-allowed' ? 'Microphone access is blocked for this site.' : 'I couldn’t hear you. Tap to try again.')
  }
  rec.onend = () => {
    ended = true
    onEnd?.()
  }
  rec.start()
  return {
    live: true,
    finish() {
      return new Promise((resolve) => {
        const done = () => resolve(joined(...finals, interim))
        if (ended) return done()
        const timer = setTimeout(done, 1500)
        onEnd = () => {
          clearTimeout(timer)
          done()
        }
        rec.stop()
      })
    },
    cancel() {
      rec.onresult = null
      rec.abort()
    },
  }
}

/** 3. Record now, transcribe at the end. */
function recorded(stream: MediaStream, { onError }: Handlers): Take {
  const rec = new MediaRecorder(stream)
  const chunks: Blob[] = []
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  rec.start()
  const stopped = () => new Promise<void>((resolve) => {
    if (rec.state === 'inactive') return resolve()
    rec.onstop = () => resolve()
    rec.stop()
  })
  return {
    live: false,
    async finish() {
      await stopped()
      const clip = new Blob(chunks, { type: rec.mimeType || 'audio/mp4' })
      if (!clip.size) return ''
      try {
        return await api.transcribe(clip)
      } catch (e) {
        console.warn('[transcribe] speech-to-text failed:', e)
        onError('I couldn’t understand that. Tap to try again.')
        return ''
      }
    },
    cancel() {
      rec.ondataavailable = null
      void stopped()
    },
  }
}

/** Starts listening. Call it inside the tap, so iPhones let the audio start. */
async function startTake(handlers: Handlers): Promise<Take> {
  audioContext()?.resume().catch(() => {})
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const release = () => stream.getTracks().forEach((t) => t.stop())
  const releasing = (take: Take): Take => ({
    live: take.live,
    finish: () => take.finish().finally(release),
    cancel: () => {
      take.cancel()
      release()
    },
  })

  try {
    return releasing(await realtime(stream, handlers))
  } catch (e) {
    if (!realtimeOff) console.warn('[transcribe] live transcription unavailable, falling back:', e)
  }
  if (Recognition) {
    // The recogniser opens the mic itself; holding our own stream too confuses iPhones.
    release()
    return browser(handlers)
  }
  if (typeof MediaRecorder !== 'undefined') return releasing(recorded(stream, handlers))
  release()
  throw new Error('This browser can’t record audio.')
}

/**
 * One answer at a time: start() on the first tap, finish() on the second.
 * `text` holds the live words; `error` explains why listening stopped.
 */
export function useLiveTranscript() {
  const [text, setText] = useState('')
  const [recording, setRecording] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Whether the words show up live. null until listening has started. */
  const [live, setLive] = useState<boolean | null>(null)
  /** The answer being recorded (still starting up, until the promise settles). */
  const take = useRef<Promise<Take | null> | null>(null)
  /** Bumped on every start/cancel, so a slow start that was cancelled is thrown away. */
  const run = useRef(0)

  const cancel = useCallback(() => {
    run.current++
    const t = take.current
    take.current = null
    void t?.then((x) => x?.cancel())
    setRecording(false)
    setStarting(false)
  }, [])

  const start = useCallback(() => {
    cancel()
    const id = run.current
    setText('')
    setError(null)
    setStarting(true)
    setRecording(true)
    take.current = startTake({
      onText: (s) => id === run.current && setText(s),
      onError: (m) => {
        if (id !== run.current) return
        setError(m)
        cancel() // listening is over; start() again to retry
      },
    }).then(
      (t) => {
        if (id === run.current) setLive(t.live)
        return t
      },
      (e) => {
        console.warn('[transcribe] could not start:', e)
        if (id === run.current) {
          setError((e as Error)?.name === 'NotAllowedError' ? 'Microphone access is blocked for this site.' : 'I couldn’t start the microphone.')
          setRecording(false)
        }
        return null
      },
    ).finally(() => id === run.current && setStarting(false))
  }, [cancel])

  /** Resolves with the final words ('' if nothing was heard). */
  const finish = useCallback(async () => {
    const pending = take.current
    const id = run.current
    take.current = null
    setRecording(false)
    const t = await pending
    if (!t) return ''
    const final = await t.finish()
    if (id === run.current) setText(final)
    return final
  }, [])

  useEffect(() => cancel, [cancel])

  return { text, recording, starting, error, live, start, finish, cancel }
}
