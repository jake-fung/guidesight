// GuideSight harness firmware.
// Reads the MPU6050 on the dog's harness handle, detects when the dog stops or pulls,
// notifies the phone over BLE, and buzzes the vibration motor on command.

#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLE2902.h>

#include "ble_protocol.h"

// ---- Pins -------------------------------------------------------------------
constexpr int MOTOR_PIN = 25;  // via transistor/driver, never drive a motor straight from a GPIO
constexpr int LED_PIN = 2;

// ---- Detection tuning (TODO: calibrate on a real harness) -------------------
constexpr float GRAVITY = 9.81f;
constexpr float SMOOTHING = 0.15f;           // low-pass factor for activity level
constexpr float WALKING_ACTIVITY = 0.8f;     // m/s^2, above = dog is walking
constexpr float STOPPED_ACTIVITY = 0.25f;    // m/s^2, below = dog is standing still
constexpr uint32_t STOP_HOLD_MS = 700;       // must stay still this long to count as a stop
constexpr float PULL_SPIKE = 6.0f;           // m/s^2 sudden jerk on the handle
constexpr uint32_t PULL_COOLDOWN_MS = 1500;
constexpr uint32_t SAMPLE_MS = 20;           // 50 Hz

Adafruit_MPU6050 mpu;
BLECharacteristic* eventChar = nullptr;
bool phoneConnected = false;

enum class Gait { Unknown, Walking, Stopped };
Gait gait = Gait::Unknown;
float activity = 0;
uint32_t stillSince = 0;
uint32_t lastPullAt = 0;

// ---- Haptics ----------------------------------------------------------------
void buzz(const String& pattern) {
  auto pulse = [](int ms) { digitalWrite(MOTOR_PIN, HIGH); delay(ms); digitalWrite(MOTOR_PIN, LOW); };
  if (pattern == "long") {
    pulse(600);
  } else if (pattern == "double") {
    pulse(150); delay(120); pulse(150);
  } else {
    pulse(120);
  }
}

// ---- BLE --------------------------------------------------------------------
class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer*) override { phoneConnected = true; digitalWrite(LED_PIN, HIGH); }
  void onDisconnect(BLEServer* server) override {
    phoneConnected = false;
    digitalWrite(LED_PIN, LOW);
    server->getAdvertising()->start();  // let the phone reconnect
  }
};

class CommandCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    String cmd = String(c->getValue().c_str());
    cmd.trim();
    Serial.printf("cmd: %s\n", cmd.c_str());
    buzz(cmd);  // TODO: move off the BLE callback task if patterns get long
  }
};

void sendEvent(const char* type, float value) {
  char json[96];
  snprintf(json, sizeof(json), "{\"type\":\"%s\",\"accel\":%.2f,\"ms\":%lu}", type, value, millis());
  Serial.println(json);
  if (!phoneConnected) return;
  eventChar->setValue((uint8_t*)json, strlen(json));
  eventChar->notify();
}

void setupBle() {
  BLEDevice::init(DEVICE_NAME);
  BLEServer* server = BLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());
  BLEService* service = server->createService(SERVICE_UUID);

  eventChar = service->createCharacteristic(EVENT_CHAR_UUID, BLECharacteristic::PROPERTY_NOTIFY);
  eventChar->addDescriptor(new BLE2902());

  BLECharacteristic* cmdChar = service->createCharacteristic(
      COMMAND_CHAR_UUID, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  cmdChar->setCallbacks(new CommandCallbacks());

  service->start();
  BLEAdvertising* adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(SERVICE_UUID);
  adv->setScanResponse(true);
  BLEDevice::startAdvertising();
  Serial.println("BLE advertising as " DEVICE_NAME);
}

// ---- Motion detection -------------------------------------------------------
void detectMotion() {
  sensors_event_t a, g, temp;
  mpu.getEvent(&a, &g, &temp);

  float magnitude = sqrtf(a.acceleration.x * a.acceleration.x +
                          a.acceleration.y * a.acceleration.y +
                          a.acceleration.z * a.acceleration.z);
  float dynamic = fabsf(magnitude - GRAVITY);  // how much the handle is moving
  activity += SMOOTHING * (dynamic - activity);
  uint32_t now = millis();

  // Pull: a sharp spike on the handle (dog lunges or steers hard).
  if (dynamic > PULL_SPIKE && now - lastPullAt > PULL_COOLDOWN_MS) {
    lastPullAt = now;
    sendEvent("pull", dynamic);
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
      sendEvent("stop", activity);
    }
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(MOTOR_PIN, OUTPUT);
  pinMode(LED_PIN, OUTPUT);

  if (!mpu.begin()) {
    Serial.println("MPU6050 not found, check wiring (SDA=21, SCL=22)");
    while (true) { digitalWrite(LED_PIN, !digitalRead(LED_PIN)); delay(200); }
  }
  mpu.setAccelerometerRange(MPU6050_RANGE_8_G);
  mpu.setGyroRange(MPU6050_RANGE_500_DEG);
  mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);

  setupBle();
  buzz("short");  // power-on confirmation
}

void loop() {
  static uint32_t lastSample = 0;
  if (millis() - lastSample >= SAMPLE_MS) {
    lastSample = millis();
    detectMotion();
  }
}
