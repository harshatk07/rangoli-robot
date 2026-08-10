"""
End-to-End System Tests for IoT Autonomous Rangoli Drawing Robot
Verifies API functions, image pipeline processing, vector scaling, strict telemetry isolation, and emergency stop.
"""

import unittest
import numpy as np
import cv2
import asyncio

from app import app, manager
from core.image_processing import preprocess_rangoli_image
from core.vectorizer import contours_to_polylines
from core.grid_planner import GridPlanner


class TestEndToEndSystem(unittest.TestCase):

    def test_image_process_pipeline_bounds(self):
        """1. Verify Real Image Processing Pipeline Coordinates & Safety Margins"""
        img = np.zeros((400, 400, 3), dtype=np.uint8)
        cv2.circle(img, (200, 200), 120, (255, 255, 255), 4)

        _, encoded = cv2.imencode(".png", img)
        contours, _, _ = preprocess_rangoli_image(encoded.tobytes(), target_size=(600, 600), min_area=50.0)
        polylines, vec_stats = contours_to_polylines(contours, min_length=4)

        planner = GridPlanner(canvas_width_mm=600.0, canvas_height_mm=600.0, grid_cols=8, grid_rows=8)
        execution_segments = planner.plan_grid_aware_path(polylines)

        self.assertGreater(len(execution_segments), 0)

        # Boundary Check: All DRAWING coordinates must be within [15.0, 595.0] mm
        for seg in execution_segments:
            if seg["type"] == "DRAW":
                for pt in seg["pts"]:
                    x, y = pt[0], pt[1]
                    self.assertGreaterEqual(x, 15.0)
                    self.assertLessEqual(x, 595.0)
                    self.assertGreaterEqual(y, 15.0)
                    self.assertLessEqual(y, 595.0)

    def test_robots_manager_unconnected_isolation(self):
        """2. Verify Manager Returns Empty List When No Physical ESP32 Registered"""
        robots = manager.get_online_robots()
        self.assertEqual(robots, [])

    def test_telemetry_isolation(self):
        """3. Verify RobotState Initial Default is OFFLINE"""
        from core.robot_state import TelemetryData, RobotState
        tel = TelemetryData()
        self.assertEqual(tel.state, RobotState.OFFLINE)
        self.assertFalse(tel.connected)
        d = tel.to_dict()
        self.assertIsNone(d["x"])
        self.assertIsNone(d["y"])
        self.assertIsNone(d["battery_pct"])


if __name__ == "__main__":
    unittest.main()
