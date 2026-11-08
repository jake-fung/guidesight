// GuideSight harness firmware for an ESP32 dev board (ESP32-WROOM-32, 30-pin "ESP32 Dev Module").
// Same behaviour and server protocol as firmware/uno_r4, ported to the ESP32.
// Uses an HC-SR04 ultrasonic sensor to detect obstacles ahead and an active buzzer for feedback.
//
// Talks to the Flask server over Wi-Fi, through a WebSocket it keeps open (server/app/live.py):
//   harness -> server: {"type":"hello","id":...,"key":...} once, then {"type":"obstacle","cm":85}
//   (again each time the obstacle comes 50 cm closer, and when it comes within 50 cm)
//                      and "ping" every 15 s
//   server -> harness: "short" | "double" | "long" (buzz pattern), or "pong"
// The server forwards obstacle events to the walker web app on the phone.
//
// Wiring (pins are printed as D5, D18... on the board):
//   HC-SR04 VCC -> VIN (5 V)   GND -> GND   TRIG -> D5
//           ECHO -> 1 kOhm -> D18, plus 2 kOhm from D18 to GND (ESP32 pins are 3.3 V; the divider
//                   is recommended, a lone 1 kOhm in series works for a demo)
//   Buzzer  +   -> 3V3   -   -> GND    S    -> D23
//   Optional vibration motor: D19 -> 1 kOhm -> 2N2222 base (with 1N4148 across the motor)
//
// Build: Arduino IDE, board "ESP32 Dev Module" (core "esp32 by Espressif"),
// library "ArduinoHttpClient" (Library Manager).
// Copy arduino_secrets.example.h to arduino_secrets.h and fill in Wi-Fi + server details first.

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <ArduinoHttpClient.h>

#include "arduino_secrets.h"

// ---- Pins -------------------------------------------------------------------
constexpr int TRIG_PIN = 5;
constexpr int ECHO_PIN = 18;
constexpr int BUZZER_PIN = 23;
constexpr int MOTOR_PIN = 19;     // optional vibration motor driver; harmless if nothing is attached
constexpr int LINK_LED_PIN = 2;   // blue on-board LED on most ESP32 dev boards; on while connected

// ---- Tuning -----------------------------------------------------------------
constexpr long OBSTACLE_CM = 150;           // send an event when something comes closer than this
constexpr long CLEAR_CM = 200;              // ...and re-arm once it's farther than this (hysteresis)
constexpr long BEEP_CM = 200;               // local proximity beeping range
constexpr uint32_t EVENT_COOLDOWN_MS = 3000;
constexpr long CLOSER_CM = 50;              // send again each time it comes this much closer (distance alerts)
constexpr long STOP_CM = 50;                // the phone's stop screen opens at this distance; always report crossing it
constexpr uint32_t CLOSER_COOLDOWN_MS = 800;
constexpr uint32_t SAMPLE_MS = 60;          // HC-SR04 needs ~60 ms between pings

// ---- Server link ------------------------------------------------------------
constexpr uint32_t RECONNECT_MS = 5000;     // wait between connection attempts
constexpr uint32_t HEARTBEAT_MS = 15000;    // "ping" interval; the server drops us after 45 s of silence
constexpr uint32_t LINK_TIMEOUT_MS = 40000; // no "pong" for this long = dead connection, reconnect

#if SERVER_TLS
WiFiClientSecure net;  // setInsecure() in setup(): no certificate check, fine for a hackathon tunnel
#else
WiFiClient net;
#endif
WebSocketClient ws(net, SERVER_HOST, SERVER_PORT);

bool linkUp = false;
uint32_t lastConnectTry = 0;
uint32_t lastPingAt = 0;
uint32_t lastHeardAt = 0;

bool armed = true;
uint32_t lastEventAt = 0;
long lastSentCm = 0;
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
  digitalWrite(BUZZER_PIN, HIGH); digitalWrite(MOTOR_PIN, HIGH);
  delay(ms);
  digitalWrite(BUZZER_PIN, LOW);  digitalWrite(MOTOR_PIN, LOW);
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

// ---- Server link ------------------------------------------------------------
void setLink(bool up) {
  linkUp = up;
  digitalWrite(LINK_LED_PIN, up ? HIGH : LOW);
}

bool sendText(const char* text) {
  if (!linkUp) return false;
  ws.beginMessage(TYPE_TEXT);
  ws.print(text);
  ws.endMessage();
  return true;
}

