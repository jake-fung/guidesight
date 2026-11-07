// Large, high-contrast controls: most users rely on VoiceOver/TalkBack, so every button
// gets an accessibilityLabel and generous touch targets.
import { Pressable, StyleSheet, Text, type PressableProps } from 'react-native';

export const colors = {
  bg: '#0b0b0f',
  surface: '#1a1a22',
  text: '#ffffff',
  muted: '#a1a1aa',
  accent: '#fbbf24',
  danger: '#ef4444',
};

type ButtonProps = PressableProps & { label: string; variant?: 'primary' | 'secondary' | 'danger' };

export function BigButton({ label, variant = 'primary', style, ...rest }: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      style={(state) => [
        styles.button,
        styles[variant],
        state.pressed && { opacity: 0.7 },
        typeof style === 'function' ? style(state) : style,
      ]}
      {...rest}>
      <Text style={[styles.label, variant === 'primary' && { color: colors.bg }]}>{label}</Text>
    </Pressable>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: 24, gap: 16 },
  title: { color: colors.text, fontSize: 32, fontWeight: '700' },
  body: { color: colors.muted, fontSize: 18 },
  input: {
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 20,
    padding: 16,
    borderRadius: 12,
  },
  button: { minHeight: 64, borderRadius: 16, alignItems: 'center', justifyContent: 'center', padding: 16 },
  primary: { backgroundColor: colors.accent },
  secondary: { backgroundColor: colors.surface },
  danger: { backgroundColor: colors.danger },
  label: { color: colors.text, fontSize: 20, fontWeight: '700' },
});
