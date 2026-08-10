"""
FastAPI Production Backend Application for IoT Rangoli Drawing Robot.
Provides ASGI WebSocket Transport, Outbound ESP32 WSS Client Manager,
Image Processing Pipeline, and Real-Time Dashboard Streams.
Lightweight transient data scope: Only active robot, active job, and active telemetry.
"""

import os
import math
import time
import json
import asyncio
import socket
import ipaddress
import urllib.parse
import cv2
import requests
from typing import Optional, List, Dict, Any
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response, WebSocket, WebSocketDisconnect, HTTPException, UploadFile, File, Form
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from core.image_processing import preprocess_rangoli_image
from core.vectorizer import contours_to_polylines, skeleton_to_polylines, export_polylines_to_svg, parse_svg_to_continuous_paths
from core.grid_planner import GridPlanner
from core.kinematics import KinematicSolver
from core.benchmark_engine import BenchmarkEngine
from core.experiment_logger import ExperimentLogger
from core.db import init_db, register_robot_db, create_job_db, add_job_commands_db, verify_robot_auth_db

# Initialize DB Schema
try:
    init_db()
except Exception as e:
    print(f"[DB WARN] Database initialization note: {e}")

UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), 'static', 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

logger = ExperimentLogger()

def cleanup_old_uploads(current_filename: str):
    """Deletes old temporary upload files to prevent historical data accumulation."""
    try:
        for fname in os.listdir(UPLOAD_FOLDER):
            if fname in ['demo_rangoli.png', 'pscmr_logo.png', '.gitkeep']:
                continue
            if fname != current_filename and fname != f"nobg_{current_filename}":
                fpath = os.path.join(UPLOAD_FOLDER, fname)
                if os.path.isfile(fpath):
                    os.remove(fpath)
    except Exception as e:
        print(f"[CLEANUP NOTE] {e}")

def is_safe_public_url(url_str: str) -> bool:
    """SSRF Protection: Validates that URL scheme is http/https and hostname resolves to a public IP."""
    try:
        parsed = urllib.parse.urlparse(url_str)
        if parsed.scheme not in ('http', 'https'):
            return False
        hostname = parsed.hostname
        if not hostname:
            return False

        # Reject loopback/local strings
        if hostname.lower() in ('localhost', '127.0.0.1', '0.0.0.0', '::1'):
            return False

        # Resolve IP addresses for hostname
        try:
            addr_info = socket.getaddrinfo(hostname, None)
        except socket.gaierror:
            return False

        for family, socktype, proto, canonname, sockaddr in addr_info:
            ip_str = sockaddr[0]
            ip = ipaddress.ip_address(ip_str)
            if (ip.is_private or 
                ip.is_loopback or 
                ip.is_link_local or 
                ip.is_multicast or 
                ip.is_reserved or 
                ip.is_unspecified):
                return False

        return True
    except Exception:
        return False


@asynccontextmanager
async def lifespan(app: FastAPI):
    asyncio.create_task(heartbeat_watchdog())
    yield

app = FastAPI(title="Autonomous Rangoli Robot Backend", version="2.0.0", lifespan=lifespan)