bool joinWifi() {
  if (WiFi.status() == WL_CONNECTED) return true;
  Serial.print("Wi-Fi: joining "); Serial.println(WIFI_SSID);
  // On the ESP32, WiFi.begin() returns straight away, so wait for the connection (up to ~10 s).
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  for (int i = 0; i < 100 && WiFi.status() != WL_CONNECTED; i++) delay(100);
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Wi-Fi: failed (2.4 GHz only; on iPhone hotspots turn on Maximize Compatibility)");
    WiFi.disconnect();
    return false;
  }
  // The IP address can take a moment to arrive after joining.
  for (int i = 0; i < 50 && WiFi.localIP() == IPAddress(0, 0, 0, 0); i++) delay(100);
  Serial.print("Wi-Fi: connected, IP "); Serial.println(WiFi.localIP());
  return true;
}

void connectServer() {
  Serial.print("server: connecting to "); Serial.print(SERVER_HOST); Serial.print(":"); Serial.println(SERVER_PORT);
  if (ws.begin("/api/harness/ws") != 0) {
    Serial.println("server: connection failed");
    ws.stop();
    return;
  }
  setLink(true);
  char hello[160];
  snprintf(hello, sizeof(hello), "{\"type\":\"hello\",\"id\":\"%s\",\"key\":\"%s\"}", HARNESS_ID, HARNESS_KEY);
  sendText(hello);
  lastPingAt = lastHeardAt = millis();
  Serial.println("server: connected as " HARNESS_ID);
}

/** Keeps Wi-Fi and the server connection up. Retries every RECONNECT_MS (each try blocks briefly). */
void maintainLink() {
  uint32_t now = millis();
  if (linkUp && (!ws.connected() || now - lastHeardAt > LINK_TIMEOUT_MS)) {
    Serial.println("server: link lost");
    ws.stop();
    setLink(false);
  }
  if (linkUp || (lastConnectTry != 0 && now - lastConnectTry < RECONNECT_MS)) return;
  lastConnectTry = now;
  if (joinWifi()) connectServer();
}

void handleServerMessages() {
  if (!linkUp || ws.parseMessage() <= 0) return;
  int type = ws.messageType();
  String msg = ws.readString();
  msg.trim();
  lastHeardAt = millis();

  if (type == TYPE_CONNECTION_CLOSE) {
    Serial.println("server: closed the connection (wrong HARNESS_KEY?)");
    ws.stop();
    setLink(false);
    return;
  }
  if (type != TYPE_TEXT || msg == "pong") return;
  Serial.print("cmd: "); Serial.println(msg);
  if (msg == "short" || msg == "double" || msg == "long") buzz(msg);
}

void heartbeat() {
  if (linkUp && millis() - lastPingAt > HEARTBEAT_MS) {
    lastPingAt = millis();
    sendText("ping");
  }
}

void sendEvent(long cm) {
  char json[48];
  snprintf(json, sizeof(json), "{\"type\":\"obstacle\",\"cm\":%ld}", cm);
  Serial.println(json);
  if (!sendText(json)) Serial.println("(not connected, event dropped)");
}

// ---- Main -------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(MOTOR_PIN, OUTPUT);
  pinMode(LINK_LED_PIN, OUTPUT);

  WiFi.mode(WIFI_STA);
#if SERVER_TLS
  net.setInsecure();
#endif
  ws.setHttpResponseTimeout(5000);  // don't hang if the server never answers
  buzz("short");  // power-on confirmation
}

void loop() {
  maintainLink();
  handleServerMessages();
  heartbeat();

  static uint32_t lastSample = 0;
  uint32_t now = millis();
  if (now - lastSample < SAMPLE_MS) return;
  lastSample = now;

  long cm = readDistanceCm();

  // Phone event: fire when something comes close, again each CLOSER_CM nearer (so the phone can
  // count the distance down) or as soon as it's within STOP_CM, and re-arm once it's clear again.
  bool first = armed && cm > 0 && cm < OBSTACLE_CM && now - lastEventAt > EVENT_COOLDOWN_MS;
  bool nearer = cm <= lastSentCm - CLOSER_CM || (cm <= STOP_CM && lastSentCm > STOP_CM);
  bool closer = !armed && cm > 0 && nearer && now - lastEventAt > CLOSER_COOLDOWN_MS;
  if (first || closer) {
    armed = false;
    lastEventAt = now;
    lastSentCm = cm;
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
