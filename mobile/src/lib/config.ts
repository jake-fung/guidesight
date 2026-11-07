export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:5001';

export const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? '',
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? '',
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? '',
};

/** No Firebase config -> dev mode: fake login, server must also be in mock mode. */
export const DEV_MODE = !firebaseConfig.apiKey;

/** How often to send a routine frame while walking, in addition to stop-triggered ones. */
export const PERIODIC_FRAME_MS = 15_000;