# CORS Middleware Setup
cors_origins_str = os.environ.get('CORS_ORIGINS', '*')
origins = [o.strip() for o in cors_origins_str.split(',') if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins if '*' not in origins else ['*'],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")


# ============================================================================
# LIVE WEBSOCKET CONNECTION MANAGER (TRANSIENT ACTIVE STATE STORE)
# ============================================================================
class ConnectionManager:
    def __init__(self):
        # robot_id -> { "ws": WebSocket, "info": dict, "last_seen": float, "job_id": Optional[str] }
        self.esp32_connections: Dict[str, Dict[str, Any]] = {}
        # active browser websocket connections
        self.browser_connections: List[WebSocket] = []
        # pending command ACKs: command_id -> asyncio.Event
        self.pending_acks: Dict[str, Dict[str, Any]] = {}
        # current active job only (no old job history accumulation)
        self.jobs: Dict[str, Dict[str, Any]] = {}
        # active session selected robot ID
        self.selected_robot_id: Optional[str] = None

    async def connect_browser(self, websocket: WebSocket):
        await websocket.accept()
        self.browser_connections.append(websocket)

    def disconnect_browser(self, websocket: WebSocket):
        if websocket in self.browser_connections:
            self.browser_connections.remove(websocket)

    async def broadcast_browser(self, message: dict):
        disconnected = []
        for ws in self.browser_connections:
            try:
                await ws.send_json(message)
            except Exception:
                disconnected.append(ws)
        for ws in disconnected:
            self.disconnect_browser(ws)

    async def register_esp32(self, robot_id: str, websocket: WebSocket, info: dict):
        self.esp32_connections[robot_id] = {
            "ws": websocket,
            "info": info,
            "last_seen": time.time(),
            "status": info.get("status", "READY"),
            "x": 15.0,
            "y": 15.0,
            "heading": 0.0,
            "progress": 0.0,
            "job_id": None
        }
        if not self.selected_robot_id:
            self.selected_robot_id = robot_id

        register_robot_db(robot_id, info.get("firmware_version", "1.0.0"), "WSS_OUTBOUND")

        # Broadcast live status update to all connected browser dashboards
        await self.broadcast_browser({
            "type": "robot_connection_update",
            "robot_id": robot_id,
            "event": "CONNECTED",
            "robots": self.get_online_robots()
        })

    async def disconnect_esp32(self, robot_id: str):
        if robot_id in self.esp32_connections:
            del self.esp32_connections[robot_id]
            await self.broadcast_browser({
                "type": "robot_connection_update",
                "robot_id": robot_id,
                "event": "DISCONNECTED",
                "robots": self.get_online_robots()
            })

    def update_esp32_last_seen(self, robot_id: str):
        if robot_id in self.esp32_connections:
            self.esp32_connections[robot_id]["last_seen"] = time.time()

    def get_online_robots(self) -> List[dict]:
        robots = []
        now = time.time()
        for rid, data in self.esp32_connections.items():
            last_seen_dt = now - data.get("last_seen", now)
            if last_seen_dt < 5.0:
                info = data.get("info", {})
                robots.append({
                    "robot_id": rid,
                    "connection": "CONNECTED",
                    "ip": info.get("ip", "192.168.4.1"),
                    "battery": data.get("battery_pct"),
                    "battery_voltage": data.get("battery_voltage"),
                    "state": data.get("status", "IDLE"),
                    "x": data.get("x"),
                    "y": data.get("y"),
                    "heading": data.get("heading"),
                    "last_seen_sec": round(last_seen_dt, 1)
                })
        return robots

    async def send_esp32_command(self, robot_id: str, command: dict, timeout_sec: float = 5.0) -> bool:
        if robot_id not in self.esp32_connections:
            return False

        ws = self.esp32_connections[robot_id]["ws"]
        cmd_id = command.get("command_id", f"CMD-{int(time.time()*1000)}")
        command["command_id"] = cmd_id

        ack_event = asyncio.Event()
        self.pending_acks[cmd_id] = {"event": ack_event, "status": None}

        try:
            await ws.send_json(command)
            try:
                await asyncio.wait_for(ack_event.wait(), timeout=timeout_sec)
                status = self.pending_acks[cmd_id]["status"]
                return status in ["accepted", "success", "ok", None]
            except asyncio.TimeoutError:
                print(f"[CMD TIMEOUT] No ACK received for {cmd_id} from {robot_id}")
                return False
        except Exception as e:
            print(f"[CMD SEND ERROR] {e}")
            return False
        finally:
            self.pending_acks.pop(cmd_id, None)

manager = ConnectionManager()


async def heartbeat_watchdog():
    """Background task checking ESP32 connection timeouts every 2 seconds."""
    while True:
        await asyncio.sleep(2)
        now = time.time()
        offline_robots = []
        for rid, data in manager.esp32_connections.items():
            if now - data.get("last_seen", now) > 5.0:
                offline_robots.append(rid)
        for rid in offline_robots:
            print(f"[WATCHDOG] Robot {rid} timed out (no heartbeat for >5s)")
            await manager.disconnect_esp32(rid)


# ============================================================================
# HTTP HTML & HEALTH ROUTES
# ============================================================================
@app.get("/")
def get_index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@app.get("/health")
def health_check():
    return JSONResponse(content={
        "status": "ok",
        "health": "healthy",
        "timestamp": time.time()
    }, status_code=200)


# ============================================================================
# ASGI WEBSOCKET TRANSPORT (BROWSER DASHBOARD & OUTBOUND ESP32 WSS)
# ============================================================================
@app.websocket("/ws")
@app.websocket("/robot/ws")
@app.websocket("/ws/{client_type}")
@app.websocket("/ws/esp32/{robot_id}")
async def websocket_endpoint(websocket: WebSocket, client_type: Optional[str] = "browser", robot_id: Optional[str] = None):
    # Determine client role
    path_str = websocket.url.path
    if "/robot/ws" in path_str or "/ws/esp32" in path_str or client_type == "esp32" or robot_id is not None:
        await handle_esp32_websocket(websocket, robot_id or "BOT-01")
    else:
        await manager.connect_browser(websocket)
        try:
            # Send initial dashboard state
            await websocket.send_json({
                "type": "robot_connection_update",
                "robots": manager.get_online_robots()
            })
            while True:
                data = await websocket.receive_text()
                # Browser incoming events processed here if needed
        except WebSocketDisconnect:
            manager.disconnect_browser(websocket)


async def handle_esp32_websocket(websocket: WebSocket, route_robot_id: str):
    await websocket.accept()
    authenticated_robot_id: Optional[str] = None

    try:
        while True:
            raw_msg = await websocket.receive_text()
            try:
                msg = json.loads(raw_msg)
            except Exception:
                continue

            msg_type = msg.get("type")

            if msg_type in ("auth", "robot_auth"):
                rid = msg.get("robot_id") or route_robot_id
                secret = msg.get("token") or msg.get("auth_token") or "SECRET_KEY_BOT_01"

                if verify_robot_auth_db(rid, secret):
                    authenticated_robot_id = rid
                    await manager.register_esp32(rid, websocket, msg)
                    await websocket.send_json({
                        "type": "auth_response",
                        "status": "accepted",
                        "robot_id": rid,
                        "message": f"Welcome {rid}. Outbound WSS transport established."
                    })
                    print(f"[ROBOT AUTH SUCCESS] {rid}")
                else:
                    await websocket.send_json({
                        "type": "auth_response",
                        "status": "rejected",
                        "message": "Authentication failed. Invalid robot credentials."
                    })
                    await websocket.close(code=4001)
                    break

            elif msg_type == "heartbeat":
                if authenticated_robot_id:
                    manager.update_esp32_last_seen(authenticated_robot_id)
                    print(f"[HEARTBEAT] {authenticated_robot_id}")

            elif msg_type == "ack":
                cmd_id = msg.get("command_id")
                if cmd_id in manager.pending_acks:
                    manager.pending_acks[cmd_id]["status"] = msg.get("status", "accepted")
                    manager.pending_acks[cmd_id]["event"].set()

                await manager.broadcast_browser({
                    "type": "cmd_ack",
                    "robot_id": authenticated_robot_id,
                    "command_id": cmd_id,
                    "status": msg.get("status")
                })

            elif msg_type == "telemetry":
                if authenticated_robot_id and authenticated_robot_id in manager.esp32_connections:
                    rdata = manager.esp32_connections[authenticated_robot_id]
                    rdata["last_seen"] = time.time()
                    rdata["status"] = msg.get("state", rdata["status"])
                    rdata["x"] = msg.get("x", rdata["x"])
                    rdata["y"] = msg.get("y", rdata["y"])
                    rdata["heading"] = msg.get("heading", rdata["heading"])
                    rdata["progress"] = msg.get("progress", rdata["progress"])

                    # Stream live telemetry directly to browser dashboard
                    await manager.broadcast_browser({
                        "type": "telemetry",
                        "robot_id": authenticated_robot_id,
                        "telemetry": {
                            "robot_id": authenticated_robot_id,
                            "connected": True,
                            "state": rdata["status"],
                            "x": rdata["x"],
                            "y": rdata["y"],
                            "heading": rdata["heading"],
                            "progress": rdata["progress"],
                            "powder_on": msg.get("powder_on", False)
                        }
                    })

    except WebSocketDisconnect:
        if authenticated_robot_id:
            print(f"[ROBOT OFFLINE] {authenticated_robot_id}")
            await manager.disconnect_esp32(authenticated_robot_id)


# ============================================================================
# PRODUCTION REST APIs (ROBOT REGISTRY & CURRENT ACTIVE JOB)
# ============================================================================
@app.get("/api/robots")
@app.get("/api/esp32/discover")
def list_robots():
    return JSONResponse(content={
        "status": "success",
        "robots": manager.get_online_robots()
    })

@app.get("/api/robots/{robot_id}")
@app.get("/api/esp32/status")
def get_robot_status(robot_id: Optional[str] = None):
    target_id = robot_id or manager.selected_robot_id or 'BOT-01'
    if target_id in manager.esp32_connections:
        rdata = manager.esp32_connections[target_id]
        return JSONResponse(content={
            "status": "success",
            "telemetry": {
                "robot_id": target_id,
                "connected": True,
                "authenticated": True,
                "state": rdata.get("status", "READY"),
                "x": rdata.get("x", 15.0),
                "y": rdata.get("y", 15.0),
                "heading": rdata.get("heading", 0.0),
                "progress": rdata.get("progress", 0),
                "wifi_signal": -54
            }
        })
    else:
        return JSONResponse(content={
            "status": "success",
            "telemetry": {
                "robot_id": target_id,
                "connected": False,
                "authenticated": False,
                "state": "DISCONNECTED",
                "x": 15.0,
                "y": 15.0,
                "heading": 0.0,
                "progress": 0
            }
        })

@app.post("/api/robots/{robot_id}/select")
@app.post("/api/esp32/connect")
async def select_robot(robot_id: Optional[str] = None, request: Request = None):
    data = {}
    if request:
        try:
            data = await request.json()
        except Exception:
            pass
    target_id = robot_id or data.get('robot_id', 'BOT-01')
    manager.selected_robot_id = target_id

    isConnected = target_id in manager.esp32_connections
    return JSONResponse(content={
        "status": "success" if isConnected else "warning",
        "connected": isConnected,
        "authenticated": isConnected,
        "robot_id": target_id,
        "message": f"Robot {target_id} selected." if isConnected else f"Robot {target_id} selected (currently disconnected)."
    })

@app.post("/api/jobs")
async def create_job(request: Request):
    data = await request.json()
    job_id = f"JOB-{int(time.time()*1000)}"
    target_robot_id = data.get("robot_id") or manager.selected_robot_id or "BOT-01"
    commands = data.get("commands", [])

    # Keep only current active job in RAM store
    manager.jobs = {
        job_id: {
            "job_id": job_id,
            "robot_id": target_robot_id,
            "status": "CREATED",
            "commands": commands,
            "total_commands": len(commands),
            "current_command": 0,
            "progress": 0.0,
            "created_at": time.strftime('%Y-%m-%d %H:%M:%S')
        }
    }

    create_job_db(job_id, target_robot_id, 610.0, 3.0, len(commands), 0.0, 0.0)
    add_job_commands_db(job_id, commands)

    return JSONResponse(content={"status": "success", "job_id": job_id, "robot_id": target_robot_id})

@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    if job_id in manager.jobs:
        return JSONResponse(content={
            "status": "success",
            "job": manager.jobs[job_id]
        })
    else:
        return JSONResponse(content={
            "status": "error",
            "message": f"Job {job_id} not found"
        }, status_code=404)

@app.post("/api/jobs/{job_id}/start")
@app.post("/api/esp32/start")
async def start_job(job_id: Optional[str] = None, request: Request = None):
    target_job_id = job_id
    if not target_job_id and request:
        data = await request.json()
        target_job_id = data.get("job_id")

    if not target_job_id:
        target_job_id = f"JOB-{int(time.time()*1000)}"
        manager.jobs = {
            target_job_id: {
                "job_id": target_job_id,
                "robot_id": manager.selected_robot_id or "BOT-01",
                "status": "CREATED",
                "commands": []
            }
        }

    job = manager.jobs.get(target_job_id)
    target_robot_id = job.get("robot_id") if job else (manager.selected_robot_id or "BOT-01")

    if target_robot_id not in manager.esp32_connections:
        return JSONResponse(content={
            "success": False,
            "error": "ROBOT_NOT_CONNECTED",
            "message": "Please connect the ESP32 robot before starting."
        }, status_code=409)

    cmd = {
        "type": "start_job",
        "job_id": target_job_id,
        "segments": job.get("commands", []) if job else []
    }

    success = await manager.send_esp32_command(target_robot_id, cmd, timeout_sec=5.0)
    if success:
        if job: job["status"] = "DRAWING"
        manager.esp32_connections[target_robot_id]["status"] = "DRAWING"
        return JSONResponse(content={"status": "success", "success": True, "message": "Start command acknowledged by robot."})
    else:
        return JSONResponse(content={
            "success": False,
            "error": "ACK_TIMEOUT",
            "message": "Robot failed to acknowledge start command."
        }, status_code=504)

@app.post("/api/jobs/{job_id}/pause")
@app.post("/api/esp32/pause")
async def pause_job(job_id: Optional[str] = None):
    target_robot_id = manager.selected_robot_id or "BOT-01"
    if target_robot_id not in manager.esp32_connections:
        return JSONResponse(content={"status": "error", "message": "Robot not connected"}, status_code=409)

    cmd = {"type": "pause", "job_id": job_id or "current"}
    success = await manager.send_esp32_command(target_robot_id, cmd, timeout_sec=5.0)
    if success:
        manager.esp32_connections[target_robot_id]["status"] = "PAUSED"
        return JSONResponse(content={"status": "success", "message": "Pause acknowledged."})
    return JSONResponse(content={"status": "error", "message": "Pause ACK timeout"}, status_code=504)

@app.post("/api/jobs/{job_id}/resume")
@app.post("/api/esp32/resume")
async def resume_job(job_id: Optional[str] = None):
    target_robot_id = manager.selected_robot_id or "BOT-01"
    if target_robot_id not in manager.esp32_connections:
        return JSONResponse(content={"status": "error", "message": "Robot not connected"}, status_code=409)

    cmd = {"type": "resume", "job_id": job_id or "current"}
    success = await manager.send_esp32_command(target_robot_id, cmd, timeout_sec=5.0)
    if success:
        manager.esp32_connections[target_robot_id]["status"] = "DRAWING"
        return JSONResponse(content={"status": "success", "message": "Resume acknowledged."})
    return JSONResponse(content={"status": "error", "message": "Resume ACK timeout"}, status_code=504)

@app.post("/api/jobs/{job_id}/stop")
@app.post("/api/esp32/stop")
async def stop_job(job_id: Optional[str] = None):
    target_robot_id = manager.selected_robot_id or "BOT-01"
    if target_robot_id in manager.esp32_connections:
        cmd = {"type": "stop", "job_id": job_id or "current"}
        await manager.send_esp32_command(target_robot_id, cmd, timeout_sec=3.0)
        manager.esp32_connections[target_robot_id]["status"] = "STOPPED"
    return JSONResponse(content={"status": "success", "message": "Stop command sent."})

@app.post("/api/jobs/{job_id}/emergency-stop")
@app.post("/api/esp32/emergency_stop")
async def emergency_stop(job_id: Optional[str] = None):
    target_robot_id = manager.selected_robot_id or "BOT-01"
    if target_robot_id in manager.esp32_connections:
        cmd = {"type": "emergency_stop"}
        await manager.send_esp32_command(target_robot_id, cmd, timeout_sec=2.0)
        manager.esp32_connections[target_robot_id]["status"] = "EMERGENCY_STOP"
    return JSONResponse(content={"status": "success", "message": "Emergency stop activated."})

@app.post("/api/send_to_esp32")
@app.post("/api/esp32/upload_path")
async def upload_path_compat(request: Request):
    data = await request.json()
    commands = data.get("commands", [])
    target_robot_id = data.get("robot_id") or manager.selected_robot_id or "BOT-01"

    if target_robot_id in manager.esp32_connections:
        cmd = {"type": "load_path", "commands": commands}
        await manager.send_esp32_command(target_robot_id, cmd, timeout_sec=5.0)

    return JSONResponse(content={"status": "success", "message": f"Loaded {len(commands)} commands for robot {target_robot_id}"})


# ============================================================================
# LIGHTWEIGHT IMAGE PROCESSING & SECURE URL IMPORT PIPELINE
# ============================================================================
@app.post("/api/upload")
async def upload_image(file: Optional[UploadFile] = File(None), image: Optional[UploadFile] = File(None)):
    upload_file = file or image
    if not upload_file:
        return JSONResponse(content={"error": "No file uploaded"}, status_code=400)

    filename = upload_file.filename or "uploaded_image.png"
    cleanup_old_uploads(filename)

    file_path = os.path.join(UPLOAD_FOLDER, filename)
    with open(file_path, "wb") as f:
        content = await upload_file.read()
        f.write(content)

    return JSONResponse(content={"success": True, "imageId": filename, "filename": filename})


@app.post("/api/import-url")
async def import_image_from_url(request: Request):
    """Secure Backend URL Image Download & Vectorization Pipeline endpoint."""
    data = await request.json()
    url = data.get("url") or data.get("image_url")
    if not url or not isinstance(url, str):
        return JSONResponse(content={
            "status": "error",
            "error": "Please enter a valid image URL."
        }, status_code=400)

    url = url.strip()
    if not (url.startswith("http://") or url.startswith("https://")):
        return JSONResponse(content={
            "status": "error",
            "error": "Please enter a valid image URL starting with http:// or https://"
        }, status_code=400)

    # 1. Reject clear HTML/Webpage path indicators early
    parsed_url = urllib.parse.urlparse(url)
    path_lower = parsed_url.path.lower()
    
    if path_lower.endswith(('.html', '.htm', '.php', '.asp', '.aspx')) or any(p in path_lower for p in ['/search/', '/category/']):
        if not path_lower.endswith(('.jpg', '.jpeg', '.png', '.webp', '.svg')):
            return JSONResponse(content={
                "status": "error",
                "error": "This URL is a webpage, not a direct image. Please copy the image address and paste the direct image URL."
            }, status_code=400)

    # 2. SSRF Protection
    if not is_safe_public_url(url):
        return JSONResponse(content={
            "status": "error",
            "error": "Unable to fetch image from this URL (access to local/private network addresses is blocked)."
        }, status_code=400)

    # 3. HTTP GET Request
    try:
        response = requests.get(
            url,
            timeout=10.0,
            allow_redirects=True,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
            },
            stream=True
        )

        if response.status_code in (401, 403):
            return JSONResponse(content={
                "status": "error",
                "error": "This website does not allow direct image access. Please use another public image URL or upload the image from your device."
            }, status_code=400)

        if response.status_code == 404:
            return JSONResponse(content={
                "status": "error",
                "error": "Image not found (404). Please verify the link is active and direct."
            }, status_code=400)

        if response.status_code != 200:
            return JSONResponse(content={
                "status": "error",
                "error": "Unable to fetch image from this URL. Please use another public image URL or upload the image from your device."
            }, status_code=400)

        # 4. Authoritative Content-Type Check
        raw_content_type = response.headers.get('Content-Type', '').lower().split(';')[0].strip()

        if raw_content_type in ('text/html', 'application/xhtml+xml', 'text/plain') or 'html' in raw_content_type:
            return JSONResponse(content={
                "status": "error",
                "error": "This URL is a webpage, not a direct image. Please copy the image address and paste the direct image URL."
            }, status_code=400)

        is_image_content = raw_content_type.startswith('image/') or raw_content_type in ('application/octet-stream', 'binary/octet-stream', '')
        if not is_image_content:
            return JSONResponse(content={
                "status": "error",
                "error": "Unsupported image format. Use JPG, PNG, WEBP, or SVG."
            }, status_code=400)

        content_length = response.headers.get('Content-Length')
        if content_length and int(content_length) > 20 * 1024 * 1024:
            return JSONResponse(content={
                "status": "error",
                "error": "Image file size exceeds the 20 MB limit."
            }, status_code=400)

        chunks = []
        total_size = 0
        max_size = 20 * 1024 * 1024

        for chunk in response.iter_content(chunk_size=65536):
            # Inspect first chunk for HTML header tags (Peeking)
            if not chunks:
                chunk_lower = chunk[:256].lower().strip()
                if chunk_lower.startswith(b'<!doctype html') or chunk_lower.startswith(b'<html') or b'<!doctype' in chunk_lower[:50]:
                    return JSONResponse(content={
                        "status": "error",
                        "error": "This URL is a webpage, not a direct image. Please copy the image address and paste the direct image URL."
                    }, status_code=400)

            total_size += len(chunk)
            if total_size > max_size:
                return JSONResponse(content={
                    "status": "error",
                    "error": "Image file size exceeds the 20 MB limit."
                }, status_code=400)
            chunks.append(chunk)

        image_bytes = b"".join(chunks)
        if not image_bytes:
            return JSONResponse(content={
                "status": "error",
                "error": "Fetched image file is empty."
            }, status_code=400)

        # 5. Extension Resolution from Content-Type or URL
        ext = ".png"
        if "jpeg" in raw_content_type or "jpg" in raw_content_type or url.lower().endswith(('.jpg', '.jpeg')):
            ext = ".jpg"
        elif "webp" in raw_content_type or url.lower().endswith('.webp'):
            ext = ".webp"
        elif "svg" in raw_content_type or url.lower().endswith('.svg'):
            ext = ".svg"

        filename = f"url_import_{int(time.time()*1000)}{ext}"
        cleanup_old_uploads(filename)

        file_path = os.path.join(UPLOAD_FOLDER, filename)
        with open(file_path, "wb") as f:
            f.write(image_bytes)

        img_check = cv2.imread(file_path)
        if img_check is None and not filename.endswith('.svg'):
            if os.path.exists(file_path):
                os.remove(file_path)
            return JSONResponse(content={
                "status": "error",
                "error": "Unsupported image format. Use JPG, PNG, WEBP, or SVG."
            }, status_code=400)

        # 6. PASS INTO THE EXACT SAME PROCESSING PIPELINE
        valid_contours, saved_images, diag_info = preprocess_rangoli_image(file_path)
        binary_img = saved_images.get('binary_mask') if saved_images else None
        if binary_img is not None:
            nobg_path = os.path.join(UPLOAD_FOLDER, f"nobg_{filename}")
            cv2.imwrite(nobg_path, binary_img)

        raw_paths, _ = contours_to_polylines(valid_contours)
        planner = GridPlanner(canvas_width_mm=610.0, canvas_height_mm=610.0)
        planned_segments = planner.plan_grid_aware_path(raw_paths)

        solver = KinematicSolver(wheelbase_mm=120.0, wheel_diameter_mm=44.0)
        esp32_cmds = solver.generate_commands(planned_segments)

        execution_segments = []
        for seg in planned_segments:
            execution_segments.append({
                "type": seg.get("type", "DRAW"),
                "dispense": seg.get("dispense", True),
                "grid": seg.get("grid", False),
                "pts": seg.get("pts", [])
            })

        return JSONResponse(content={
            "status": "success",
            "imageId": filename,
            "filename": filename,
            "execution_segments": execution_segments,
            "esp32_commands": esp32_cmds,
            "diagnostics": {
                "final_svg_paths": len(planned_segments),
                "total_points": sum(len(s.get("pts", [])) for s in planned_segments)
            },
            "image_urls": {
                "original": f"/static/uploads/{filename}",
                "nobg": f"/static/uploads/nobg_{filename}",
                "overlay": f"/static/uploads/nobg_{filename}"
            }
        })

    except requests.exceptions.RequestException:
        return JSONResponse(content={
            "status": "error",
            "error": "Unable to fetch image from this URL. Please use another public image URL or upload the image from your device."
        }, status_code=400)
    except Exception as e:
        return JSONResponse(content={
            "status": "error",
            "error": f"Image processing failed: {str(e)}"
        }, status_code=500)


