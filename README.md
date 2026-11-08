# GuideSight

Assistive walking companion for blind and low-vision people who use guide dogs. An ultrasonic
sensor on the harness spots obstacles ahead and tells the server over Wi-Fi. The walker's phone snaps
a frame, Gemini describes what's ahead, and the walker hears a short warning in their earbuds and
feels a buzz on the harness handle.

Built for HackCamp 2026.

```
 UNO R4 WiFi harness ──Wi-Fi──▶ Flask server ──▶ Gemini Vision / AssemblyAI / Firestore
 (HC-SR04, buzzer)   ◀──buzz───┘   ▲     │
                                   │     └──live events──▶ walker web app on the phone (/walk)
                    frames, voice ─┘                        (camera, mic, GPS, speech)
                                                           caregiver dashboard (/): map, fatigue, hotspots
```

| Folder              | What                                                              | Stack |
|---------------------|-------------------------------------------------------------------|-------|
| `server/`           | API: walks, frames, voice questions, live harness link, dashboard data | Flask, flask-sock, firebase-admin, google-genai, AssemblyAI |
| `dashboard/`        | Web app. `/walk`: walker app (voice or visual onboarding → Home, Guide mode, Ask, Read text, Settings). `/`: walk dashboard | React, Vite, Tailwind v4, Leaflet |
| `firmware/uno_r4/`  | Obstacle detection, proximity beeps, buzz patterns, Wi-Fi link   | Arduino UNO R4 WiFi, ArduinoHttpClient |

## Quick start (mock mode, no API keys)

Every external service falls back to canned responses when its key is blank, and data is kept in memory.

```bash
# 1. Server
cd server
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env
.venv/bin/python run.py                 # http://localhost:5001
.venv/bin/python -m pytest              # API tests

# 2. Web app (walker app + dashboard). Vite forwards /api to the server.
cd dashboard && cp .env.example .env && npm install && npm run dev
#   http://localhost:5173       dashboard, click "Load demo data"
#   http://localhost:5173/walk  walker app (add ?demo for the prototype's sample content, #d4 etc. to open a screen)
```

### On a phone

Phone browsers only allow the camera, microphone and GPS on `https://` pages, so open the app
through a tunnel instead of the laptop's IP:

```bash
brew install cloudflared
cloudflared tunnel --url http://localhost:5173   # prints https://<random>.trycloudflare.com
```

Open `https://<random>.trycloudflare.com/walk` on the phone. For a home-screen icon: Safari → Share →
Add to Home Screen. Keep the page open with the screen on during a walk (it holds a wake lock).
On iPhones, tap the first screen (**Tap anywhere to start**) yourself: Safari only lets a page speak after a tap.

## Harness (UNO R4 WiFi)

| From | To UNO R4 WiFi |
|---|---|
| HC-SR04 VCC / GND | 5V / GND |
| HC-SR04 TRIG / ECHO | D9 / D10 (no resistors needed, the R4 is 5 V) |
| Buzzer + / − / S | 3.3V / GND / D8 |

1. Arduino IDE: install the **Arduino UNO R4 Boards** core and the **ArduinoHttpClient** library.
   On Apple Silicon Macs the board's compiler needs Rosetta: `softwareupdate --install-rosetta --agree-to-license`.
2. Copy `firmware/uno_r4/arduino_secrets.example.h` to `arduino_secrets.h` and fill in:
   - **Wi-Fi**: 2.4 GHz only, no username/password networks like eduroam. A phone hotspot works
     (iPhone: turn on **Maximize Compatibility**).
   - **Server**: for dev, put the laptop on the same hotspot and use its IP with port `5001` and
     `SERVER_TLS 0`. For a deployed server or a tunnel, use its host name, port `443`, `SERVER_TLS 1`.
   - **HARNESS_ID**: something unique, like `gs-7f3k9q`.
3. Pick "Arduino UNO R4 WiFi" and upload. Serial Monitor at 115200 shows Wi-Fi, server and events.
   The built-in LED is on while the harness is connected to the server.
4. In the walker app, open **Settings → Sensor** (or **Enter sensor ID** on the Connect your sensor step), type the
   same harness ID and tap **Save**, then **Test buzz**.

