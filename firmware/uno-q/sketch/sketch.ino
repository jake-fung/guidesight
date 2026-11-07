// GuideSight harness firmware for the Arduino UNO Q (STM32U585 microcontroller side).
// Same job as firmware/src/main.cpp on the ESP32: read the MPU6050 on the harness handle,
// detect when the dog stops or pulls, and buzz the vibration motor on command.
//
// The UNO Q's Bluetooth radio belongs to its Linux side, so this sketch doesn't do BLE.
// It talks to firmware/uno-q/linux/harness_ble.py through the Router Bridge:
//   sketch -> Linux:  harness_event(type, accel, ms)   type: 0 = stop, 1 = pull
//   Linux -> sketch:  buzz(pattern)                     pattern: 0 = short, 1 = double, 2 = long
//                     set_link(connected)               phone connected or not (drives the LED)

#include <Arduino.h>
#include <Wire.h>
#include <Arduino_RouterBridge.h>

// ---- Pins -------------------------------------------------------------------
constexpr int MOTOR_PIN = 9;  // via transistor/driver, never drive a motor straight from a GPIO
#ifdef LED_BUILTIN
constexpr int LED_PIN = LED_BUILTIN;
#else
constexpr int LED_PIN = -1;
#endif

// ---- Bridge message codes (keep in sync with linux/harness_ble.py) ----------
constexpr int EVENT_STOP = 0;
constexpr int EVENT_PULL = 1;
constexpr int PATTERN_SHORT = 0;
constexpr int PATTERN_DOUBLE = 1;
constexpr int PATTERN_LONG = 2;

// ---- Detection tuning (same values as the ESP32 firmware) -------------------
constexpr float GRAVITY = 9.81f;
constexpr float SMOOTHING = 0.15f;           // low-pass factor for activity level
constexpr float WALKING_ACTIVITY = 0.8f;     // m/s^2, above = dog is walking
constexpr float STOPPED_ACTIVITY = 0.25f;    // m/s^2, below = dog is standing still
constexpr uint32_t STOP_HOLD_MS = 700;       // must stay still this long to count as a stop
constexpr float PULL_SPIKE = 6.0f;           // m/s^2 sudden jerk on the handle
constexpr uint32_t PULL_COOLDOWN_MS = 1500;
constexpr uint32_t SAMPLE_MS = 20;           // 50 Hz

// ---- MPU6050 (raw registers, so no extra library is needed) -----------------
constexpr uint8_t MPU_ADDR = 0x68;
constexpr float ACCEL_SCALE = GRAVITY / 4096.0f;  // +/-8 g range = 4096 LSB per g

enum class Gait { Unknown, Walking, Stopped };
Gait gait = Gait::Unknown;
float activity = 0;
uint32_t stillSince = 0;
uint32_t lastPullAt = 0;

void setLed(bool on) {
  if (LED_PIN >= 0) digitalWrite(LED_PIN, on ? HIGH : LOW);
}

bool mpuWrite(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  Wire.write(value);
  return Wire.endTransmission() == 0;
}

bool mpuBegin() {
  return mpuWrite(0x6B, 0x00)     // PWR_MGMT_1: wake up
      && mpuWrite(0x1C, 0x10)     // ACCEL_CONFIG: +/-8 g
      && mpuWrite(0x1B, 0x08)     // GYRO_CONFIG: +/-500 deg/s
      && mpuWrite(0x1A, 0x04);    // CONFIG: 21 Hz low-pass filter
}

// Returns acceleration magnitude in m/s^2, or -1 if the read failed.
float readAccelMagnitude() {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x3B);  // ACCEL_XOUT_H
  if (Wire.endTransmission(false) != 0) return -1;
  if (Wire.requestFrom(MPU_ADDR, (uint8_t)6) != 6) return -1;

  float axis[3];
  for (float& v : axis) {
    int16_t raw = (Wire.read() << 8) | Wire.read();
    v = raw * ACCEL_SCALE;
  }
  return sqrtf(axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2]);
}

// ---- Haptics ----------------------------------------------------------------
void pulse(int ms) {
  digitalWrite(MOTOR_PIN, HIGH);
  delay(ms);
  digitalWrite(MOTOR_PIN, LOW);
}

void buzz(int pattern) {
  if (pattern == PATTERN_LONG) {
    pulse(600);
  } else if (pattern == PATTERN_DOUBLE) {
    pulse(150); delay(120); pulse(150);
  } else {
    pulse(120);
  }
}

void setLink(bool connected) { setLed(connected); }

void sendEvent(int type, float value) {
  Bridge.notify("harness_event", type, value, (uint32_t)millis());
}

// ---- Motion detection -------------------------------------------------------
void detectMotion() {
  float magnitude = readAccelMagnitude();
  if (magnitude < 0) return;

  float dynamic = fabsf(magnitude - GRAVITY);  // how much the handle is moving
  activity += SMOOTHING * (dynamic - activity);
  uint32_t now = millis();

  // Pull: a sharp spike on the handle (dog lunges or steers hard).
  if (dynamic > PULL_SPIKE && now - lastPullAt > PULL_COOLDOWN_MS) {
    lastPullAt = now;
    sendEvent(EVENT_PULL, dynamic);
  }

  // Stop: dog was walking, then stays still long enough. Guide dogs stop at curbs,
  // stairs and obstacles, so this is the main trigger for a scene description.
  if (activity > WALKING_ACTIVITY) {
    gait = Gait::Walking;
    stillSince = 0;
  } else if (activity < STOPPED_ACTIVITY && gait == Gait::Walking) {
    if (stillSince == 0) stillSince = now;
    if (now - stillSince > STOP_HOLD_MS) {
      gait = Gait::Stopped;
      sendEvent(EVENT_STOP, activity);
    }
  }
}

void setup() {
  pinMode(MOTOR_PIN, OUTPUT);
  if (LED_PIN >= 0) pinMode(LED_PIN, OUTPUT);

  Wire.begin();
  if (!mpuBegin()) {
    // MPU6050 not found: check wiring (SDA/SCL header pins, 3.3V, GND).
    while (true) { setLed(true); delay(200); setLed(false); delay(200); }
  }

  Bridge.begin();  // waits until the Linux side's router is up
  // provide_safe runs these between loop() passes, so digitalWrite/delay are safe here.
  Bridge.provide_safe("buzz", buzz);
  Bridge.provide_safe("set_link", setLink);

  buzz(PATTERN_SHORT);  // power-on confirmation
}

void loop() {
  static uint32_t lastSample = 0;
  if (millis() - lastSample >= SAMPLE_MS) {
    lastSample = millis();
    detectMotion();
  }
}