@app.post("/api/process")
@app.post("/api/process/{image_id}")
async def process_image(
    image_id: Optional[str] = None,
    file: Optional[UploadFile] = File(None),
    image: Optional[UploadFile] = File(None),
    request: Request = None
):
    """
    End-to-End Image Processing Pipeline for Rangoli Designs.
    Accepts direct file upload (file/image) or image_id reference.
    No silent fake circular fallbacks — returns exact pipeline stage errors on failure.
    """
    import traceback
    t_start = time.time()

    upload_file = file or image
    target_image_id = None
    file_path = None
    data = {}

    if request:
        try:
            form_data = await request.form()
            data = dict(form_data)
        except Exception:
            try:
                data = await request.json()
            except Exception:
                data = {}

    # Step 1: Direct File Upload Handling
    if upload_file:
        filename = upload_file.filename or f"upload_{int(time.time()*1000)}.png"
        cleanup_old_uploads(filename)
        file_path = os.path.join(UPLOAD_FOLDER, filename)
        with open(file_path, "wb") as f:
            content = await upload_file.read()
            f.write(content)
        target_image_id = filename
        print(f"[PIPELINE] Direct file upload received: {filename} ({len(content)} bytes)")
    else:
        # Step 2: JSON or Query Param Reference
        target_image_id = image_id or data.get("image_id") or data.get("image_name")
        if target_image_id:
            file_path = os.path.join(UPLOAD_FOLDER, target_image_id)

    # Step 3: Fallback to most recent uploaded file if no image_id passed
    if not target_image_id or not file_path or not os.path.exists(file_path):
        uploads = [f for f in os.listdir(UPLOAD_FOLDER) if f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp', '.svg')) and not f.startswith('nobg_')]
        if uploads:
            uploads.sort(key=lambda x: os.path.getmtime(os.path.join(UPLOAD_FOLDER, x)), reverse=True)
            target_image_id = uploads[0]
            file_path = os.path.join(UPLOAD_FOLDER, target_image_id)
            print(f"[PIPELINE] Using most recent uploaded file: {target_image_id}")

    # Step 4: Strict Error Response (NO FAKE CIRCLES GENERATED)
    if not target_image_id or not file_path or not os.path.exists(file_path):
        print(f"[PIPELINE ERROR] Image Validation Failed: File not found.")
        return JSONResponse(content={
            "status": "error",
            "failed_stage": "IMAGE_VALIDATION",
            "error": "No valid Rangoli image file found. Please upload a PNG, JPG, WEBP, or SVG file first."
        }, status_code=400)

    print(f"[PIPELINE] Starting end-to-end processing for: {target_image_id}")

    try:
        raw_paths = []
        is_svg = target_image_id.lower().endswith('.svg')

        # Step 5: SVG Direct Vector Path Extraction
        if is_svg:
            print(f"[PIPELINE] SVG format detected. Performing direct vector path parsing...")
            try:
                from core.vectorizer import parse_svg_to_continuous_paths
                raw_paths = parse_svg_to_continuous_paths(file_path)
                print(f"[PIPELINE] SVG direct path parsing complete: {len(raw_paths)} vector paths extracted")
            except Exception as e_svg:
                print(f"[PIPELINE WARNING] Direct SVG parsing failed: {e_svg}. Falling back to raster processing...")
                is_svg = False

        # Step 6: Raster Image Processing Pipeline (PNG, JPG, WEBP)
        if not is_svg:
            # 6a. Image Decoding & Validation
            img_test = cv2.imread(file_path)
            if img_test is None:
                print(f"[PIPELINE ERROR] Image Decoding Failed for {file_path}")
                return JSONResponse(content={
                    "status": "error",
                    "failed_stage": "IMAGE_DECODING",
                    "error": f"Failed to decode image '{target_image_id}'. The file format may be unsupported or corrupted."
                }, status_code=400)

            print(f"[PIPELINE] Image decoded successfully. Resolution: {img_test.shape[1]} x {img_test.shape[0]} px")

            # 6b. Background Removal & Contour Extraction
            valid_contours, saved_images, diag_info = preprocess_rangoli_image(file_path, output_dir=UPLOAD_FOLDER)
            print(f"[PIPELINE] Background removal & threshold complete. Contours extracted: {len(valid_contours)}")

            if not valid_contours or len(valid_contours) == 0:
                stage_err = diag_info.get('failed_stage', 'No clear Rangoli boundary contours found in image.')
                print(f"[PIPELINE ERROR] Contour Extraction Failed: {stage_err}")
                return JSONResponse(content={
                    "status": "error",
                    "failed_stage": "CONTOUR_EXTRACTION",
                    "error": f"Image processing failed at Contour Extraction: {stage_err}"
                }, status_code=400)

            binary_img = saved_images.get('binary_mask') if saved_images else None
            if binary_img is not None:
                nobg_path = os.path.join(UPLOAD_FOLDER, f"nobg_{target_image_id}")
                cv2.imwrite(nobg_path, binary_img)

            # 6c. Vectorization & Polylines
            raw_paths, vstats = contours_to_polylines(valid_contours)
            print(f"[PIPELINE] Vector paths generated: {len(raw_paths)} polylines ({vstats.get('optimized_points_count', 0)} points)")

        if not raw_paths or len(raw_paths) == 0:
            print(f"[PIPELINE ERROR] Path Generation Failed: No valid polylines produced.")
            return JSONResponse(content={
                "status": "error",
                "failed_stage": "PATH_GENERATION",
                "error": "Failed to generate vector paths from extracted contours."
            }, status_code=400)

        # Step 7: Nearest-Neighbor Path Planning & Workspace Scaling
        size_val = 610.0
        size_str = str(data.get("drawing_size") or data.get("size") or "610").lower()
        if "300" in size_str or "small" in size_str: size_val = 300.0
        elif "450" in size_str or "medium" in size_str: size_val = 450.0
        elif "525" in size_str or "large" in size_str: size_val = 525.0
        
        planner = GridPlanner(canvas_width_mm=610.0, canvas_height_mm=610.0)
        planned_segments = planner.plan_grid_aware_path(raw_paths, drawing_size_mm=size_val)

        # Prepend initial travel segment from HOME (22.4, 24.4) to first DRAW start point
        first_draw_seg = next((s for s in planned_segments if s.get("type") == "DRAW"), None)
        if first_draw_seg and len(first_draw_seg.get("pts", [])) > 0:
            first_pt = first_draw_seg["pts"][0]
            if math.hypot(first_pt[0] - 22.4, first_pt[1] - 24.4) > 0.1:
                if not (planned_segments and planned_segments[0].get("type") == "MOVE" and planned_segments[0]["pts"][0] == [22.4, 24.4]):
                    home_travel_seg = {
                        "type": "MOVE",
                        "pts": [[22.4, 24.4], [first_pt[0], first_pt[1]]],
                        "dispense": False,
                        "grid": False
                    }
                    planned_segments.insert(0, home_travel_seg)

        print(f"[PIPELINE] Workspace Scaling ({size_val}mm) & TSP Optimization complete: {len(planned_segments)} segments")

        # Step 8: Kinematics Generation for ESP32
        solver = KinematicSolver(wheelbase_mm=120.0, wheel_diameter_mm=44.0)
        esp32_cmds = solver.generate_commands(planned_segments)
        print(f"[PIPELINE] Kinematic motion generation complete: {len(esp32_cmds)} ESP32 commands generated")

        execution_segments = []
        draw_dist_mm = 0.0
        travel_dist_mm = 0.0

        for seg in planned_segments:
            pts = seg.get("pts", [])
            seg_type = seg.get("type", "DRAW")
            dispense = seg.get("dispense", True)

            for i in range(len(pts) - 1):
                d = math.hypot(pts[i+1][0] - pts[i][0], pts[i+1][1] - pts[i][1])
                if seg_type == "DRAW" and dispense:
                    draw_dist_mm += d
                else:
                    travel_dist_mm += d

            execution_segments.append({
                "type": seg_type,
                "dispense": dispense,
                "grid": seg.get("grid", False),
                "pts": pts
            })

        proc_time_ms = round((time.time() - t_start) * 1000.0, 1)
        print(f"[PIPELINE] Pipeline finished in {proc_time_ms} ms. Drawing dist: {draw_dist_mm/1000:.2f} m, Travel dist: {travel_dist_mm/1000:.2f} m")

        return JSONResponse(content={
            "status": "success",
            "imageId": target_image_id,
            "filename": target_image_id,
            "execution_segments": execution_segments,
            "esp32_commands": esp32_cmds,
            "statistics": {
                "drawing_distance_m": round(draw_dist_mm / 1000.0, 2),
                "travel_distance_m": round(travel_dist_mm / 1000.0, 2),
                "number_of_paths": len(execution_segments),
                "number_of_turns": sum(max(0, len(s.get("pts", [])) - 2) for s in execution_segments),
                "processing_time_ms": proc_time_ms
            },
            "diagnostics": {
                "final_svg_paths": len(planned_segments),
                "total_points": sum(len(s.get("pts", [])) for s in planned_segments)
            },
            "image_urls": {
                "original": f"/static/uploads/{target_image_id}",
                "nobg": f"/static/uploads/nobg_{target_image_id}" if os.path.exists(os.path.join(UPLOAD_FOLDER, f"nobg_{target_image_id}")) else f"/static/uploads/{target_image_id}",
                "overlay": f"/static/uploads/{target_image_id}"
            }
        })

    except Exception as e:
        traceback.print_exc()
        return JSONResponse(content={
            "status": "error",
            "failed_stage": "PIPELINE_EXECUTION",
            "error": f"Image processing pipeline exception: {str(e)}"
        }, status_code=500)



@app.get("/api/demo_path")
@app.get("/api/demo")
def get_demo_path():
    """Generates a demo Rangoli vector path for simulation & testing."""
    import math
    segments = []

    # Travel to start position (305, 100)
    segments.append({
        "type": "TRAVEL",
        "dispense": False,
        "grid": False,
        "pts": [[0.0, 0.0], [305.0, 100.0]]
    })

    # Outer 8-Petal Flower Rangoli Pattern
    center_x, center_y = 305.0, 305.0
    radius = 180.0
    num_pts = 64
    circle_pts = []
    for i in range(num_pts + 1):
        angle = (2.0 * math.pi * i) / num_pts
        r = radius + 35.0 * math.sin(8.0 * angle)
        px = center_x + r * math.cos(angle)
        py = center_y + r * math.sin(angle)
        circle_pts.append([round(px, 1), round(py, 1)])

    segments.append({
        "type": "DRAW",
        "dispense": True,
        "grid": False,
        "pts": circle_pts
    })

    # Inner Star Pattern
    inner_pts = []
    inner_num = 16
    for i in range(inner_num + 1):
        angle = (2.0 * math.pi * i) / inner_num
        r = 75.0 if i % 2 == 0 else 35.0
        px = center_x + r * math.cos(angle)
        py = center_y + r * math.sin(angle)
        inner_pts.append([round(px, 1), round(py, 1)])

    segments.append({
        "type": "TRAVEL",
        "dispense": False,
        "grid": False,
        "pts": [circle_pts[-1], inner_pts[0]]
    })

    segments.append({
        "type": "DRAW",
        "dispense": True,
        "grid": False,
        "pts": inner_pts
    })

    solver = KinematicSolver(wheelbase_mm=120.0, wheel_diameter_mm=44.0)
    esp32_cmds = solver.generate_commands(segments)

    return JSONResponse(content={
        "status": "success",
        "execution_segments": segments,
        "esp32_commands": esp32_cmds,
        "message": "Demo Rangoli path loaded successfully"
    })

