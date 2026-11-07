/**
 * Live Walk: the camera streams frames to Flask (on every dog stop + every PERIODIC_FRAME_MS),
 * the mic records push-to-talk questions, and alerts come back as speech + harness haptics.
 */
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api, type LatLng } from '../lib/api';
import { PERIODIC_FRAME_MS } from '../lib/config';
import { onHarnessEvent } from '../lib/harness';
import { deliverAlert } from '../lib/speak';
import { BigButton, colors, styles } from '../lib/ui';

export default function WalkScreen() {
  const camera = useRef<CameraView>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  const walkId = useRef<string | null>(null);
  const location = useRef<LatLng | undefined>(undefined);
  const frameInFlight = useRef(false);
  const [recording, setRecording] = useState(false);
  const [lastAlert, setLastAlert] = useState('Starting walk…');

  /** Grab a frame and ask the server what's ahead. Skips if a frame is already in flight. */
  const describe = useCallback(async (trigger: 'stop' | 'pull' | 'periodic' | 'manual') => {
    if (!walkId.current || !camera.current || frameInFlight.current) return;
    frameInFlight.current = true;
    try {
      const photo = await camera.current.takePictureAsync({ base64: true, quality: 0.4, shutterSound: false });
      if (!photo?.base64) return;
      const { alert } = await api.sendFrame(walkId.current, photo.base64, trigger, location.current);
      setLastAlert(alert.speak);
      await deliverAlert(alert);
    } catch (e) {
      console.warn('frame failed', e);
    } finally {
      frameInFlight.current = false;
    }
  }, []);

  // Start the walk, location tracking, harness events and the periodic frame timer.
  useEffect(() => {
    let locationSub: Location.LocationSubscription | undefined;
    const harnessSub = onHarnessEvent(async (e) => {
      if (!walkId.current) return;
      const res = await api.harnessEvent(walkId.current, e.type, { accel: e.accel }, location.current);
      if (res.capture_frame) describe(e.type);
    });
    const timer = setInterval(() => describe('periodic'), PERIODIC_FRAME_MS);

    (async () => {
      await requestCameraPermission();
      await requestRecordingPermissionsAsync();
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      const { id } = await api.startWalk();
      walkId.current = id;
      setLastAlert('Walk started');

      if ((await Location.requestForegroundPermissionsAsync()).granted) {
        locationSub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, distanceInterval: 5 },
          (pos) => (location.current = { lat: pos.coords.latitude, lng: pos.coords.longitude }),
        );
      }
    })().catch((e) => setLastAlert(`Could not start walk: ${e.message}`));

    return () => {
      clearInterval(timer);
      harnessSub?.remove();
      locationSub?.remove();
    };
  }, [describe, requestCameraPermission]);

  // Push-to-talk voice questions ("which bus is this?").
  // TODO: hands-free wake word / voice activity detection instead of holding a button.
  async function startQuestion() {
    await recorder.prepareToRecordAsync();
    recorder.record();
    setRecording(true);
  }

  async function sendQuestion() {
    setRecording(false);
    await recorder.stop();
    if (!walkId.current || !recorder.uri) return;
    try {
      const photo = await camera.current?.takePictureAsync({ quality: 0.4, shutterSound: false });
      const { transcript, alert } = await api.askQuestion(walkId.current, recorder.uri, photo?.uri, location.current);
      setLastAlert(`“${transcript}” — ${alert.speak}`);
      await deliverAlert(alert);
    } catch (e) {
      setLastAlert(`Question failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  async function endWalk() {
    if (walkId.current) await api.endWalk(walkId.current).catch(() => {});
    router.back();
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.screen}>
        <View style={{ flex: 1, borderRadius: 16, overflow: 'hidden', backgroundColor: colors.surface }}>
          {cameraPermission?.granted ? (
            <CameraView ref={camera} style={{ flex: 1 }} facing="back" />
          ) : (
            <Text style={[styles.body, { padding: 16 }]}>Camera permission needed.</Text>
          )}
        </View>

        <Text style={styles.label} accessibilityLiveRegion="polite">{lastAlert}</Text>

        <BigButton
          label={recording ? 'Listening… release to ask' : 'Hold to ask a question'}
          onPressIn={startQuestion}
          onPressOut={sendQuestion}
          style={{ minHeight: 120 }}
        />
        <BigButton label="Describe what's ahead" variant="secondary" onPress={() => describe('manual')} />
        <BigButton label="End walk" variant="danger" onPress={endWalk} />
      </View>
    </SafeAreaView>
  );
}
