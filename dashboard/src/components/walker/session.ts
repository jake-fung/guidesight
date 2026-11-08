/**
 * The live walk (Guide mode), ported from the old Walk screen: the camera sends frames to Flask on
 * every harness event and every PERIODIC_FRAME_MS, spoken questions go to /voice, and alerts come back
 * as speech (here) and a buzz (from the server). The screen stays on with a wake lock.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type Alert, type FrameTrigger, type HarnessEvent, type LatLng } from '../../lib/api'
import type { LiveLink } from '../../lib/live'
import { DEMO, demoAnswer } from './demo'

const PERIODIC_FRAME_MS = 15_000
const MAX_FRAME_WIDTH = 960
const JPEG_QUALITY = 0.6

/** Things Sighty can mention that we collect for the trip summary ("Sighty spotted"). */
const SPOTTABLE = ['crosswalk', 'bus stop', 'bench', 'pole', 'stairs', 'curb', 'door', 'car', 'bike', 'bicycle', 'person', 'sign', 'tree', 'traffic light', 'bin', 'puddle']

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Current camera frame, scaled down so uploads stay small. */
export function grabFrame(video: HTMLVideoElement | null): HTMLCanvasElement | null {
  if (!video?.videoWidth) return null
  const scale = Math.min(1, MAX_FRAME_WIDTH / video.videoWidth)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(video.videoWidth * scale)
  canvas.height = Math.round(video.videoHeight * scale)
  canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
  return canvas
}

