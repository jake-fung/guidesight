/**
 * BLE link to the ESP32 harness. UUIDs must match firmware/include/ble_protocol.h.
 * react-native-ble-plx needs a development build (not Expo Go): `npx expo run:ios|android`.
 */
import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, type Device, type Subscription } from 'react-native-ble-plx';

export const DEVICE_NAME = 'GuideSight-Harness';
const SERVICE_UUID = '6e8a0001-4b1c-4f5e-9c2a-7d3f1a2b3c4d';
const EVENT_CHAR_UUID = '6e8a0002-4b1c-4f5e-9c2a-7d3f1a2b3c4d';
const COMMAND_CHAR_UUID = '6e8a0003-4b1c-4f5e-9c2a-7d3f1a2b3c4d';

export type HarnessEventType = 'stop' | 'pull' | 'obstacle';
/** stop/pull come from the MPU6050 (accel); obstacle comes from the HC-SR04 (cm). */
export type HarnessEvent = { type: HarnessEventType; accel?: number; cm?: number; ms?: number };
export type HapticPattern = 'short' | 'double' | 'long';

let manager: BleManager | null = null;
let device: Device | null = null;

function ble() {
  manager ??= new BleManager();
  return manager;
}

async function requestAndroidPermissions() {
  if (Platform.OS !== 'android') return true;
  const result = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
  ]);
  return Object.values(result).every((r) => r === PermissionsAndroid.RESULTS.GRANTED);
}

/** Scan for the harness and connect to the first one found. */
export async function pairHarness(timeoutMs = 10_000): Promise<Device> {
  if (!(await requestAndroidPermissions())) throw new Error('Bluetooth permission denied');

  const found = await new Promise<Device>((resolve, reject) => {
    const timer = setTimeout(() => {
      ble().stopDeviceScan();
      reject(new Error('Harness not found. Is it powered on?'));
    }, timeoutMs);

    ble().startDeviceScan([SERVICE_UUID], null, (error, d) => {
      if (error) {
        clearTimeout(timer);
        return reject(error);
      }
      if (d) {
        clearTimeout(timer);
        ble().stopDeviceScan();
        resolve(d);
      }
    });
  });

  // Larger MTU so JSON events aren't cut off at the 20-byte BLE default (Android).
  device = await found.connect({ requestMTU: 185 });
  await device.discoverAllServicesAndCharacteristics();
  return device;
}

/** Reconnect to a harness paired earlier (id saved in settings.harness_id). */
export async function reconnectHarness(id: string) {
  device = await ble().connectToDevice(id, { requestMTU: 185 });
  await device.discoverAllServicesAndCharacteristics();
  return device;
}

export function isConnected() {
  return device !== null;
}

/** Subscribe to stop/pull (motion sensor) and obstacle (ultrasonic) events. */
export function onHarnessEvent(listener: (e: HarnessEvent) => void): Subscription | null {
  if (!device) return null;
  return device.monitorCharacteristicForService(SERVICE_UUID, EVENT_CHAR_UUID, (error, c) => {
    if (error || !c?.value) return;
    try {
      listener(JSON.parse(atob(c.value)));
    } catch {
      // ignore malformed packets
    }
  });
}

/** Buzz the vibration motor on the harness handle. */
export async function buzz(pattern: HapticPattern) {
  if (!device) return;
  await device.writeCharacteristicWithResponseForService(SERVICE_UUID, COMMAND_CHAR_UUID, btoa(pattern));
}
