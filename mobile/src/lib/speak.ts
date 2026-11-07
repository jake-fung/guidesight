import * as Speech from 'expo-speech';

import type { Alert } from './api';
import { buzz } from './harness';

/** Spoken alert through the earbuds + haptic buzz on the harness. */
export async function deliverAlert(alert: Alert) {
  if (!alert.speak) return;
  // Urgent alerts interrupt whatever is being said.
  if (alert.urgency === 'high') await Speech.stop();
  Speech.speak(alert.speak, { rate: alert.speech_rate });
  if (alert.haptic) buzz(alert.haptic).catch(() => {});
}
