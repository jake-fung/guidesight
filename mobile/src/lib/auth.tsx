import AsyncStorage from '@react-native-async-storage/async-storage';
import { initializeApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  getReactNativePersistence,
  initializeAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  type Auth,
} from 'firebase/auth';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { DEV_MODE, firebaseConfig } from './config';

type User = { uid: string; email: string | null };

type AuthState = {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

let auth: Auth | null = null;
if (!DEV_MODE) {
  auth = initializeAuth(initializeApp(firebaseConfig), {
    persistence: getReactNativePersistence(AsyncStorage),
  });
}

/** Firebase ID token for `Authorization: Bearer ...`. The Flask server verifies it. */
export async function getIdToken(): Promise<string> {
  if (DEV_MODE) return 'dev-token';
  const token = await auth?.currentUser?.getIdToken();
  if (!token) throw new Error('Not signed in');
  return token;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(!DEV_MODE);

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, (u) => {
      setUser(u ? { uid: u.uid, email: u.email } : null);
      setLoading(false);
    });
  }, []);

  const value: AuthState = {
    user,
    loading,
    async signIn(email, password) {
      if (!auth) return setUser({ uid: 'dev-user', email });
      await signInWithEmailAndPassword(auth, email, password);
    },
    async register(email, password) {
      if (!auth) return setUser({ uid: 'dev-user', email });
      await createUserWithEmailAndPassword(auth, email, password);
    },
    async signOut() {
      if (!auth) return setUser(null);
      await fbSignOut(auth);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
