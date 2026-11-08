import { getIdToken } from './auth'

/** Blank = same origin. In dev, Vite proxies /api to the Flask server (vite.config.ts). */
export const API_URL = import.meta.env.VITE_API_URL ?? ''

export type LatLng = { lat: number; lng: number }

// ---- Dashboard ----------------------------------------------------------------
export type StopPoint = { walk_id: string; type: 'stop' | 'pull' | 'obstacle'; at: string; lat: number; lng: number }
export type Hotspot = { lat: number; lng: number; count: number }
export type WalkStat = {
  id: string
  started_at: string
  minutes: number
  stops: number
  pulls: number
  obstacles: number
  fatigue: number | null
}
export type Summary = { walks: WalkStat[]; stops: StopPoint[]; hotspots: Hotspot[] }

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
}
export type HarnessEventType = 'stop' | 'pull' | 'obstacle'
/** obstacle comes from the UNO R4's ultrasonic sensor (cm); stop/pull from a motion sensor (accel). */
export type HarnessEvent = { type: HarnessEventType; cm?: number; accel?: number; ms?: number }
export type FrameTrigger = HarnessEventType | 'periodic' | 'manual'

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${await getIdToken()}`)
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')

  const res = await fetch(`${API_URL}/api${path}`, { ...init, headers })
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} failed: ${res.status}`)
  return res.json() as Promise<T>
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

export const api = {
  summary: () => request<Summary>('/dashboard/summary'),
  /** Mock-mode server only: generates demo walks. */
  seedDemo: () => post('/dev/seed'),

  getSettings: () => request<Settings>('/settings'),
  saveSettings: (s: Partial<Settings>) => request<Settings>('/settings', { method: 'PUT', body: JSON.stringify(s) }),

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
}

/** WebSocket URL for a server path, on the same host as the API. */
export function socketUrl(path: string) {
  const base = API_URL || window.location.origin
  return `${base.replace(/^http/, 'ws')}/api${path}`
}
