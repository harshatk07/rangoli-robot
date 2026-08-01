"""
Automated End-to-End Pipeline Test for Rangoli Robot
"""

import os
import unittest
import numpy as np
import cv2

from core.image_processing import preprocess_rangoli_image
from core.vectorizer import skeleton_to_polylines, export_polylines_to_svg, parse_svg_to_continuous_paths
from core.grid_planner import GridPlanner
from core.kinematics import KinematicSolver


class TestRangoliPipeline(unittest.TestCase):

    def setUp(self):
        # Create a synthetic 600x600 test Rangoli pattern (White lines on Black background)
        self.test_img = np.zeros((600, 600, 3), dtype=np.uint8)
        # Draw a Rangoli star / diamond pattern
        cv2.polylines(self.test_img, [np.array([[300, 100], [500, 300], [300, 500], [100, 300]])], isClosed=True, color=(255, 255, 255), thickness=6)
        cv2.circle(self.test_img, (300, 300), 80, (255, 255, 255), 6)

        _, self.img_encoded = cv2.imencode('.png', self.test_img)
        self.img_bytes = self.img_encoded.tobytes()

        self.test_dir = os.path.dirname(__file__)
        self.output_svg = os.path.join(self.test_dir, 'test_output.svg')

    def tearDown(self):
        if os.path.exists(self.output_svg):
            os.remove(self.output_svg)

    def test_full_pipeline(self):
        # 1. Module 1: Preprocessing & Skeletonization
        skeleton = preprocess_rangoli_image(self.img_bytes, target_size=(600, 600))
        self.assertEqual(skeleton.shape, (600, 600))
        self.assertTrue(np.max(skeleton) == 255)

        # 2. Module 2: Vectorization & SVG Export
        polylines = skeleton_to_polylines(skeleton, min_length=5, epsilon=2.0)
        self.assertGreater(len(polylines), 0)

        svg_path = export_polylines_to_svg(polylines, self.output_svg, canvas_size=(600, 600))
        self.assertTrue(os.path.exists(svg_path))

        continuous_paths = parse_svg_to_continuous_paths(svg_path, sampling_density=5.0)
        self.assertGreater(len(continuous_paths), 0)

        # 3. Module 3: Grid Planner (Serpentine + Top-Left A1)
        planner = GridPlanner(canvas_width_mm=600.0, canvas_height_mm=600.0, grid_cols=6, grid_rows=6)
        execution_segments = planner.plan_grid_aware_path(continuous_paths)
        self.assertGreater(len(execution_segments), 0)

        # 4. Module 4: Kinematics & ESP32 Commands
        solver = KinematicSolver(wheelbase_mm=120.0, wheel_diameter_mm=44.0)
        commands = solver.generate_commands(execution_segments)

        self.assertGreater(len(commands), 0)
        # Ensure commands start with DISPENSE 0 and end with FINISH
        self.assertEqual(commands[0], {"cmd": "DISPENSE", "state": 0})
        self.assertEqual(commands[-1], {"cmd": "FINISH"})

        print(f"\n[PASS] Pipeline Test Succeeded! Generated {len(commands)} ESP32 motion commands.")


if __name__ == '__main__':
    unittest.main()