The harness beeps faster as things get closer even when it's offline. Obstacle events and buzz
commands need the server link.

## Going live

1. **Firebase**: create a project, enable Email/Password auth and Firestore.
   - Web app: copy the web app config into `dashboard/.env`.
   - Server: download a service-account JSON and set `GOOGLE_APPLICATION_CREDENTIALS` to its path.
     The server then verifies ID tokens and stores data in Firestore. The `/api/dev/seed` route turns off.
2. **Harness key**: set `HARNESS_KEY` in `server/.env` and the same value in `arduino_secrets.h`.
   With Firebase on, harnesses can't connect without it.
3. **Gemini**: set `GEMINI_API_KEY`. `GEMINI_MODEL` defaults to `gemini-flash-latest`.
4. **AssemblyAI**: set `ASSEMBLYAI_API_KEY`.
5. **Hosting**: the web app is static (`npm run build` → `dashboard/dist`); route every path to
   `index.html` so `/walk` loads. If the server is on another host, set `VITE_API_URL` and add the web
   app's origin to `CORS_ORIGINS`. Run the server as a **single process** with threads (for example
   `gunicorn -w 1 --threads 32`): live connections are kept in memory.

## API

All routes need `Authorization: Bearer <Firebase ID token>`.

| Method & path                         | Body                                              | Returns                         |
|---------------------------------------|---------------------------------------------------|---------------------------------|
| `POST /api/walks`                     | –                                                 | `{id, started_at, ...}`         |
| `POST /api/walks/:id/harness-event`   | `{type: "obstacle"\|"stop"\|"pull", motion, location}` | `{event, capture_frame}`   |
| `POST /api/walks/:id/frame`           | `{image: base64 jpeg, trigger, location}`         | `{alert, scene}`, buzzes the harness |
| `POST /api/walks/:id/voice`           | multipart: `audio`, optional `image`, `lat`, `lng`| `{transcript, alert}`           |
| `POST /api/walks/:id/end`             | –                                                 | walk                            |
| `GET  /api/walks/:id`                 | –                                                 | `{walk, events}`                |
| `GET/PUT /api/settings`               | voice & alert preferences, `harness_id`           | settings                        |
| `GET  /api/harness/status`            | –                                                 | `{harness_id, online}`          |
| `POST /api/harness/buzz`              | `{pattern: "short"\|"double"\|"long"}`            | `{delivered}`                   |
| `GET  /api/dashboard/summary`         | –                                                 | `{walks, stops, hotspots}`      |

`alert` is `{speak, urgency, haptic: "short"|"double"|"long"|null, speech_rate}`. The phone speaks it
with the browser's speech synthesis; the server sends `haptic` straight to the harness.

## Live link (WebSockets)

Defined in `server/app/live.py`. The first message on each socket authenticates it.

- `/api/harness/ws` (harness):
  - harness → server: `{"type":"hello","id":"gs-…","key":"…"}`, then `{"type":"obstacle","cm":85}`
    and `ping` every 15 s
  - server → harness: `short` | `double` | `long` (buzz), or `pong`
- `/api/live` (walker app):
  - phone → server: `{"type":"auth","token":"<Firebase ID token>"}`, then `ping` every 25 s
  - server → phone: `{"type":"harness_event","event":{...}}` and `{"type":"harness_status","online":true}`

A harness belongs to the user whose settings have its `harness_id`.

## Firestore layout

```
users/{uid}                                  { settings }
users/{uid}/walks/{walkId}                   { started_at, ended_at, stop_count, pull_count }
users/{uid}/walks/{walkId}/events/{eventId}  { type: obstacle|stop|pull|alert|question, at, location, ... }
```

## Main TODOs

- Calibrate `OBSTACLE_CM` / `CLEAR_CM` in `firmware/uno_r4/uno_r4.ino` on a real harness.
- Hands-free voice (wake word / voice activity detection) instead of tap-to-ask.
- Background operation: keep the walk running with the screen locked.
- Better fatigue model (`server/app/routes/dashboard.py`).
- Optional server-side TTS voices (`server/app/services/alerts.py`).
