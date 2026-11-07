import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../lib/auth';
import { DEV_MODE } from '../lib/config';
import { BigButton, colors, styles } from '../lib/ui';

export default function LoginScreen() {
  const { signIn, register } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(action: typeof signIn) {
    setBusy(true);
    setError(null);
    try {
      await action(email.trim(), password);
      // The root layout's auth guard moves us to /setup once `user` is set.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.screen}>
        <Text style={styles.title} accessibilityRole="header">GuideSight</Text>
        {DEV_MODE && <Text style={styles.body}>Dev mode: any email and password will work.</Text>}

        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={colors.muted}
          accessibilityLabel="Email"
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor={colors.muted}
          accessibilityLabel="Password"
          secureTextEntry
          autoComplete="password"
          value={password}
          onChangeText={setPassword}
        />
        {error && (
          <Text style={[styles.body, { color: colors.danger }]} accessibilityLiveRegion="assertive">
            {error}
          </Text>
        )}

        <BigButton label="Sign in" disabled={busy} onPress={() => submit(signIn)} />
        <BigButton label="Create account" variant="secondary" disabled={busy} onPress={() => submit(register)} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
