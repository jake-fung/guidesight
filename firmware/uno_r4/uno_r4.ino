// GuideSight harness firmware for the Arduino UNO R4 WiFi.
// Alternative to firmware/src/main.cpp (ESP32 + MPU6050). Uses an HC-SR04 ultrasonic
// sensor to detect obstacles ahead and an active buzzer for feedback.
//
// Speaks the same BLE contract as the ESP32 (firmware/include/ble_protocol.h):
//   harness -> phone (notify): {"type":"obstacle","cm":85}
//   phone -> harness (write):  "short" | "double" | "long"
//
// Wiring (UNO R4 runs at 5 V, so the HC-SR04 connects directly, no resistors):
//   HC-SR04 VCC -> 5V    GND -> GND    TRIG -> D9    ECHO -> D10
//   Buzzer  +   -> 3.3V  -   -> GND    S    -> D8
//
// Build: Arduino IDE, board "Arduino UNO R4 WiFi", library "ArduinoBLE" (Library Manager).

#include <ArduinoBLE.h>

// Keep in sync with firmware/include/ble_protocol.h
#define DEVICE_NAME       "GuideSight-Harness"
#define SERVICE_UUID      "6e8a0001-4b1c-4f5e-9c2a-7d3f1a2b3c4d"
#define EVENT_CHAR_UUID   "6e8a0002-4b1c-4f5e-9c2a-7d3f1a2b3c4d"
#define COMMAND_CHAR_UUID "6e8a0003-4b1c-4f5e-9c2a-7d3f1a2b3c4d"

// ---- Pins -------------------------------------------------------------------
constexpr int TRIG_PIN = 9;
constexpr int ECHO_PIN = 10;
constexpr int BUZZER_PIN = 8;

// ---- Tuning -----------------------------------------------------------------
constexpr long OBSTACLE_CM = 150;           // send an event when something comes closer than this
constexpr long CLEAR_CM = 200;              // ...and re-arm once it's farther than this (hysteresis)
constexpr long BEEP_CM = 200;               // local proximity beeping range
constexpr uint32_t EVENT_COOLDOWN_MS = 3000;
constexpr uint32_t SAMPLE_MS = 60;          // HC-SR04 needs ~60 ms between pings

BLEService harnessService(SERVICE_UUID);
BLECharacteristic eventChar(EVENT_CHAR_UUID, BLENotify, 64);
BLECharacteristic commandChar(COMMAND_CHAR_UUID, BLEWrite | BLEWriteWithoutResponse, 16);

bool armed = true;
uint32_t lastEventAt = 0;
uint32_t nextBeepAt = 0;

// ---- Sensor -----------------------------------------------------------------
long readDistanceCm() {
  digitalWrite(TRIG_PIN, LOW);  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH); delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  long us = pulseIn(ECHO_PIN, HIGH, 30000);  // 30 ms timeout (~5 m)
  if (us == 0) return -1;                    // nothing in range
  return us / 58;                            // microseconds -> cm
}

// ---- Haptics / buzzer ---------------------------------------------------------
void pulse(int ms) {
  digitalWrite(BUZZER_PIN, HIGH); delay(ms); digitalWrite(BUZZER_PIN, LOW);
}

void buzz(const String& pattern) {
  if (pattern == "long") {
    pulse(600);
  } else if (pattern == "double") {
    pulse(150); delay(120); pulse(150);
  } else {
    pulse(120);
  }
}

// ---- BLE ----------------------------------------------------------------------
void sendEvent(long cm) {
  char json[48];
  snprintf(json, sizeof(json), "{\"type\":\"obstacle\",\"cm\":%ld}", cm);
  Serial.println(json);
  if (BLE.connected()) eventChar.writeValue((const uint8_t*)json, strlen(json));
}

void handleCommand() {
  if (!commandChar.written()) return;
  String cmd;
  for (int i = 0; i < commandChar.valueLength(); i++) cmd += (char)commandChar.value()[i];
  cmd.trim();
  Serial.print("cmd: "); Serial.println(cmd);
  buzz(cmd);
}

void setupBle() {
  if (!BLE.begin()) {
    Serial.println("BLE failed to start");
    while (true) { pulse(50); delay(500); }
  }
  BLE.setLocalName(DEVICE_NAME);
  BLE.setDeviceName(DEVICE_NAME);
  BLE.setAdvertisedService(harnessService);
  harnessService.addCharacteristic(eventChar);
  harnessService.addCharacteristic(commandChar);
  BLE.addService(harnessService);
  BLE.advertise();
  Serial.println("BLE advertising as " DEVICE_NAME);
}

// ---- Main -------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  setupBle();
  buzz("short");  // power-on confirmation
}

void loop() {
  BLE.poll();
  handleCommand();

  static uint32_t lastSample = 0;
  uint32_t now = millis();
  if (now - lastSample < SAMPLE_MS) return;
  lastSample = now;

  long cm = readDistanceCm();

  // Phone event: fire once when something comes close, re-arm when it's clear again.
  if (cm > 0 && cm < OBSTACLE_CM && armed && now - lastEventAt > EVENT_COOLDOWN_MS) {
    armed = false;
    lastEventAt = now;
    sendEvent(cm);
  } else if (cm < 0 || cm > CLEAR_CM) {
    armed = true;
  }

  // Local proximity beeps: closer = faster. Works even with no phone connected.
  if (cm > 0 && cm < BEEP_CM && now >= nextBeepAt) {
    pulse(40);
    nextBeepAt = now + constrain(map(cm, 20, BEEP_CM, 60, 500), 60, 500);
  }
}
