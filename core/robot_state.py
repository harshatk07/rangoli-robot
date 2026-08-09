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
    PAUSED = "PAUSED"
    STOPPED = "STOPPED"
    EMERGENCY_STOP = "EMERGENCY_STOP"
    ERROR = "ERROR"
    COMPLETED = "COMPLETED"


@dataclass
class TelemetryData:
    robot_id: str = "BOT-01"
    state: RobotState = RobotState.IDLE
    x_mm: float = 0.0
    y_mm: float = 0.0
    heading_deg: float = 0.0
    velocity_mm_s: float = 0.0
    progress_pct: int = 0
    powder_active: bool = False
    battery_voltage: float = 12.2
    battery_pct: int = 95
    wifi_signal_dbm: int = -54
    connected: bool = True
    authenticated: bool = True
    estop_active: bool = False
    last_updated: float = field(default_factory=time.time)

    def to_dict(self) -> dict:
        return {
            "robot_id": self.robot_id,
            "state": self.state.value if isinstance(self.state, RobotState) else str(self.state),
            "x": round(self.x_mm, 1),
            "y": round(self.y_mm, 1),
            "heading": round(self.heading_deg, 1),
            "velocity": round(self.velocity_mm_s, 1),
            "progress": self.progress_pct,
            "powder_active": self.powder_active,
            "battery_voltage": round(self.battery_voltage, 2),
            "battery_pct": self.battery_pct,
            "wifi_signal": self.wifi_signal_dbm,
            "connected": self.connected,
            "authenticated": self.authenticated,
            "estop_active": self.estop_active,
            "timestamp": self.last_updated
        }
