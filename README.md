# MortyckHomeAssistent &mdash; Tablet Smart Home & Remote PC Dashboard

**MortyckHomeAssistent** is a self-hosted, unified Smart Home, IP Camera, and Remote PC dashboard web application. It connects, controls, and streams heterogeneous local IoT devices and remote PCs across two primary locations &mdash; completely free of fragmented vendor mobile apps.

Designed specifically as an **installable Progressive Web App (PWA)** optimized for **wall-mounted landscape tablets** (such as the Samsung Galaxy Tab A SM-T550, iPad, or Android tablets):
- **Minimalist, High-Contrast Dark Theme:** Solid dark surfaces (`#0F1115` background, `#1A1D24` cards, `#2A2E39` borders) with crisp white typography (`#FFFFFF`) &mdash; zero neon glow, zero sci-fi scanlines.
- **Tablet Touchscreen Ergonomics:** Large tap targets (minimum 48x48px buttons/switches), chunky sliders, and zero tiny hover-only menus.
- **Multi-Location Hub:** Two dedicated location views &mdash; **Home** (`192.168.1.0/24`) and **Garage** (`192.168.8.0/24` routed via Tailscale).
- **Remote PC Power & Remote Access:** Live ping monitoring, one-tap Wake-on-LAN (WoL) and hardware relay pulse, and instant AnyDesk connection (`anydesk:<ID>`) plus optional web desktop viewer.

---

## Architecture Overview

```
                      ┌────────────────────────────────────────────────────────┐
                      │                 MortyckHomeAssistent                   │
                      │          Wall-Mounted Tablet PWA (SM-T550)             │
                      │   (React + TypeScript + Tailwind CSS + Lucide Icons)   │
                      └───────────────────────────┬────────────────────────────┘
                                                  │
                        WebSocket / REST          │  WebRTC WHEP (<500ms latency)
                        (Port 4000)               │  (Port 1984 / 8555)
                                                  ▼
                  ┌─────────────────────────────────────────────────────────────────┐
                  │                 MortyckHomeAssistent Backend Core               │
                  │  ┌──────────────────────┐  ┌──────────────────────────────────┐ │
                  │  │   Network Scanner    │  │        Automation Engine         │ │
                  │  │ (ARP + 6668/554/8899)│  │   (IFTTT Motion -> Light Rules)  │ │
                  │  └──────────────────────┘  └──────────────────────────────────┘ │
                  │  ┌──────────────────────┐  ┌──────────────────────────────────┐ │
                  │  │      WoL Service     │  │       go2rtc Media Service       │ │
                  │  │ (UDP WoL + Relay PIN)│  │ (Dynamic RTSP -> WebRTC Streams) │ │
                  │  └──────────────────────┘  └──────────────────────────────────┘ │
                  │  ┌────────────────────────────────────────────────────────────┐ │
                  │  │                       Device Manager                       │ │
                  │  │  ┌────────────────┐ ┌──────────────────┐ ┌───────────────┐ │ │
                  │  │  │  Tuya Adapter  │ │  ONVIF / CamHi   │ │ Generic Bridge│ │ │
                  │  │  │(v3.3/v3.4 LAN) │ │(RTSP + PTZ CGI)  │ │ (HA / Webhook)│ │ │
                  │  │  └───────┬────────┘ └────────┬─────────┘ └───────┬───────┘ │ │
                  │  └──────────┼───────────────────┼───────────────────┼─────────┘ │
                  └─────────────┼───────────────────┼───────────────────┼───────────┘
                                │                   │                   │
                ┌───────────────┴───────────────────┴───────────────────┴───────────────┐
                │                                                                       │
                ▼                                                                       ▼
    ┌───────────────────────────────┐                       ┌───────────────────────────────────────┐
    │       LOCATION 1: HOME        │                       │          LOCATION 2: GARAGE           │
    │      (192.168.1.0/24 LAN)     │                       │     (192.168.8.0/24 via Tailscale)    │
    ├───────────────────────────────┤                       ├───────────────────────────────────────┤
    │ &bull; Calex / Tuya (.10, .11)     │                       │ &bull; Garage Workshop Camera (CamHi) │
    │ &bull; CamHi PTZ Dome Camera       │                       │ &bull; Garage PC Power Relay (Tuya)   │
    │ &bull; Wansview HD Indoor Camera   │                       │ &bull; Garage PC (192.168.8.10)       │
    │ &bull; Home PC (192.168.1.80)      │                       │   (Wake-on-LAN + AnyDesk: 542819003)  │
    │   (Wake-on-LAN + AnyDesk)     │                       └───────────────────────────────────────┘
    └───────────────────────────────┘
```

