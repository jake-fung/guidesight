/**
 * The live walk (Guide mode), ported from the old Walk screen: the camera sends frames to Flask on
 * every harness event and every PERIODIC_FRAME_MS, spoken questions go to /voice, and alerts come back
 * as speech (here) and a buzz (from the server). The screen stays on with a wake lock.
 *
 * With a destination (setRoute), every GPS fix also goes to the Navigator (navigation.ts), whose
 * turn-by-turn news reaches Guide mode through onNav. Going off the route fetches a new one.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type Alert, type Avoid, type FrameTrigger, type HarnessEvent, type LatLng, type Route, type SeenObstacle } from '../../lib/api'
import type { LiveLink } from '../../lib/live'
import { DEMO, demoAnswer } from './demo'
import { Navigator, compassWord, headingFrom, metres, speakable, type NavEvent, type NavStatus } from './navigation'

const PERIODIC_FRAME_MS = 15_000
/** Looks ahead more often while guiding somewhere, to catch obstacles on the way. */
const GUIDING_FRAME_MS = 6_000
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

/**
 * What opens the stop screen: something close ahead from the harness sensor (cm, exact), described by
 * the camera (what it is, which way to step around it), a danger the camera saw at any distance, or
 * stairs/a drop-off within 1 metre.
 */
export type Obstacle = {
  cm?: number
  speak: string | null
  seen?: SeenObstacle | null
  avoid?: Avoid | null
  danger?: string | null
  /** Set when the danger is stairs or a drop-off. */
  drop?: SeenObstacle | null
  at: number
}

/** After "I'm clear", the same danger (e.g. a red light while waiting) doesn't stop the walker again this soon. */
const DANGER_SNOOZE_MS = 20_000
/** While stairs or a drop-off are ahead but not yet close, look again this soon (not every 6-15 s). */
const DROP_RECHECK_MS = 500

/**
 * Things that stop Sighty warning about what's ahead during a walk. Each is said once when it starts
 * and once when it's fixed, so silence never hides a broken camera or sensor.
 */
export type Problem = 'server' | 'camera' | 'view' | 'sensor'
export type ProblemNews = { problem: Problem; lost: boolean; text: string }
const PROBLEM_TEXT: Record<Problem, [lost: string, back: string]> = {
  server: ['Lost connection. I can’t warn you about what’s ahead, only the sensor’s beeps work. Go carefully.', 'Connected again.'],
  camera: ['The camera isn’t working, so I can’t see what’s ahead. Go carefully.', 'The camera is working again.'],
  view: ['I can’t see the path ahead. Hold your phone up with the camera facing forward, and check nothing covers it.', 'I can see ahead again.'],
  sensor: ['Sensor disconnected. I’m only using the camera now. Go carefully.', 'Sensor connected again.'],
}
/** A lost connection or sensor has to last this long before it's said, so short blips stay quiet. */
const LINK_GRACE_MS = 5_000
/** Camera looks in a row that fail, or can't see ahead, before it's said. */
const BAD_LOOKS = 2

/** "You're at 123 Main Street, next to Tim Hortons. You're facing north-east." */
export function whereText(where: { address: string | null; place: string | null }, facing: number | null) {
  const w = { address: where.address && speakable(where.address), place: where.place }
  // "at 123 Main Street", but "on Main Street" without a house number.
  const street = w.address && `${/^\d/.test(w.address) ? 'at' : 'on'} ${w.address}`
  const at = street && w.place ? `You’re ${street}, next to ${w.place}.`
    : street ? `You’re ${street}.`
    : w.place ? `You’re next to ${w.place}.`
    : 'I couldn’t find the address here.'
  return facing === null ? at : `${at} You’re facing ${compassWord(facing)}.`
}

export type WalkSummary = { seconds: number; alerts: number; metres: number; spotted: string[] }