function metres(a: LatLng, b: LatLng) {
  const R = 6_371_000
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export type Obstacle = { cm?: number; speak: string | null; at: number }

export type WalkSummary = { seconds: number; alerts: number; metres: number; spotted: string[] }

export type WalkSession = ReturnType<typeof useWalkSession>

export function useWalkSession(link: LiveLink) {
  const video = useRef<HTMLVideoElement | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const walkId = useRef<string | null>(null)
  const location = useRef<LatLng | undefined>(undefined)
  const lastFix = useRef<LatLng | undefined>(undefined)
  const frameInFlight = useRef(false)
  const onAlertRef = useRef<((a: Alert, trigger: FrameTrigger) => void) | null>(null)

  const [active, setActive] = useState(false)
  const [hasCamera, setHasCamera] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [lastAlert, setLastAlert] = useState<string | null>(null)
  const [obstacle, setObstacle] = useState<Obstacle | null>(null)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [endedAt, setEndedAt] = useState<number | null>(null)
  const [alerts, setAlerts] = useState(0)
  const [walked, setWalked] = useState(0)
  const [spotted, setSpotted] = useState<string[]>([])

  const note = useCallback((text: string) => {
    const t = text.toLowerCase()
    const found = SPOTTABLE.filter((s) => t.includes(s)).map((s) => s.replace(/^\w/, (c) => c.toUpperCase()))
    if (found.length) setSpotted((cur) => [...cur, ...found.filter((f) => !cur.includes(f))])
  }, [])

  /** Attach the <video> that shows the camera (Guide and Read text screens). */
  const attachVideo = useCallback((el: HTMLVideoElement | null) => {
    video.current = el
    if (el && stream.current && el.srcObject !== stream.current) {
      el.srcObject = stream.current
      el.play().catch(() => {})
    }
  }, [])

  /** Asks for camera and/or mic. Resolves true when granted. */
  const requestMedia = useCallback(async (kinds: { video?: boolean; audio?: boolean }) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('The camera and microphone need an https:// link.')
      return false
    }
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: kinds.video ? { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } } : false,
        audio: !!kinds.audio,
      })
      // Keep the camera stream for Guide mode; a mic-only permission check can be released.
      if (kinds.video) {
        stream.current?.getTracks().forEach((t) => t.stop())
        stream.current = media
        setHasCamera(true)
        if (video.current) attachVideo(video.current)
      } else media.getTracks().forEach((t) => t.stop())
      return true
    } catch (e) {
      setStatus(`Permission not given: ${errorText(e)}`)
      return false
    }
  }, [attachVideo])

  /** Sends the current frame and returns what Sighty says about it. */
  const describe = useCallback(async (trigger: FrameTrigger): Promise<Alert | null> => {
    if (!walkId.current || frameInFlight.current) return null
    const canvas = grabFrame(video.current)
    if (!canvas) return null
    frameInFlight.current = true
    try {
      const image = canvas.toDataURL('image/jpeg', JPEG_QUALITY).split(',')[1]
      const { alert } = await api.sendFrame(walkId.current, image, trigger, location.current)
      setLastAlert(alert.speak)
      note(alert.speak)
      if (alert.urgency !== 'low') setAlerts((n) => n + 1)
      onAlertRef.current?.(alert, trigger)
      return alert
    } catch (e) {
      console.warn('frame failed', e)
      return null
    } finally {
      frameInFlight.current = false
    }
  }, [note])

  /** Starts a walk on the server (camera, GPS and wake lock come with it). Safe to call twice. */
  const start = useCallback(async () => {
    if (walkId.current) return walkId.current
    setStatus('Starting…')
    if (!stream.current && !DEMO) await requestMedia({ video: true })
    try {
      const { id } = DEMO ? { id: 'demo' } : await api.startWalk()
      walkId.current = id
      setActive(true)
      setStartedAt(Date.now())
      setEndedAt(null)
      setAlerts(0)
      setWalked(0)
      setSpotted([])
      setStatus(null)
      return id
    } catch (e) {
      setStatus(`Couldn’t reach the server: ${errorText(e)}`)
      return null
    }
  }, [requestMedia])

  const end = useCallback(async (): Promise<WalkSummary> => {
    const id = walkId.current
    walkId.current = null
    setActive(false)
    setEndedAt(Date.now())
    if (id && !DEMO) await api.endWalk(id).catch(() => {})
    return { seconds: startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0, alerts, metres: Math.round(walked), spotted }
  }, [startedAt, alerts, walked, spotted])

  /** Spoken (audio) or typed question with the current frame. Starts a walk first if needed. */
  const ask = useCallback(async (audio: Blob | string) => {
    if (DEMO) {
      const res = await demoAnswer(typeof audio === 'string' ? audio : '')
      note(res.alert.speak)
      return res
    }
    const id = walkId.current ?? (await start())
    if (!id) throw new Error('Not connected to the server')
    const canvas = grabFrame(video.current)
    const image = canvas ? await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', JPEG_QUALITY)) : null
    const res = await api.askQuestion(id, audio, image, location.current)
    note(res.alert.speak)
    return res
  }, [start, note])

  // While walking: GPS, periodic frames, harness events, wake lock.
  const { setEventHandler } = link
  useEffect(() => {
    if (!active || DEMO) return
    let wakeLock: WakeLockSentinel | null = null
    const keepAwake = async () => {
      if (document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return
      wakeLock = await navigator.wakeLock.request('screen').catch(() => null)
    }
    keepAwake()
    document.addEventListener('visibilitychange', keepAwake)

    const watchId = navigator.geolocation?.watchPosition((pos) => {
      const here = { lat: pos.coords.latitude, lng: pos.coords.longitude }
      if (lastFix.current && pos.coords.accuracy < 30) setWalked((m) => m + metres(lastFix.current!, here))
      lastFix.current = here
      location.current = here
    }, () => {}, { enableHighAccuracy: true })

    const timer = setInterval(() => describe('periodic'), PERIODIC_FRAME_MS)

    setEventHandler(async (e: HarnessEvent) => {
      if (!walkId.current) return
      if (e.type === 'obstacle') setObstacle({ cm: e.cm, speak: null, at: Date.now() })
      try {
        const res = await api.harnessEvent(walkId.current, e, location.current)
        if (res.capture_frame) {
          const alert = await describe(e.type)
          if (alert && e.type === 'obstacle') setObstacle({ cm: e.cm, speak: alert.speak, at: Date.now() })
        }
      } catch (err) {
        console.warn('harness event failed', err)
      }
    })

    return () => {
      clearInterval(timer)
      setEventHandler(null)
      document.removeEventListener('visibilitychange', keepAwake)
      wakeLock?.release().catch(() => {})
      if (watchId !== undefined) navigator.geolocation.clearWatch(watchId)
    }
  }, [active, describe, setEventHandler])

  /** Called with every alert from a frame, e.g. so Guide mode can speak it. Stable across renders. */
  const onAlert = useCallback((fn: ((a: Alert, trigger: FrameTrigger) => void) | null) => {
    onAlertRef.current = fn
  }, [])

  // Release the camera when the app goes away.
  useEffect(() => () => stream.current?.getTracks().forEach((t) => t.stop()), [])

  return {
    active, hasCamera, status, lastAlert, obstacle, startedAt, endedAt, alerts, walked, spotted,
    attachVideo, requestMedia, start, end, describe, ask,
    clearObstacle: () => setObstacle(null),
    onAlert,
    /** Mic stream for recording a question (shares the camera's permission prompt when possible). */
    micStream: async () => {
      const audio = stream.current?.getAudioTracks() ?? []
      if (audio.length) return new MediaStream(audio)
      return navigator.mediaDevices.getUserMedia({ audio: true })
    },
  }
}