---

## Key Features

1. **Two Location Management (`Home` & `Garage`):**
   - **Home (`192.168.1.0/24`):** Local smart lights, plugs, exterior PTZ camera, living room camera, and Home PC.
   - **Garage (`192.168.8.0/24` via Tailscale):** Garage workshop camera, Tuya PC power relay, and Garage PC.
   - **All Cameras Mode:** Unified live matrix (1x1, 2x2, 3x3) viewing all feeds simultaneously.

2. **Remote PC Power & Remote Access:**
   - **Live Host Ping:** Real-time online/offline status with millisecond latency indicator.
   - **Power ON (Wake-on-LAN):** Sends standard UDP magic packet broadcast (`192.168.1.255` or `192.168.8.255`).
   - **Hardware Relay Pulse:** Optional momentary trigger (1000ms pulse) via Tuya dry-contact relay connected to motherboard power pins.
   - **Connect (AnyDesk):** 1-tap direct launch via `anydesk:<ID>` URI scheme, plus 1-tap ID copying.
   - **Web Desktop Viewer:** Optional embedded browser iframe (for Apache Guacamole, RustDesk Web, or noVNC).

3. **Ultra-Low Latency Video Wall (<500ms) with go2rtc:**
   - CamHi & Wansview RTSP restreamed to WebRTC in browser.
   - Interactive on-screen touch PTZ controls: 4-way pad, zoom in/out, and position reset.
   - Frame capture snapshot downloader.

4. **Tuya, Calex & Amorom Local Control (Zero-Cloud Latency):**
   - Direct local socket communication on TCP port `6668` via Tuya Local LAN Protocol (`v3.1`, `v3.3`, `v3.4`, `v3.5`).
   - Real-time power telemetry: Active Load (Watts), Voltage (V), and Current (A).
   - Large 56x56px touch toggle switches, thick brightness sliders, and color presets.

---

## Monorepo Project Structure

```
MortyckHome/
├── docker-compose.yml          # Container configuration (go2rtc, backend, frontend)
├── docker/
│   ├── go2rtc.yaml             # go2rtc WebRTC and RTSP streaming configuration
│   ├── backend.Dockerfile      # Node.js 22 production image
│   └── frontend.Dockerfile     # Multi-stage Nginx production image
├── backend/
│   ├── package.json            # mortyckhomeassistent-backend
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts            # Server entry & WebSocket broadcaster
│   │   ├── types/              # Schemas for devices, PCs, locations, rules
│   │   ├── db/
│   │   │   └── Database.ts     # Persistent store for devices, PCs, automations
│   │   ├── services/
│   │   │   ├── WolService.ts            # Wake-on-LAN & TCP ping health checker
│   │   │   ├── MediaService.ts          # go2rtc stream registration & health check
│   │   │   ├── DeviceManager.ts         # Adapter orchestration & event dispatcher
│   │   │   ├── NetworkScannerService.ts # Subnet ARP & socket probe
│   │   │   └── AutomationEngine.ts      # IFTTT event evaluation & execution
│   │   ├── adapters/
│   │   │   ├── BaseDeviceAdapter.ts     # Abstract adapter class with auto-reconnect
│   │   │   ├── TuyaLocalAdapter.ts      # Local protocol v3.3/v3.4 socket client
│   │   │   ├── OnvifCameraAdapter.ts    # CamHi CGI & ONVIF SOAP PTZ client
│   │   │   └── GenericBridgeAdapter.ts  # Home Assistant REST & Webhook bridge
│   │   └── routes/
│   │       └── api.ts          # REST endpoints for devices, PCs, scanner, rules
└── frontend/
    ├── package.json            # mortyckhomeassistent-frontend
    ├── tsconfig.json
    ├── vite.config.ts          # Vite config with API and WebSocket reverse proxies
    ├── index.html              # MortyckHomeAssistent title & PWA tags
    └── src/
        ├── main.tsx
        ├── App.tsx             # Location switcher (Home / Garage) & tablet UI
        ├── index.css           # Solid dark theme (#0F1115 / #1A1D24)
        ├── types/              # Frontend TypeScript definitions
        ├── services/
        │   ├── api.ts          # REST client (devices, PCs, WoL, AnyDesk)
        │   └── websocket.ts    # Real-time WebSocket client
        └── components/
            ├── Navbar.tsx               # Header, location tabs & view switches
            ├── RemotePcCard.tsx         # PC Power (WoL), Ping & AnyDesk card
            ├── MultiCameraWall.tsx      # Responsive camera matrix (1x1, 2x2, 3x3)
            ├── WebRtcPlayer.tsx         # Live WebRTC player with on-screen PTZ
            ├── TuyaDeviceCard.tsx       # RGB, brightness, power toggle & telemetry
            ├── NetworkScannerModal.tsx  # LAN discovery modal with radar UI
            ├── DeviceOnboardingModal.tsx# Location & device onboarding wizard
            └── AutomationsModal.tsx     # IFTTT rule creator & simulator
```

