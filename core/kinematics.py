"""
Module 4: Differential Drive Kinematics & ESP32 Command Generator
Pipeline Step: Grid-aware path segments -> ESP32 motion command queue.

Converts (x, y) continuous coordinate trajectories into differential drive robot commands:
- TURN: Rotate relative angle in degrees (-180 to +180)
- MOVE: Forward/Backward distance in mm
- DISPENSE: Actuate Rangoli powder servo dispenser (1 = ON, 0 = OFF)
"""

import math


class KinematicSolver:
    def __init__(self, wheelbase_mm: float = 120.0, wheel_diameter_mm: float = 44.0, encoder_cpr: int = 360):
        """
        Wheelbase: Distance between center of left and right wheels (mm).
        Wheel diameter: Diameter of driving wheels (mm).
        CPR: Counts per revolution of motor encoder.
        """
        self.wheelbase = wheelbase_mm
        self.wheel_diameter = wheel_diameter_mm
        self.wheel_circumference = math.pi * wheel_diameter_mm
        self.encoder_cpr = encoder_cpr

        # Initial pose assumption: Top-Left (A1) = (0.0, 0.0), facing East (0 degrees)
        self.x = 0.0
        self.y = 0.0
        self.theta = 0.0  # Degrees
        self.dispenser_state = 0  # 0 = OFF, 1 = ON

    def normalize_angle(self, angle_deg: float) -> float:
        """Normalize angle to range [-180, +180] degrees."""
        while angle_deg > 180.0:
            angle_deg -= 360.0
        while angle_deg <= -180.0:
            angle_deg += 360.0
        return angle_deg

    def generate_commands(self, execution_segments: list) -> list:
        """
        Input: Execution segments from grid_planner
               [{'type': 'DRAW'/'MOVE', 'pts': [(x1,y1), (x2,y2)...], 'dispense': True/False}, ...]
        Returns: List of JSON-serializable commands for ESP32 with closed-loop speed parameters.
        """
        commands = []
        self.x = 0.0
        self.y = 0.0
        self.theta = 0.0
        self.dispenser_state = 0

        commands.append({"cmd": "DISPENSE", "state": 0})

        for seg in execution_segments:
            pts = seg['pts']
            target_dispense = 1 if seg['dispense'] else 0

            for i in range(len(pts)):
                target_x, target_y = pts[i]
                dx = target_x - self.x
                dy = target_y - self.y
                distance = math.hypot(dx, dy)

                if distance < 0.5:
                    continue

                target_angle = math.degrees(math.atan2(dy, dx))
                angle_diff = self.normalize_angle(target_angle - self.theta)

                # 1. Turn to face target if heading error >= 2.0 degrees
                if abs(angle_diff) >= 2.0:
                    if self.dispenser_state != 0:
                        commands.append({"cmd": "DISPENSE", "state": 0})
                        self.dispenser_state = 0

                    commands.append({
                        "cmd": "TURN",
                        "angle": round(angle_diff, 1),
                        "speed": 80
                    })
                    self.theta = self.normalize_angle(self.theta + angle_diff)

                # 2. Set dispenser state for drawing
                if self.dispenser_state != target_dispense:
                    commands.append({"cmd": "DISPENSE", "state": target_dispense})
                    self.dispenser_state = target_dispense

                # 3. Move forward to target
                commands.append({
                    "cmd": "MOVE",
                    "dist": round(distance, 1),
                    "speed": 100
                })

                self.x = target_x
                self.y = target_y

        if self.dispenser_state != 0:
            commands.append({"cmd": "DISPENSE", "state": 0})
            self.dispenser_state = 0

        commands.append({"cmd": "FINISH"})
        return commands
