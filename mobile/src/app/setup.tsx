import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api, type Settings } from '../lib/api';
import { useAuth } from '../lib/auth';
import { buzz, isConnected, pairHarness, reconnectHarness } from '../lib/harness';
import { BigButton, colors, styles } from '../lib/ui';

const RATES = [0.8, 1.0, 1.2, 1.5];

export default function SetupScreen() {
  const { signOut } = useAuth();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [harnessStatus, setHarnessStatus] = useState(isConnected() ? 'Connected' : 'Not paired');

  useEffect(() => {
    api.getSettings().then((s) => {
      setSettings(s);
      if (s.harness_id && !isConnected()) {
        setHarnessStatus('Reconnecting…');
        reconnectHarness(s.harness_id)
          .then(() => setHarnessStatus('Connected'))
          .catch(() => setHarnessStatus('Not connected. Tap Pair harness.'));
      }
    }).catch((e) => setHarnessStatus(`Server unreachable: ${e.message}`));
  }, []);

  async function update(patch: Partial<Settings>) {
    setSettings((s) => (s ? { ...s, ...patch } : s));
    setSettings(await api.saveSettings(patch));
  }

  async function pair() {
    setHarnessStatus('Searching…');
    try {
      const device = await pairHarness();
      await update({ harness_id: device.id });
      await buzz('double');
      setHarnessStatus('Connected');
    } catch (e) {
      setHarnessStatus(e instanceof Error ? e.message : 'Pairing failed');
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={styles.screen}>
        <Text style={styles.title} accessibilityRole="header">Setup</Text>

        <Text style={styles.body} accessibilityLiveRegion="polite">Harness: {harnessStatus}</Text>
        <BigButton label="Pair harness" variant="secondary" onPress={pair} />

        {settings && (
          <>
            <Text style={[styles.label, { marginTop: 8 }]}>Speech rate: {settings.speech_rate}×</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {RATES.map((r) => (
                <BigButton
                  key={r}
                  label={`${r}×`}
                  variant={settings.speech_rate === r ? 'primary' : 'secondary'}
                  style={{ flex: 1 }}
                  onPress={() => update({ speech_rate: r })}
                />
              ))}
            </View>

            <Row label="Detailed alerts" value={settings.alert_verbosity === 'detailed'}
              onChange={(v) => update({ alert_verbosity: v ? 'detailed' : 'short' })} />
            <Row label="Haptic buzz on harness" value={settings.haptics_enabled}
              onChange={(v) => update({ haptics_enabled: v })} />
            <Row label="Describe scene when dog stops" value={settings.auto_describe_on_stop}
              onChange={(v) => update({ auto_describe_on_stop: v })} />
          </>
        )}

        <BigButton label="Start walk" onPress={() => router.push('/walk')} />
        <BigButton label="Sign out" variant="secondary" onPress={signOut} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 56 }}>
      <Text style={styles.label}>{label}</Text>
      <Switch value={value} onValueChange={onChange} accessibilityLabel={label} />
    </View>
  );
}