---

## One-Click Windows Startup & Shutdown

The repository root includes ready-to-use batch scripts:

### Option A: One-Click Desktop Scripts
- **`START_ALL.bat`**: Double-click to automatically launch `go2rtc.exe`, the Node.js backend (port `4000`), and the Vite frontend (port `3000`) in minimized windows, and open `http://localhost:3000` in your default browser.
- **`STOP_ALL.bat`**: Double-click to cleanly terminate `go2rtc`, the backend, and frontend processes without leaving background orphans.

---

## Running as a Background Windows Boot Service (PM2)

To run MortyckHomeAssistent automatically in the background whenever Windows starts (no open cmd windows):

1. **Install PM2 globally:**
   ```powershell
   npm install -g pm2 pm2-windows-startup
   ```

2. **Start all 3 services from the project root:**
   ```powershell
   cd D:\MortyckHome
   pm2 start ecosystem.config.js
   ```

3. **Save process list & register Windows service:**
   ```powershell
   pm2 save
   pm2-startup install
   ```
   *(To view status anytime: `pm2 status`; to view live logs: `pm2 logs`).*

---

## Quick Start (Manual Terminal Launch)

### 1. Run Backend
```bash
cd backend
npm install
npm run build
npm start
```
*Backend runs on `http://localhost:4000` (API: `/api`, WebSockets: `/ws`).*

### 2. Run Frontend
```bash
cd frontend
npm install
npm run dev
```
*Open `http://localhost:3000` in your browser.*

---

## Installing on Wall-Mounted Tablet (Samsung SM-T550 / iPad)

1. Open the browser on the tablet and navigate to `http://<YOUR_SERVER_IP>:3000`.
2. **Android (Chrome):**
   - Tap the three-dot menu icon in the top right.
   - Tap **Add to Home screen** or **Install app**.
   - Confirm. An app icon titled **MortyckHomeAssistent** will appear on your home screen.
3. **iPad (Safari):**
   - Tap the **Share** button.
   - Tap **Add to Home Screen**.
4. Tap the new home screen icon to launch MortyckHomeAssistent in native borderless full-screen standalone mode.

---

## Remote PC Power & AnyDesk Setup

### Home PC
- **IP:** `192.168.1.80`
- **MAC:** `18:99:F5:07:15:E5`
- **AnyDesk ID:** Configured in `backend/data/pcs.json` or editable via API.
- **Power ON:** Clicking **Power ON (WoL)** sends a standard magic packet to `192.168.1.255:9`.

### Garage PC (via Tailscale)
- **IP:** `192.168.8.10`
- **MAC:** `00:D8:61:4A:22:11`
- **AnyDesk ID:** `542 819 003`
- **Power ON Options:**
  - **Wake-on-LAN:** Broadcasts across subnet `192.168.8.255`.
  - **Hardware Relay Pulse (Motherboard Pins):** Connected to Tuya relay `garage-pc-power-relay` (`192.168.8.15`), giving a 1000ms dry-contact pulse to simulate a physical power button press.

---

## Blurams Garage Camera Bridge (Native Windows)

Because Docker is not installed on this Windows host, a native Python RTSP bridge service runs locally in the background without any container dependencies:
- **Bridge Script:** `scripts/blurams_bridge.py`
- **RTSP Endpoint:** `rtsp://127.0.0.1:8556/blurams_garage`
- **Target Device ID:** `1800420411702000132815`
- **Camera Subnet IP:** `192.168.8.161`
- **go2rtc Stream:** `blurams_garage` (WebRTC WHEP endpoint: `http://localhost:1984/api/webrtc?src=blurams_garage`)
- **Auto-Start:** Automatically launched alongside the backend (`node dist/index.js`), via `START_ALL.bat`, or under PM2 (`ecosystem.config.js`).

### Configuration (`.env`)
Configure your Blurams cloud credentials in `D:\MortyckHome\.env`:
```env
BLURAMS_EMAIL=your-blurams-email@example.com
BLURAMS_PASSWORD=your-blurams-password
BLURAMS_DEVICE_ID=1800420411702000132815
BLURAMS_CAMERA_IP=192.168.8.161
RTSP_PORT=8556
STREAM_NAME=blurams_garage
```

---

## License
MIT &copy; MortyckHomeAssistent
