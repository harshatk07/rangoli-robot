"""
Formal Robot State Machine & Telemetry Model for Autonomous Rangoli Robot
"""

from enum import Enum
from dataclasses import dataclass, field
import time


class RobotState(str, Enum):
    IDLE = "IDLE"
    READY = "READY"
    UPLOADING = "UPLOADING"
    PROCESSING = "PROCESSING"
    SIMULATION = "SIMULATION"
    RUNNING = "RUNNING"
    DRAWING = "DRAWING"
    MOVING = "MOVING"
    PAUSED = "PAUSED"
    STOPPED = "STOPPED"
    EMERGENCY_STOP = "EMERGENCY_STOP"
    ERROR = "ERROR"
    COMPLETED = "COMPLETED"
    OFFLINE = "OFFLINE"
    CONNECTION_LOST = "CONNECTION_LOST"


@dataclass
class TelemetryData:
    robot_id: str = "BOT-01"
    state: RobotState = RobotState.OFFLINE
    x_mm: float = 0.0
    y_mm: float = 0.0
    heading_deg: float = 0.0
    velocity_mm_s: float = 0.0
    progress_pct: int = 0
    powder_active: bool = False
    battery_voltage: float = 0.0
    battery_pct: int = 0
    wifi_signal_dbm: int = -100
    connected: bool = False
    authenticated: bool = False
    estop_active: bool = False
    last_updated: float = field(default_factory=time.time)

    def to_dict(self) -> dict:
        return {
            "robot_id": self.robot_id,
            "state": self.state.value if isinstance(self.state, RobotState) else str(self.state),
            "x": round(self.x_mm, 1) if self.connected else None,
            "y": round(self.y_mm, 1) if self.connected else None,
            "heading": round(self.heading_deg, 1) if self.connected else None,
            "velocity": round(self.velocity_mm_s, 1) if self.connected else None,
            "progress": self.progress_pct if self.connected else 0,
            "powder_active": self.powder_active if self.connected else False,
            "battery_voltage": round(self.battery_voltage, 2) if self.connected else None,
            "battery_pct": self.battery_pct if self.connected else None,
            "wifi_signal": self.wifi_signal_dbm if self.connected else -100,
            "connected": self.connected,
            "authenticated": self.authenticated,
            "estop_active": self.estop_active,
            "timestamp": self.last_updated
        }
