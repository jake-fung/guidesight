# GuideSight

Assistive walking companion for blind and low-vision people who use guide dogs. When the dog
stops or pulls, a sensor on the harness tells the phone. The phone snaps a frame, Gemini describes
what's ahead, and the user hears a short warning in their earbuds and feels a buzz on the harness handle.

```
 ESP32 harness ──BLE──▶ Expo phone app ──HTTP──▶ Flask server ──▶ Gemini Vision / AssemblyAI / Firestore
 (MPU6050, motor) ◀─buzz─┘  (camera, mic, TTS)                       │
                                                                       └──▶ React dashboard (map, fatigue, hotspots)
```

| Folder       | What                                                                 | Stack                                   |
|--------------|----------------------------------------------------------------------|-----------------------------------------|
| `server/`    | API: walks, frames, voice questions, harness events, dashboard data  | Flask, firebase-admin, google-genai, AssemblyAI |
| `mobile/`    | Login → Setup (pair harness, preferences) → Live Walk                | Expo SDK 58, Expo Router, react-native-ble-plx |
| `dashboard/` | Map of stop events, dog activity & fatigue, route hotspots           | React, Vite, Tailwind v4, Leaflet       |
| `firmware/`  | Stop/pull detection, BLE notify, vibration patterns                  | ESP32 Arduino via PlatformIO, or Arduino UNO Q (`firmware/uno-q/`) |

## Quick start (mock mode, no API keys)

Every external service falls back to canned responses when its key is blank, and data is kept in memory.

```bash
# 1. Server
cd server
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env
.venv/bin/python run.py                 # http://localhost:5001
.venv/bin/python -m pytest              # API tests

# 2. Dashboard
cd dashboard && npm install && npm run dev   # http://localhost:5173, click "Load demo data"

# 3. Mobile (BLE needs a dev build, not Expo Go)
cd mobile && npm install
cp .env.example .env                    # set EXPO_PUBLIC_API_URL to your computer's LAN IP
npx expo run:ios                        # or run:android, or: npx eas-cli build --profile development

# 4. Firmware
cd firmware && pio run -t upload && pio device monitor
```

## Going live

1. **Firebase**: create a project, enable Email/Password auth and Firestore.
   - Mobile and dashboard: copy the web app config into each `.env`.
   - Server: download a service-account JSON and set `GOOGLE_APPLICATION_CREDENTIALS` to its path.
     The server then verifies ID tokens and stores data in Firestore. The `/api/dev/seed` route turns off.
2. **Gemini**: set `GEMINI_API_KEY`. `GEMINI_MODEL` defaults to `gemini-flash-latest`.
3. **AssemblyAI**: set `ASSEMBLYAI_API_KEY`.

## API

All routes need `Authorization: Bearer <Firebase ID token>`.

| Method & path                         | Body                                              | Returns                         |
|---------------------------------------|---------------------------------------------------|---------------------------------|
| `POST /api/walks`                     | –                                                 | `{id, started_at, ...}`         |
| `POST /api/walks/:id/harness-event`   | `{type: "stop"\|"pull", motion, location}`        | `{event, capture_frame}`        |
| `POST /api/walks/:id/frame`           | `{image: base64 jpeg, trigger, location}`         | `{alert, scene}`                |
| `POST /api/walks/:id/voice`           | multipart: `audio`, optional `image`, `lat`, `lng`| `{transcript, alert}`           |
| `POST /api/walks/:id/end`             | –                                                 | walk                            |
| `GET  /api/walks/:id`                 | –                                                 | `{walk, events}`                |
| `GET/PUT /api/settings`               | voice & alert preferences                         | settings                        |
| `GET  /api/dashboard/summary`         | –                                                 | `{walks, stops, hotspots}`      |

`alert` is `{speak, urgency, haptic: "short"|"double"|"long"|null, speech_rate}`. The phone speaks it
with `expo-speech` and writes `haptic` to the harness.

## BLE contract

Defined in `firmware/include/ble_protocol.h` and mirrored in `mobile/src/lib/harness.ts` and `firmware/uno-q/linux/harness_ble.py`.

- Service `6e8a0001-…`
- Event characteristic (notify), harness → phone: `{"type":"stop","accel":0.04,"ms":123456}`
- Command characteristic (write), phone → harness: `short` | `double` | `long`

## Firestore layout

```
users/{uid}                                  { settings }
users/{uid}/walks/{walkId}                   { started_at, ended_at, stop_count, pull_count }
users/{uid}/walks/{walkId}/events/{eventId}  { type: stop|pull|alert|question, at, location, ... }
```

## Main TODOs

- Calibrate stop/pull thresholds in `firmware/src/main.cpp` on a real harness.
- Hands-free voice (wake word / voice activity detection) instead of push-to-talk.
- Background operation: keep the walk running with the screen locked.
- Better fatigue model from gait data (`server/app/routes/dashboard.py`).
- Optional server-side TTS voices (`server/app/services/alerts.py`).
