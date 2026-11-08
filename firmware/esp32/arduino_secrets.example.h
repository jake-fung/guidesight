// Copy this file to arduino_secrets.h (gitignored) and fill it in.
#pragma once

// Wi-Fi: 2.4 GHz only, and no networks that need a username (like eduroam).
// A phone hotspot works; on an iPhone, turn on "Maximize Compatibility".
#define WIFI_SSID   "your-hotspot-name"
#define WIFI_PASS   "your-hotspot-password"

// Where the Flask server is.
//   Dev, laptop on the same hotspot:  laptop's IP (System Settings > Wi-Fi > Details), port 5001, TLS 0
//   Deployed server or HTTPS tunnel:  its host name without https://, port 443, TLS 1
#define SERVER_HOST "172.20.10.2"
#define SERVER_PORT 5001
#define SERVER_TLS  0

// This harness's ID. Type the same ID on the walker app's Setup screen to pair it.
// Pick something unique (letters, digits, dashes): anyone who knows it can pair with the harness.
#define HARNESS_ID  "gs-change-me"
// Must match HARNESS_KEY in server/.env. Can stay blank while the server runs without Firebase.
#define HARNESS_KEY ""
