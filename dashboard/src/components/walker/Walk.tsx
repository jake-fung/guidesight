/**
 * Live Walk: the camera sends frames to Flask on every harness event and every PERIODIC_FRAME_MS,
 * the mic records spoken questions, and alerts come back as speech (here) and a buzz (from the server).
 * The page has to stay open with the screen on, so it holds a screen wake lock.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type FrameTrigger, type LatLng } from '../../lib/api'
import type { LiveLink } from '../../lib/live'
import { speakAlert, stopSpeech } from '../../lib/speech'
import BigButton from './BigButton'

const PERIODIC_FRAME_MS = 15_000
const MAX_FRAME_WIDTH = 960
const JPEG_QUALITY = 0.6

/** Current camera frame, scaled down so uploads stay small. */
function grabFrame(video: HTMLVideoElement | null): HTMLCanvasElement | null {
  if (!video?.videoWidth) return null
  const scale = Math.min(1, MAX_FRAME_WIDTH / video.videoWidth)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(video.videoWidth * scale)
  canvas.height = Math.round(video.videoHeight * scale)
  canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
  return canvas
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export default function Walk({ link, onEnd }: { link: LiveLink; onEnd: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const walkId = useRef<string | null>(null)
  const location = useRef<LatLng | undefined>(undefined)
  const frameInFlight = useRef(false)

  const [status, setStatus] = useState('Starting walk…')
  const [lastAlert, setLastAlert] = useState('')
  const [recording, setRecording] = useState(false)

  /** Send a frame and speak what's ahead. Skips if a frame is already in flight. */
  const describe = useCallback(async (trigger: FrameTrigger) => {
    if (!walkId.current || frameInFlight.current) return
    const canvas = grabFrame(video.current)
    if (!canvas) return
    frameInFlight.current = true
    try {
      const image = canvas.toDataURL('image/jpeg', JPEG_QUALITY).split(',')[1]
      const { alert } = await api.sendFrame(walkId.current, image, trigger, location.current)
      setLastAlert(alert.speak)
      speakAlert(alert)
    } catch (e) {
      console.warn('frame failed', e)
    } finally {
      frameInFlight.current = false
    }
  }, [])

  // Camera + mic, the walk itself, GPS, harness events, periodic frames and the wake lock.
  const { setEventHandler } = link
  useEffect(() => {
    let stopped = false
    let media: MediaStream | null = null
    let watchId: number | undefined
    let wakeLock: WakeLockSentinel | null = null

    setEventHandler(async (e) => {
      if (!walkId.current) return
      try {
        const res = await api.harnessEvent(walkId.current, e, location.current)
        if (res.capture_frame) describe(e.type)
      } catch (err) {
        console.warn('harness event failed', err)
      }
    })
    const timer = setInterval(() => describe('periodic'), PERIODIC_FRAME_MS)

    async function keepAwake() {
      if (document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return
      wakeLock = await navigator.wakeLock.request('screen').catch(() => null)
    }
    document.addEventListener('visibilitychange', keepAwake)

    ;(async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('the camera needs an https:// link')
      }
      media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
        audio: true,
      })
      if (stopped) return media.getTracks().forEach((t) => t.stop())
      stream.current = media
      if (video.current) {
        video.current.srcObject = media
        await video.current.play().catch(() => {})
      }
      await keepAwake()

      const { id } = await api.startWalk()
      if (stopped) return
      walkId.current = id
      setStatus('Walk started')

      watchId = navigator.geolocation?.watchPosition(
        (pos) => (location.current = { lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => setStatus('Walk started. Location is off, so stops won’t appear on the map.'),
        { enableHighAccuracy: true },
      )
    })().catch((e) => setStatus(`Could not start walk: ${errorText(e)}`))

    return () => {
      stopped = true
      setEventHandler(null)
      clearInterval(timer)
      document.removeEventListener('visibilitychange', keepAwake)
      wakeLock?.release().catch(() => {})
      if (watchId !== undefined) navigator.geolocation.clearWatch(watchId)
      media?.getTracks().forEach((t) => t.stop())
    }
  }, [describe, setEventHandler])

  // Spoken questions ("which bus is this?"): tap to start, tap again to send.
  // Tap-to-toggle rather than press-and-hold, which is awkward with VoiceOver.
  // TODO: hands-free wake word / voice activity detection.
  function startQuestion() {
    const audio = stream.current?.getAudioTracks() ?? []
    if (!audio.length) return setStatus('Microphone not available')
    stopSpeech() // don't record the app talking
    const rec = new MediaRecorder(new MediaStream(audio))
    chunks.current = []
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.current.push(e.data)
    }
    rec.start()
    recorder.current = rec
    setRecording(true)
  }

  async function sendQuestion() {
    const rec = recorder.current
    if (!rec) return
    recorder.current = null
    setRecording(false)
    await new Promise((resolve) => {
      rec.onstop = resolve
      rec.stop()
    })
    const audio = new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' })
    if (!walkId.current || !audio.size) return

    setStatus('Thinking…')
    try {
      const canvas = grabFrame(video.current)
      const image = canvas
        ? await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
        : null
      const { transcript, alert } = await api.askQuestion(walkId.current, audio, image, location.current)
      setLastAlert(`“${transcript}” — ${alert.speak}`)
      speakAlert(alert)
      setStatus('Walking')
    } catch (e) {
      setStatus(`Question failed: ${errorText(e)}`)
    }
  }

  async function endWalk() {
    if (walkId.current) await api.endWalk(walkId.current).catch(() => {})
    stopSpeech()
    onEnd()
  }

  return (
    <main className="mx-auto flex h-dvh max-w-lg flex-col gap-4 bg-zinc-950 p-4 text-white">
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl bg-zinc-900">
        <video ref={video} playsInline muted autoPlay aria-hidden="true" className="h-full w-full object-cover" />
        <p className="absolute left-3 top-3 rounded-lg bg-black/60 px-3 py-1 text-sm">
          Harness: {link.harnessOnline ? 'connected' : 'offline'}
        </p>
      </div>

      <p className="text-lg text-zinc-300" role="status">{status}</p>
      {/* Not a live region: the alert is already spoken aloud, so screen readers shouldn't repeat it. */}
      {lastAlert && <p className="text-xl font-bold">{lastAlert}</p>}

      <BigButton onClick={recording ? sendQuestion : startQuestion} className="min-h-28 text-2xl"
        variant={recording ? 'danger' : 'primary'}>
        {recording ? 'Listening… tap to send' : 'Ask a question'}
      </BigButton>
      <BigButton variant="secondary" onClick={() => describe('manual')}>Describe what’s ahead</BigButton>
      <BigButton variant="danger" onClick={endWalk}>End walk</BigButton>
    </main>
  )
}
