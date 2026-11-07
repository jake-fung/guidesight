import { getIdToken } from './auth';
import { API_URL } from './config';

export type LatLng = { lat: number; lng: number };

export type Alert = {
  speak: string;
  urgency: 'low' | 'medium' | 'high';
  haptic: 'short' | 'double' | 'long' | null;
  speech_rate: number;
};

export type Settings = {
  voice: string;
  speech_rate: number;
  alert_verbosity: 'short' | 'detailed';
  haptics_enabled: boolean;
  harness_id: string | null;
  auto_describe_on_stop: boolean;
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${await getIdToken()}`);
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');

  const res = await fetch(`${API_URL}/api${path}`, { ...init, headers });
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  getSettings: () => request<Settings>('/settings'),
  saveSettings: (s: Partial<Settings>) =>
    request<Settings>('/settings', { method: 'PUT', body: JSON.stringify(s) }),

  startWalk: () => post<{ id: string }>('/walks'),
  endWalk: (walkId: string) => post(`/walks/${walkId}/end`),

  harnessEvent: (walkId: string, type: 'stop' | 'pull', motion: object, location?: LatLng) =>
    post<{ capture_frame: boolean }>(`/walks/${walkId}/harness-event`, { type, motion, location }),

  sendFrame: (walkId: string, imageBase64: string, trigger: string, location?: LatLng) =>
    post<{ alert: Alert }>(`/walks/${walkId}/frame`, { image: imageBase64, trigger, location }),

  askQuestion: (walkId: string, audioUri: string, imageUri?: string, location?: LatLng) => {
    const form = new FormData();
    // React Native's FormData accepts {uri, name, type} file objects.
    form.append('audio', { uri: audioUri, name: 'question.m4a', type: 'audio/m4a' } as any);
    if (imageUri) form.append('image', { uri: imageUri, name: 'frame.jpg', type: 'image/jpeg' } as any);
    if (location) {
      form.append('lat', String(location.lat));
      form.append('lng', String(location.lng));
    }
    return request<{ transcript: string; alert: Alert }>(`/walks/${walkId}/voice`, {
      method: 'POST',
      body: form,
    });
  },
};
