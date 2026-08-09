# 🤖 IoT Based Autonomous Rangoli Drawing Robot

[![Python Version](https://img.shields.io/badge/python-3.12-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110.0-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![PlatformIO](https://img.shields.io/badge/PlatformIO-ESP32--S3-F6821F?style=for-the-badge&logo=platformio&logoColor=white)](https://platformio.org/)
[![License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](LICENSE)
[![Status](https://img.shields.io/badge/Hardware%20Status-Software%20Ready%20%7C%20Awaiting%20ESP32-success?style=for-the-badge)](#-current-limitations--hardware-requirements)

> **PSCMR College of Engineering and Technology**  
> *Department of Computer Science & Engineering (IoT)*  
> **IoT Final Year B.Tech Project — TEAM NO. 12**  
> **Workspace Dimension**: $610 \times 610\text{ mm}$ ($2 \times 2\text{ ft}$)

---

## 📸 Screenshots & Demonstration

| Web Dashboard (610 × 610 mm Workspace) | Image Vectorization Pipeline |
| :---: | :---: |
| ![Dashboard Interface Placeholder](static/uploads/demo_rangoli.png) | ![Vector Extraction Placeholder](static/uploads/pscmr_logo.png) |
| *Real-time vector trajectory preview & dual DEMO/REAL robot execution toggle* | *Binarization, contour isolation & continuous G-Code/motion generation* |

---

## 🚀 Quick Start

Get the local simulation dashboard running in less than 2 minutes on Windows PowerShell:

```powershell
git clone https://github.com/harshatk07/rangoli-robot.git
cd rangoli_robot
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
Copy-Item .env.example .env
uvicorn app:app --host 127.0.0.1 --port 5000
```

Open your browser and navigate to:
- 🌐 **Dashboard UI**: [http://127.0.0.1:5000](http://127.0.0.1:5000)
- 🏥 **Health Check API**: [http://127.0.0.1:5000/health](http://127.0.0.1:5000/health)

---

## ✨ Key Features

- 🖼️ **Multi-Format Image Importer**: Upload local `JPG`, `PNG`, `WEBP`, or `SVG` files via drag-and-drop or import direct public web URLs with SSRF protection.
- 🎨 **Adaptive Rangoli Vectorizer**: Converts raster Rangoli art into smoothed, continuous motion vectors with background removal and boundary isolation.
- 📐 **$610 \times 610\text{ mm}$ Kinematic Canvas**: Real-time canvas preview mapped 1:1 to a physical $2 \times 2\text{ ft}$ workspace with adjustable line width ($2\text{ mm}$, $3\text{ mm}$, $4\text{ mm}$) and scale controls.
- 🟡 **DEMO Simulation Mode**: Full browser-side kinematic trajectory simulation (no physical hardware required).
- 🔴 **REAL Hardware Mode**: Secure outbound WebSocket (`wss://`) control layer connecting Render FastAPI backend to physical ESP32-S3 microcontroller.
- 📶 **Captive Portal Wi-Fi Provisioning**: Automated SoftAP (`RangoliRobot-Setup` @ `192.168.4.1`) for browser-based Wi-Fi credential setup and NVS flash storage.
- 🛡️ **Hardware Failsafe Watchdog**: Automatic powder valve shutoff and motor deceleration upon WSS signal loss, 15-second heartbeat timeout, or emergency stop.

---

## 🏗️ System Architecture

### Process Dataflow Pipeline

```text
Rangoli Image
     ↓
Image Processing (Binarization & Background Removal)
     ↓
Vectorization (Contour Extraction & Polyline Reduction)
     ↓
Path Planning (610 × 610 mm Workspace Scale & Toolpath Optimization)
     ↓
Kinematic Command Generation
     ↓
FastAPI Backend (Render Cloud / Local Host)
     ↓
Outbound Secure WebSockets (wss://)
     ↓
ESP32-S3 Microcontroller
     ↓
Motor Driver (PWM & Encoders) + Powder Valve Servo
     ↓
Autonomous Rangoli Drawing Execution
```

### System Component Diagram

```mermaid
graph TD
    subgraph Browser ["Web Browser (User Dashboard)"]
        UI["HTML5 / Vanilla CSS / JS Dashboard"]
        Canvas["Interactive 610x610 mm Canvas"]
    end

    subgraph Backend ["FastAPI Backend (Render Cloud / Local)"]
        API["FastAPI REST & ASGI WSS Server"]
        CV["OpenCV Image Vectorizer"]
        DB[(SQLite / PostgreSQL DB)]
        Manager["WSS Connection Manager"]
    end

    subgraph ESP32 ["ESP32-S3 Hardware / Emulator"]
        WSS_Client["Outbound WSS Client"]
        NVS["NVS Flash Storage"]
        CP["Captive Portal (192.168.4.1)"]
        Motors["Motor Driver (PWM/Encoders)"]
        Servo["Powder Servo Dispenser"]
    end

    UI <-->|HTTP REST / Browser WS| API
    API <-->|Outbound WSS /robot/ws| WSS_Client
    Manager <--> DB
    CV --> Manager
    WSS_Client --> Motors
    WSS_Client --> Servo
    CP --> NVS
```

---

## 📂 Repository Structure

```text
rangoli_robot/
├── app.py                      # FastAPI ASGI App, REST APIs, Outbound WSS Manager
├── Procfile                    # Render cloud execution entrypoint
├── render.yaml                 # Render Infrastructure-as-Code manifest
├── requirements.txt            # Python dependencies (FastAPI, OpenCV, Uvicorn)
├── .env.example                # Template for environment variables (local dev)
├── .gitignore                  # Git exclusions (.env, .venv, .pio, *.db)
├── rangoli_robot.db            # Local SQLite database (ignored by git)
├── core/                       # Core Python robotics & CV processing modules
│   ├── __init__.py
│   ├── db.py                   # DB persistence layer & auth token verification
│   ├── image_processing.py     # Image binarization & background isolation
│   ├── vectorizer.py           # Contour extraction & polyline reduction
│   ├── grid_planner.py         # Workspace path optimization (610 x 610 mm)
│   ├── kinematics.py           # Differential drive inverse kinematics solver
│   ├── benchmark_engine.py     # Robotics performance benchmark suite (13 metrics)
│   └── experiment_logger.py    # Experiment logger & thesis report generator
├── firmware/                   # ESP32-S3 C++ Firmware (PlatformIO Project)
│   ├── platformio.ini          # Board configuration & dependencies (ESP32Servo, ArduinoJson)
│   ├── include/                # Modular C++ header definitions
│   │   ├── config.h            # Hardware GPIO pin map & kinematic constants
│   │   ├── config_storage.h    # NVS storage interface (Preferences)
│   │   ├── wifi_manager.h      # Captive Portal AP (192.168.4.1)
│   │   ├── websocket_client.h  # Outbound WSS transport & heartbeats
│   │   ├── powder_controller.h # Servo powder gate valve control
│   │   └── safety_controller.h # Hardware watchdog & emergency cutoff
│   └── src/                    # C++ source code implementations
│       └── main.cpp            # ESP32 setup() and loop() entrypoint
├── templates/                  # Frontend HTML Dashboard
│   └── index.html              # Single-page web dashboard layout
├── static/                     # Static CSS, JS & Media assets
│   ├── style.css               # Production stylesheet (85px compact header system)
│   ├── script.js              # Frontend state manager & canvas simulator
│   └── uploads/                # Uploaded Rangoli image directory
├── scratch/                    # Development scripts & hardware emulator
│   └── test_robot_emulator.py  # Standalone Python ESP32 WSS hardware emulator
└── tests/                      # Automated unit test suite
    ├── test_pipeline.py        # Image processing & vectorization pipeline tests
    └── test_api_url_security.py# DB auth, SSRF protection & URL import security tests
```

---

## 💻 Software Requirements

- **Operating System**: Windows 10 / 11 (or Linux / macOS)
- **Python**: Python `3.12.x` (64-bit)
- **Git**: `git` version 2.30+
- **C++ Compiler / IDE (Firmware only)**: VS Code with [PlatformIO IDE Extension](https://platformio.org/)

---

## 🛠️ Windows Installation — Step-by-Step

Follow these exact steps to set up the project on Windows PowerShell:

### 1. Verify Python 3.12 & Git

```powershell
py -3.12 --version
git --version
```

### 2. Clone Repository

```powershell
git clone https://github.com/harshatk07/rangoli-robot.git
cd rangoli_robot
```

### 3. Create & Activate Virtual Environment

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
```

*(If PowerShell blocks script execution, run `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser` once).*

### 4. Upgrade Pip & Install Dependencies

```powershell
python -m pip install --upgrade pip
pip install -r requirements.txt
```

### 5. Create Local `.env` Configuration File

```powershell
Copy-Item .env.example .env
```

---

## 🏃 Run Locally

Start the local FastAPI ASGI web server using Uvicorn:

```powershell
uvicorn app:app --host 127.0.0.1 --port 5000
```

### Access Local Endpoints
- 🖥️ **Web Dashboard**: [http://127.0.0.1:5000](http://127.0.0.1:5000)
- 🏥 **Health Check Endpoint**: [http://127.0.0.1:5000/health](http://127.0.0.1:5000/health)
- 📡 **Robots Discovery API**: [http://127.0.0.1:5000/api/robots](http://127.0.0.1:5000/api/robots)

---

## 🟡 DEMO Mode (No Hardware Required)

You do **not** need physical ESP32 hardware to test or demonstrate the application:

1. Open [http://127.0.0.1:5000](http://127.0.0.1:5000) in your browser.
2. The header status pill defaults to **🟡 DEMO ROBOT — Simulation Only**.
3. Upload a Rangoli image (or click **Use Image URL**).
4. Select drawing scale (Full $610 \times 610\text{ mm}$) and line width ($3\text{ mm}$).
5. Click **🚀 START SIMULATION**.
6. Watch the real-time differential-drive kinematic robot trajectory move across the interactive vector canvas.

---

## 🔴 REAL Robot Mode

In REAL mode, control commands flow from the web browser to the physical robot via outbound WebSockets:

```text
Browser UI  ──(HTTP/WSS)──>  FastAPI Backend  ──(Outbound WSS /robot/ws)──>  ESP32-S3 Robot
```

> [!IMPORTANT]
> **No Inbound LAN Connections**: The FastAPI backend **never** scans your local network or initiates incoming connections to `192.168.x.x`. The ESP32 robot always initiates the secure outbound WebSocket connection to the server.

---

## 🤖 ESP32 Firmware Setup & Provisioning

### 1. Build Firmware with PlatformIO

Open the `firmware/` directory in VS Code with PlatformIO installed:

```powershell
cd firmware
pio run
```

### 2. Hardware Pin Mapping (`firmware/include/config.h`)

All hardware-dependent GPIO pins and mechanical parameters are centralized in `firmware/include/config.h`:

```cpp
#define MOTOR_LEFT_PWM_PIN       25    // Left Motor Speed PWM
#define MOTOR_LEFT_IN1_PIN       26    // Left Motor Direction 1
#define MOTOR_LEFT_IN2_PIN       27    // Left Motor Direction 2

#define MOTOR_RIGHT_PWM_PIN      14    // Right Motor Speed PWM
#define MOTOR_RIGHT_IN1_PIN      12    // Right Motor Direction 1
#define MOTOR_RIGHT_IN2_PIN      13    // Right Motor Direction 2

#define POWDER_SERVO_PIN         18    // Powder Valve Servo (GPIO 18)
#define SETUP_BUTTON_PIN         0     // BOOT Button (Hold 5s to reset Wi-Fi)

const float WHEEL_DIAMETER_MM    = 44.0f;  // Wheel Diameter (mm)
const float WHEEL_BASE_MM        = 120.0f; // Distance between wheels (mm)
```

### 3. Flash Firmware to ESP32

Connect your ESP32-S3 board to your PC via USB and run:

```powershell
pio run --target upload
```

### 4. Wi-Fi Provisioning via Captive Portal

1. On first boot (or after holding the BOOT button for 5 seconds), the ESP32 creates a Wi-Fi Access Point named **`RangoliRobot-Setup`**.
2. Connect your phone or laptop Wi-Fi to **`RangoliRobot-Setup`**.
3. Open **`http://192.168.4.1`** in your web browser.
4. Enter the required configuration fields:
   - **Wi-Fi SSID** (Select from scanned networks)
   - **Wi-Fi Password**
   - **Robot ID** (e.g. `BOT-01`)
   - **Backend WSS URL** (e.g. `wss://rangoli-robot.onrender.com/robot/ws` or `ws://192.168.1.100:5000/robot/ws`)
   - **Robot Auth Token** (e.g. `SECRET_KEY_BOT_01`)
5. Click **Save & Connect Robot**. The credentials are stored permanently in ESP32 NVS Flash memory.

---

## ⚡ Automatic Robot Reconnection

Once Wi-Fi provisioning is completed:
- Every time the robot is powered on, it automatically connects to Wi-Fi.
- It automatically establishes an outbound WebSocket connection to the Render/Local backend.
- It automatically authenticates and appears in the browser dashboard under **🔍 Discover Robots**.
- **VS Code or a USB PC connection is NOT required for normal robot operation.**

---

## 🔐 Robot Authentication & Security

- **Token Storage**: The authentication token resides in ESP32 NVS Flash and server environment variables. It is **never** exposed to browser client-side JavaScript.
- **Handshake Validation**: Upon WSS connection, the robot sends a `{ "type": "robot_auth", "robot_id": "BOT-01", "token": "..." }` frame. The backend validates this token against the database (`verify_robot_auth_db`). Unauthenticated sockets are closed with code `4001`.

---

## 📡 Robot Discovery

- Click **🔍 Discover Robots** in the web dashboard header.
- The browser queries `GET /api/robots`.
- Online, authenticated ESP32 robots connected via WSS appear with status `READY` and signal metrics.

---

## 🔌 WSS Architecture & Message Protocols

The backend supports bidirectional WebSocket communication:

| Message Type | Direction | Payload Example | Description |
| :--- | :--- | :--- | :--- |
| `robot_auth` | Robot $\rightarrow$ Server | `{"type":"robot_auth", "robot_id":"BOT-01", "token":"..."}` | Robot authentication frame |
| `auth_response` | Server $\rightarrow$ Robot | `{"type":"auth_response", "status":"accepted"}` | Handshake acceptance |
| `heartbeat` | Robot $\rightarrow$ Server | `{"type":"heartbeat", "robot_id":"BOT-01", "timestamp":...}` | Sent every 15 seconds |
| `start_job` | Server $\rightarrow$ Robot | `{"type":"start_job", "job_id":"JOB-123", "segments":[...]}` | Motion command batch |
| `ack` | Robot $\rightarrow$ Server | `{"type":"ack", "command_id":"CMD-456", "status":"accepted"}` | Instant ACK response |
| `telemetry` | Robot $\rightarrow$ Server | `{"type":"telemetry", "x":305.0, "y":305.0, "progress":45.2}` | 20 Hz pose stream |

---

## ⏱️ Heartbeat, ACK Timeout & Safety Watchdog

- **15-Second Heartbeat**: The ESP32 transmits a heartbeat every 15 seconds. If no frame is received for 35 seconds, the server marks the robot `DISCONNECTED`.
- **5-Second Command ACK Timeout**: When the user clicks Start, Pause, or Resume, the server waits up to 5 seconds for a hardware ACK response (`command_id`). If no ACK arrives, the server returns an `ACK_TIMEOUT` error.
- **Hardware Failsafe Watchdog**: If WSS connection drops during a drawing sequence, the ESP32 immediately turns off the powder valve servo and halts the motors.

---

## 🧪 Robot Emulator

Test the full WSS backend pipeline without physical hardware using the Python emulator:

1. Start local backend server:
   ```powershell
   uvicorn app:app --host 127.0.0.1 --port 5000
   ```
2. In a second PowerShell terminal, run the emulator:
   ```powershell
   $env:PYTHONUNBUFFERED="1"
   py scratch/test_robot_emulator.py ws://127.0.0.1:5000/robot/ws
   ```
3. The emulator registers `BOT-01` as `CONNECTED` and streams 20 Hz telemetry to the dashboard.

---

## 🧪 Automated Unit Tests

Run the full automated test suite covering image vectorization, kinematics, database security, and SSRF URL protection:

```powershell
py -m unittest discover tests
```

Expected output:
```text
......
----------------------------------------------------------------------
Ran 6 tests in 0.249s

OK
```

---

## 🌐 Production REST API Reference

| Endpoint | Method | Request Body | Description |
| :--- | :---: | :--- | :--- |
| `/health` | `GET` | None | Health check endpoint (Returns `200 OK`) |
| `/api/robots` | `GET` | None | Returns list of online authenticated robots |
| `/api/robots/{id}` | `GET` | None | Returns live telemetry for target robot |
| `/api/robots/{id}/select` | `POST` | `{}` | Sets active target robot ID |
| `/api/upload` | `POST` | Multipart Form Image | Uploads local Rangoli image file |
| `/api/import-url` | `POST` | `{"url": "..."}` | Secure backend image download from URL |
| `/api/process` | `POST` | `{"image_id": "..."}` | Vectorizes image & generates toolpaths |
| `/api/jobs` | `POST` | `{"robot_id": "...", "commands": [...]}` | Creates active job record |
| `/api/jobs/{id}/start` | `POST` | `{}` | Sends WSS `start_job` command (5s ACK) |
| `/api/jobs/{id}/pause` | `POST` | `{}` | Sends WSS `pause` command |
| `/api/jobs/{id}/resume` | `POST` | `{}` | Sends WSS `resume` command |
| `/api/jobs/{id}/stop` | `POST` | `{}` | Sends WSS `stop` command |
| `/api/jobs/{id}/emergency-stop` | `POST` | `{}` | Immediate hardware emergency stop |

---

## 🖼️ Image-Processing Pipeline

```text
Input Image (JPG/PNG/WEBP/SVG)
      ↓
Background Removal & Otsu Threshold Binarization (OpenCV)
      ↓
Contour Extraction & Boundary Isolation
      ↓
Polyline Simplification & Continuous Path Extraction
      ↓
Grid Motion Optimization (610 × 610 mm Scale Mapping)
      ↓
Toolpath & Differential Drive Kinematic Commands
```

---

## ☁️ Render Cloud Deployment

1. Push repository to GitHub.
2. Log into [Render Dashboard](https://dashboard.render.com/) and create a **Web Service**.
3. Select your repository (`harshatk07/rangoli-robot`).
4. Configure service settings:
   - **Environment**: Python
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn app:app --host 0.0.0.0 --port $PORT`
   - **Health Check Path**: `/health`
5. Add Environment Variables:
   - `CORS_ORIGINS` = `*`
   - `DATABASE_URL` = *(Optional: PostgreSQL URL for production persistence)*

---

## 🔄 GitHub Development Workflow

When modifying code:

```powershell
# 1. Check status
git status

# 2. Add specific modified files
git add app.py README.md

# 3. Commit with descriptive message
git commit -m "docs: update comprehensive production README.md"

# 4. Push to remote main branch
git push origin main
```

---

## 🛠️ Troubleshooting

| Issue | Cause | Solution |
| :--- | :--- | :--- |
| `HTTP 400` on URL Import | Entered search page URL (e.g. Shutterstock/Amazon) | Copy direct image address ending in `.jpg`, `.png`, or `.webp` |
| Robot Disconnected in REAL mode | ESP32 powered off or Wi-Fi lost | Power on ESP32 or hold BOOT button 5s to re-provision Wi-Fi |
| `ACK_TIMEOUT` Error | ESP32 lost WSS socket connection | Click **🔍 Discover Robots** to verify WSS connection |
| PowerShell script blocked | Windows Execution Policy restriction | Run `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser` |

---

## 🔐 Security & Secrets Protection

- **Local Credentials**: Never commit `.env`, Wi-Fi passwords, or auth tokens to GitHub.
- **Git Exclusions**: The `.gitignore` file automatically excludes:
  ```text
  .env
  .venv/
  .vscode/
  firmware/.pio/
  *.db
  ```

---

## 🚧 Current Limitations & Hardware Requirements

| Feature / Hardware | Status | Description |
| :--- | :---: | :--- |
| **Simulation / DEMO Mode** | ✅ `Implemented` | 100% complete & functional in web browser |
| **FastAPI WSS Backend** | ✅ `Implemented` | 100% complete & verified |
| **ESP32 Firmware Code** | ✅ `Implemented` | 100% compiled & tested via PlatformIO |
| **Physical ESP32 Board** | ⚠️ `Hardware Required` | Requires purchasing physical ESP32-S3 + Motor Driver + Servos |
| **Physical Powder Dispenser** | ⚠️ `Hardware Required` | Requires 3D-printed chassis & servo gate valve assembly |

---

## 📜 Project Metadata & Attribution

- **Project Title**: Autonomous Rangoli Drawing Robot
- **Institution**: PSCMR College of Engineering and Technology
- **Department**: Department of Computer Science & Engineering (IoT)
- **Batch**: IoT Final Year B.Tech Project — TEAM NO. 12
- **License**: MIT License