function locationError(e: GeolocationPositionError) {
  return new Error(e.code === e.PERMISSION_DENIED
    ? 'Location access isn’t allowed. Turn it on for this site in your phone’s settings.'
    : 'I couldn’t find where you are. Try again near a window or outside.')
}

export type WalkSession = ReturnType<typeof useWalkSession>

export function useWalkSession(link: LiveLink) {
  const video = useRef<HTMLVideoElement | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const walkId = useRef<string | null>(null)
  const location = useRef<LatLng | undefined>(undefined)
  const lastFix = useRef<LatLng | undefined>(undefined)
  const frameInFlight = useRef(false)
  /** The walk being started, so a second start() waits for it instead of starting another. */
  const starting = useRef<Promise<string | null> | null>(null)
  const onAlertRef = useRef<((a: Alert, trigger: FrameTrigger) => void) | null>(null)
  const onNavRef = useRef<((e: NavEvent) => void) | null>(null)
  const onProblemRef = useRef<((news: ProblemNews) => void) | null>(null)
  const problems = useRef(new Set<Problem>())
  const badLooks = useRef(0)
  const badViews = useRef(0)
  const guide = useRef<Navigator | null>(null)
  /** Compass heading the phone's camera faces, and the GPS direction of travel while walking. */
  const compass = useRef<number | null>(null)
  const course = useRef<number | null>(null)
  const rerouting = useRef(false)
  const dismissedDanger = useRef<{ danger: string; at: number } | null>(null)

  const [active, setActive] = useState(false)
  const [hasCamera, setHasCamera] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [lastAlert, setLastAlert] = useState<string | null>(null)
  // Urgency of the latest camera look, so Guide mode can show hazards the harness didn't feel.
  const [urgency, setUrgency] = useState<Alert['urgency']>('low')
  const [obstacle, setObstacle] = useState<Obstacle | null>(null)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [endedAt, setEndedAt] = useState<number | null>(null)
  const [alerts, setAlerts] = useState(0)
  const [walked, setWalked] = useState(0)
  const [spotted, setSpotted] = useState<string[]>([])
  const [route, setRouteState] = useState<Route | null>(null)
  const [nav, setNav] = useState<NavStatus | null>(null)

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

  /** Turns the camera off (its light goes out). requestMedia turns it back on. */
  const releaseCamera = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
    if (video.current) video.current.srcObject = null
    setHasCamera(false)
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
      // Keep the camera stream (the app turns it off on screens that don't use it); a mic-only
      // permission check can be released.
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

  /** Where to guide the walker (null = just walk). Set before Guide mode starts. */
  const setRoute = useCallback((r: Route | null) => {
    guide.current = r ? new Navigator(r) : null
    setRouteState(r)
    setNav(guide.current ? { ...guide.current.status } : null)
  }, [])

  /** Which way the walker faces: the compass, or the way they're walking. null = not known yet. */
  const facing = useCallback(() => compass.current ?? course.current, [])

  /** The current GPS position (asks for location access the first time). */
  const locate = useCallback(() => new Promise<LatLng>((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('This phone can’t share its location here. Open the app with an https:// link.'))
      return
    }
    navigator.geolocation.getCurrentPosition((pos) => {
      const here = { lat: pos.coords.latitude, lng: pos.coords.longitude }
      location.current = here
      resolve(here)
    }, (e) => reject(locationError(e)), { enableHighAccuracy: true, timeout: 15_000, maximumAge: 10_000 })
  }), [])

  /** Off the route: tell the walker, then ask Google for a new way to the same place. */
  const reroute = useCallback(async (here: LatLng, news: NavEvent) => {
    const old = guide.current
    if (!old || rerouting.current) return
    rerouting.current = true
    onNavRef.current?.(news)
    try {
      const { location: to, name, address } = old.route.destination
      const next = await api.route({ ...to, name, address }, here)
      if (guide.current !== old) return // walk ended or a new destination meanwhile
      setRoute(next)
      onNavRef.current?.({ kind: 'turn', priority: 2, text: `New route. ${guide.current!.startText(facing())}` })
    } catch {
      onNavRef.current?.({ kind: 'offroute', priority: 1, text: 'I couldn’t find a new route yet. I’ll keep trying.' })
    } finally {
      rerouting.current = false
    }
  }, [setRoute, facing])

  /** What Guide mode says when asked "repeat", "how far" or "which way" (null = no destination). */
  const navText = useCallback((ask: 'start' | 'next' | 'far' | 'way') => {
    const g = guide.current
    if (!g) return null
    return ask === 'start' ? g.startText(facing()) : g.describe(ask, facing(), location.current)
  }, [facing])

  /** Starts or ends a problem; says so only when that changes. */
  const report = useCallback((problem: Problem, on: boolean) => {
    const set = problems.current
    if (on === set.has(problem)) return
    // While the server can't be reached, camera and sensor trouble is part of that: don't pile on.
    if (on && problem !== 'server' && set.has('server')) return
    if (on) set.add(problem)
    else set.delete(problem)
    if (problem === 'server' && on) ['camera', 'view', 'sensor'].forEach((p) => set.delete(p as Problem))
    if (problem === 'server' && !on) badLooks.current = 0 // looks that failed while offline don't count
    onProblemRef.current?.({ problem, lost: on, text: PROBLEM_TEXT[problem][on ? 0 : 1] })
  }, [])

  /** A camera look that failed: no picture, or no answer from the server. */
  const badLook = useCallback(() => {
    if (++badLooks.current >= BAD_LOOKS) report('camera', true)
  }, [report])

  /** Sends the current frame and returns what Sighty says about it. */
  const describe = useCallback(async (trigger: FrameTrigger): Promise<Alert | null> => {
    if (!walkId.current || frameInFlight.current) return null
    const canvas = grabFrame(video.current)
    if (!canvas) {
      // No picture while the camera is on screen: the camera stopped (e.g. another app took it).
      if (video.current && trigger === 'periodic') badLook()
      return null
    }
    if (stream.current?.getVideoTracks()[0]?.readyState === 'ended') {
      badLook()
      return null
    }
    frameInFlight.current = true
    try {
      const image = canvas.toDataURL('image/jpeg', JPEG_QUALITY).split(',')[1]
      const { alert } = await api.sendFrame(walkId.current, image, trigger, location.current)
      badLooks.current = 0
      report('camera', false)
      badViews.current = alert.view && alert.view !== 'ok' ? badViews.current + 1 : 0
      report('view', badViews.current >= BAD_LOOKS)
      setLastAlert(alert.speak)
      setUrgency(alert.urgency)
      note(alert.speak)
      if (alert.urgency !== 'low') setAlerts((n) => n + 1)
      // Only the harness sensor and dangers (red light, traffic…) open the stop screen. Things the
      // camera sees in the way are spoken with how to get around them (Guide mode's onAlert).
      // Harness-triggered frames are handled by the harness handler below.
      const snoozed = dismissedDanger.current
      const danger = alert.danger && !(snoozed?.danger.toLowerCase() === alert.danger.toLowerCase()
        && Date.now() - snoozed.at < DANGER_SNOOZE_MS) ? alert.danger : null
      if (danger && trigger !== 'obstacle') {
        setObstacle({ speak: alert.speak, seen: alert.obstacle, avoid: alert.avoid, danger, drop: alert.drop, at: Date.now() })
      } else onAlertRef.current?.(alert, trigger)
      // Stairs or a drop-off further away: keep checking so the stop comes at about 1 metre.
      if (alert.drop && !danger) setTimeout(() => void describe('periodic'), DROP_RECHECK_MS)
      return alert
    } catch (e) {
      console.warn('frame failed', e)
      badLook()
      return null
    } finally {
      frameInFlight.current = false
    }
  }, [note, report, badLook])

  const startWalk = useCallback(async (): Promise<string | null> => {
    setStatus('Starting…')
    if (!stream.current && !DEMO) await requestMedia({ video: true })
    try {
      const { id } = DEMO ? { id: 'demo' } : await api.startWalk()
      walkId.current = id
      problems.current.clear()
      badLooks.current = 0
      badViews.current = 0
      // A walk without a fresh destination (e.g. from Read text) drops the last trip's route.
      if (!guide.current) setRoute(null)
      setActive(true)
      setStartedAt(Date.now())
      setEndedAt(null)
      setAlerts(0)
      setWalked(0)
      setSpotted([])
      setUrgency('low')
      setStatus(null)
      return id
    } catch (e) {
      setStatus(`Couldn’t reach the server: ${errorText(e)}`)
      return null
    }
  }, [requestMedia, setRoute])

  /** Starts a walk on the server (camera, GPS and wake lock come with it). Safe to call twice, even at once. */
  const start = useCallback(async () => {
    if (walkId.current) return walkId.current
    if (!starting.current) starting.current = startWalk().finally(() => { starting.current = null })
    return starting.current
  }, [startWalk])

  const end = useCallback(async (): Promise<WalkSummary> => {
    const id = walkId.current
    walkId.current = null
    // Stop guiding; the route stays for the trip summary.
    guide.current = null
    setActive(false)
    setEndedAt(Date.now())
    if (id && !DEMO) await api.endWalk(id).catch(() => {})
    return { seconds: startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0, alerts, metres: Math.round(walked), spotted }
  }, [startedAt, alerts, walked, spotted])

  /**
   * Spoken (audio) or typed question with a camera frame. Starts a walk first if needed.
   * Pass `frame` to send a frame already grabbed (the camera may be gone after awaiting the walk).
   */
  const ask = useCallback(async (audio: Blob | string, frame?: HTMLCanvasElement | null) => {
    if (DEMO) {
      const res = await demoAnswer(typeof audio === 'string' ? audio : '')
      note(res.alert.speak)
      return res
    }
    const id = walkId.current ?? (await start())
    if (!id) throw new Error('Not connected to the server')
    const canvas = frame ?? grabFrame(video.current)
    const image = canvas ? await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', JPEG_QUALITY)) : null
    const res = await api.askQuestion(id, audio, image, location.current)
    if (image) setUrgency(res.alert.urgency)
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
      const { heading, speed } = pos.coords
      // GPS only knows the direction of travel while moving.
      course.current = speed !== null && speed > 0.6 && heading !== null && !Number.isNaN(heading) ? heading : null

      const g = guide.current
      if (!g) return
      const news = g.update({ here, accuracy: pos.coords.accuracy, course: course.current, facing: compass.current })
      setNav({ ...g.status })
      if (news?.kind === 'offroute') void reroute(here, news)
      else if (news) onNavRef.current?.(news)
    }, () => {}, { enableHighAccuracy: true, maximumAge: 1000 })

    const onOrientation = (e: DeviceOrientationEvent) => {
      const h = headingFrom(e)
      if (h !== null) compass.current = h
    }
    window.addEventListener('deviceorientationabsolute', onOrientation as EventListener)
    window.addEventListener('deviceorientation', onOrientation)

    setEventHandler(async (e: HarnessEvent) => {
      if (!walkId.current) return
      // Each closer reading updates the distance on the obstacle screen; the camera's view is kept.
      if (e.type === 'obstacle') setObstacle((cur) => ({ ...cur, cm: e.cm, speak: cur?.speak ?? null, at: Date.now() }))
      try {
        const res = await api.harnessEvent(walkId.current, e, location.current)
        if (res.capture_frame) {
          const alert = await describe(e.type)
          if (alert && e.type === 'obstacle') {
            setObstacle((cur) => ({
              cm: cur?.cm ?? e.cm, speak: alert.speak, seen: alert.obstacle, avoid: alert.avoid, danger: alert.danger, drop: alert.drop, at: Date.now(),
            }))
          }
        }
      } catch (err) {
        console.warn('harness event failed', err)
      }
    })

    return () => {
      setEventHandler(null)
      window.removeEventListener('deviceorientationabsolute', onOrientation as EventListener)
      window.removeEventListener('deviceorientation', onOrientation)
      document.removeEventListener('visibilitychange', keepAwake)
      wakeLock?.release().catch(() => {})
      if (watchId !== undefined) navigator.geolocation.clearWatch(watchId)
    }
  }, [active, describe, setEventHandler, reroute])

  // Lost connection or sensor, said after a short grace period so blips stay quiet.
  const { serverOnline, harnessOnline, harnessId } = link
  useEffect(() => {
    if (!active || DEMO) return
    if (serverOnline === false) {
      const t = setTimeout(() => report('server', true), LINK_GRACE_MS)
      return () => clearTimeout(t)
    }
    report('server', false)
    // A sensor only counts as lost if one is paired (the server tells us which).
    if (!harnessId || harnessOnline !== false) return void report('sensor', false)
    const t = setTimeout(() => report('sensor', true), LINK_GRACE_MS)
    return () => clearTimeout(t)
  }, [active, serverOnline, harnessOnline, harnessId, report])

  /** "Where am I?": street address, nearest place and (during a walk) which way they face. Never throws. */
  const whereAmI = useCallback(async () => {
    if (DEMO) return whereText({ address: '100 Queen Street West', place: 'City Hall' }, 45)
    let here: LatLng
    try {
      here = active && location.current ? location.current : await locate()
    } catch (e) {
      return errorText(e) // already says what to do, e.g. turn location on
    }
    try {
      return whereText(await api.where(here), active ? facing() : null)
    } catch {
      return 'I couldn’t find where you are right now. Try again in a moment.'
    }
  }, [active, locate, facing])

  // A look ahead every few seconds; more often while guiding to a destination.
  const guiding = !!route && !nav?.arrived
  useEffect(() => {
    if (!active || DEMO) return
    const timer = setInterval(() => describe('periodic'), guiding ? GUIDING_FRAME_MS : PERIODIC_FRAME_MS)
    return () => clearInterval(timer)
  }, [active, guiding, describe])

  /** Called with turn-by-turn news while guiding to a destination. Stable across renders. */
  const onNav = useCallback((fn: ((e: NavEvent) => void) | null) => {
    onNavRef.current = fn
  }, [])

  /** Called when the camera, sensor or connection stops or starts working again. Stable across renders. */
  const onProblem = useCallback((fn: ((news: ProblemNews) => void) | null) => {
    onProblemRef.current = fn
  }, [])

  /** Called with every alert from a frame, e.g. so Guide mode can speak it. Stable across renders. */
  const onAlert = useCallback((fn: ((a: Alert, trigger: FrameTrigger) => void) | null) => {
    onAlertRef.current = fn
  }, [])

  // Release the camera when the app goes away.
  useEffect(() => () => stream.current?.getTracks().forEach((t) => t.stop()), [])

  return {
    active, hasCamera, status, lastAlert, urgency, obstacle, startedAt, endedAt, alerts, walked, spotted,
    route, nav,
    attachVideo, requestMedia, releaseCamera, start, end, describe, ask, setRoute, locate, navText, whereAmI,
    clearObstacle: () => {
      if (obstacle?.danger) dismissedDanger.current = { danger: obstacle.danger, at: Date.now() }
      setObstacle(null)
      setUrgency('low')
    },
    onAlert, onNav, onProblem,
    /** Mic stream for recording a question (shares the camera's permission prompt when possible). */
    micStream: async () => {
      const audio = stream.current?.getAudioTracks() ?? []
      if (audio.length) return new MediaStream(audio)
      return navigator.mediaDevices.getUserMedia({ audio: true })
    },
  }
}
