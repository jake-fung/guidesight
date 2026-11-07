// firebase/auth's type entry points at the web build, but Metro loads the React Native build
// at runtime, which also exports getReactNativePersistence. This declares it for TypeScript.
import 'firebase/auth';
import type { Persistence, ReactNativeAsyncStorage } from 'firebase/auth';

declare module 'firebase/auth' {
  export function getReactNativePersistence(storage: ReactNativeAsyncStorage): Persistence;
}
