import { getToken } from './auth'

/** Blank = same origin. In dev, Vite proxies /api to the Flask server (vite.config.ts). */
export const API_URL = import.meta.env.VITE_API_URL ?? ''

export type LatLng = { lat: number; lng: number }

// ---- Account & first-run setup (server/app/routes/me.py, setup.py) -----------
export type Profile = { name: string | null; email: string | null }
export type PermissionAnswer = 'pending' | 'allowed' | 'skipped'
export type SetupState = {
  camera: PermissionAnswer
  microphone: PermissionAnswer
  sensor: 'pending' | 'connected' | 'skipped'
  completed_at: string | null
}
/** Which screen to show. null = setup is done, go Home. */
export type NextStep = 'name' | 'camera' | 'microphone' | 'sensor' | 'finish' | null
export type Me = { id: string; profile: Profile; setup: SetupState; settings: Settings; next_step: NextStep }
export type SensorSearch = {
  harness_id: string | null
  online: boolean
  nearby: { id: string; same_network: boolean }[]
}

// ---- Walker app ---------------------------------------------------------------
export type HapticPattern = 'short' | 'double' | 'long'
export type Alert = {
  speak: string
  urgency: 'low' | 'medium' | 'high'
  haptic: HapticPattern | null
  speech_rate: number
}
export type Settings = {
  voice: string
  speech_rate: number
  alert_verbosity: 'short' | 'detailed'
  haptics_enabled: boolean
  harness_id: string | null
  auto_describe_on_stop: boolean
  text_size: 'default' | 'large' | 'extra_large'
  high_contrast: boolean
  read_screen_aloud: boolean
  zoom: boolean
  voice_control: boolean
}
export type HarnessEventType = 'stop' | 'pull' | 'obstacle'
/** obstacle comes from the UNO R4's ultrasonic sensor (cm); stop/pull from a motion sensor (accel). */
export type HarnessEvent = { type: HarnessEventType; cm?: number; accel?: number; ms?: number }
export type FrameTrigger = HarnessEventType | 'periodic' | 'manual'

/** Error from the API, with the HTTP status so callers can react to it (e.g. 503 = feature not set up). */
export class ApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function send(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${await getToken()}`)
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')

  const res = await fetch(`${API_URL}/api${path}`, { ...init, headers })
  if (!res.ok) {
    // The server explains errors as {error: "..."}.
    const reason = await res.json().then((b) => b?.error).catch(() => null)
    throw new ApiError(reason ?? `${init.method ?? 'GET'} ${path} failed: ${res.status}`, res.status)
  }
  return res
}

const request = <T>(path: string, init: RequestInit = {}) => send(path, init).then((r) => r.json() as Promise<T>)

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
const put = <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) })

export const api = {
  me: () => request<Me>('/me'),
  saveProfile: (p: Partial<Profile>) => put<Me>('/me', p),
  answerSetup: (step: 'camera' | 'microphone' | 'sensor', status: 'allowed' | 'skipped') =>
    put<Me>(`/setup/${step}`, { status }),
  findSensor: () => request<SensorSearch>('/setup/sensor'),
  pairSensor: (harnessId: string) =>
    post<{ harness_id: string; buzzed: boolean; me: Me }>('/setup/sensor', { harness_id: harnessId }),
  completeSetup: () => post<Me>('/setup/complete'),

  getSettings: () => request<Settings>('/settings'),
  saveSettings: (s: Partial<Settings>) => put<Settings>('/settings', s),

  harnessStatus: () => request<{ harness_id: string | null; online: boolean }>('/harness/status'),
  buzz: (pattern: HapticPattern) => post<{ delivered: boolean }>('/harness/buzz', { pattern }),

  startWalk: () => post<{ id: string }>('/walks'),
  endWalk: (walkId: string) => post(`/walks/${walkId}/end`),

  harnessEvent: (walkId: string, e: HarnessEvent, location?: LatLng) => {
    const motion = e.type === 'obstacle' ? { cm: e.cm } : { accel: e.accel }
    return post<{ capture_frame: boolean }>(`/walks/${walkId}/harness-event`, { type: e.type, motion, location })
  },

  sendFrame: (walkId: string, imageBase64: string, trigger: FrameTrigger, location?: LatLng) =>
    post<{ alert: Alert }>(`/walks/${walkId}/frame`, { image: imageBase64, trigger, location }),

  /** Spoken (audio) or typed (string) question about the current frame. */
  askQuestion: (walkId: string, audio: Blob | string, image: Blob | null, location?: LatLng) => {
    const form = new FormData()
    if (typeof audio === 'string') form.append('question', audio)
    else form.append('audio', audio, `question.${audio.type.includes('mp4') ? 'm4a' : 'webm'}`)
    if (image) form.append('image', image, 'frame.jpg')
    if (location) {
      form.append('lat', String(location.lat))
      form.append('lng', String(location.lng))
    }
    return request<{ transcript: string; alert: Alert }>(`/walks/${walkId}/voice`, { method: 'POST', body: form })
  },

  /** Alert text as an MP3 clip in the ElevenLabs voice. 503 = the server has no ElevenLabs key. */
  speech: (text: string, speed: number, signal?: AbortSignal) =>
    send('/tts', { method: 'POST', body: JSON.stringify({ text, speed }), signal }).then((r) => r.blob()),
}

/** WebSocket URL for a server path, on the same host as the API. */
export function socketUrl(path: string) {
  const base = API_URL || window.location.origin
  return `${base.replace(/^http/, 'ws')}/api${path}`
}
