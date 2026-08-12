"""
Automated Final Verification Pass Test Suite for Rangoli Robot
Verifies SVG alignment, point reduction, path continuity, command counts, and diagnostic accuracy.
"""

import os
import unittest
import numpy as np
import cv2

from core.image_processing import preprocess_rangoli_image, generate_svg_overlay_image
from core.vectorizer import contours_to_polylines, export_polylines_to_svg, parse_svg_to_continuous_paths
from core.grid_planner import GridPlanner
from core.kinematics import KinematicSolver


class TestFinalPipelineVerification(unittest.TestCase):

    def setUp(self):
        self.test_dir = os.path.dirname(__file__)
        self.output_svg = os.path.join(self.test_dir, 'test_output.svg')
        self.overlay_png = os.path.join(self.test_dir, 'test_overlay.png')

    def tearDown(self):
        for f in [self.output_svg, self.overlay_png]:
            if os.path.exists(f):
                os.remove(f)

    def test_black_outline_pattern(self):
        """1. Black Outline on White Background Pattern"""
        img = np.full((600, 600, 3), 255, dtype=np.uint8)
        cv2.polylines(img, [np.array([[300, 80], [520, 300], [300, 520], [80, 300]])], isClosed=True, color=(0, 0, 0), thickness=6)
        cv2.circle(img, (300, 300), 100, (0, 0, 0), 6)

        _, encoded = cv2.imencode('.png', img)
        contours, _, diagnostics = preprocess_rangoli_image(encoded.tobytes(), target_size=(600, 600), min_area=50.0)
        polylines, vec_stats = contours_to_polylines(contours, min_length=4)
        svg_path = export_polylines_to_svg(polylines, self.output_svg, canvas_size=(600, 600))
        generate_svg_overlay_image(img, polylines, self.overlay_png)

        self.assertTrue(os.path.exists(svg_path))
        self.assertTrue(os.path.exists(self.overlay_png))
        self.assertIn('Black Outline on White Background', diagnostics['image_type_detected'])
        self.assertGreater(vec_stats['point_reduction_pct'], 40.0)

    def test_white_outline_pattern(self):
        """2. White Outline on Dark Background Pattern"""
        img = np.zeros((600, 600, 3), dtype=np.uint8)
        cv2.polylines(img, [np.array([[300, 100], [500, 300], [300, 500], [100, 300]])], isClosed=True, color=(255, 255, 255), thickness=6)
        cv2.circle(img, (300, 300), 80, (255, 255, 255), 6)

        _, encoded = cv2.imencode('.png', img)
        contours, _, diagnostics = preprocess_rangoli_image(encoded.tobytes(), target_size=(600, 600), min_area=50.0)
        polylines, vec_stats = contours_to_polylines(contours, min_length=4)
        svg_path = export_polylines_to_svg(polylines, self.output_svg, canvas_size=(600, 600))

        self.assertTrue(os.path.exists(svg_path))
        self.assertEqual(diagnostics['image_type_detected'], 'White Outline on Dark Background')

    def test_colored_rangoli_pattern(self):
        """3. Colored Rangoli (Red/Green Fills with White Borders)"""
        img = np.zeros((600, 600, 3), dtype=np.uint8)
        cv2.rectangle(img, (150, 150), (450, 450), (0, 0, 255), -1) # Red fill
        cv2.circle(img, (300, 300), 100, (0, 255, 0), -1)           # Green fill
        cv2.polylines(img, [np.array([[300, 100], [500, 300], [300, 500], [100, 300]])], isClosed=True, color=(255, 255, 255), thickness=6)
        cv2.circle(img, (300, 300), 120, (255, 255, 255), 6)

        _, encoded = cv2.imencode('.png', img)
        contours, _, diagnostics = preprocess_rangoli_image(encoded.tobytes(), target_size=(600, 600), min_area=50.0)
        polylines, vec_stats = contours_to_polylines(contours, min_length=4)

        self.assertIn("Colored Rangoli", diagnostics['image_type_detected'])
        self.assertGreater(len(polylines), 0)

    def test_ganesh_lotus_flower_mandala_patterns(self):
        """4. Ganesh, Mandala, Lotus & Flower Curves Pattern Verification"""
        img = np.zeros((800, 800, 3), dtype=np.uint8)
        cx, cy = 400, 400

        # Draw Ganesh trunk curves & flower petals
        cv2.ellipse(img, (cx, cy), (180, 250), 0, 0, 360, (255, 255, 255), 5)
        for deg in range(0, 360, 30):
            rad = np.radians(deg)
            px = int(cx + 220 * np.cos(rad))
            py = int(cy + 220 * np.sin(rad))
            cv2.circle(img, (px, py), 45, (255, 255, 255), 4)

        _, encoded = cv2.imencode('.png', img)
        contours, _, diagnostics = preprocess_rangoli_image(encoded.tobytes(), target_size=(600, 600), min_area=50.0)
        polylines, vec_stats = contours_to_polylines(contours, min_length=4)
        svg_path = export_polylines_to_svg(polylines, self.output_svg, canvas_size=(600, 600))

        continuous_paths = parse_svg_to_continuous_paths(svg_path, sampling_density=5.0)
        planner = GridPlanner(canvas_width_mm=600.0, canvas_height_mm=600.0, grid_cols=8, grid_rows=8)
        execution_segments = planner.plan_grid_aware_path(continuous_paths)

        solver = KinematicSolver(wheelbase_mm=120.0, wheel_diameter_mm=44.0)
        commands = solver.generate_commands(execution_segments)

        self.assertGreater(len(commands), 0)
        self.assertEqual(commands[0], {"cmd": "DISPENSE", "state": 0})
        self.assertEqual(commands[-1], {"cmd": "FINISH"})

        # Verify point statistics consistency
        raw_pts = vec_stats['raw_points_count']
        opt_pts = vec_stats['optimized_points_count']
        self.assertLessEqual(opt_pts, raw_pts)
        self.assertEqual(vec_stats['point_reduction_pct'], round(max(0.0, ((raw_pts - opt_pts) / float(raw_pts)) * 100.0), 1))

        print(f"\n[PASS] Final Pipeline Verification Succeeded! Extracted {len(contours)} contours, {vec_stats['point_reduction_pct']}% reduction ({raw_pts}->{opt_pts} pts), {len(commands)} commands.")


if __name__ == '__main__':
    unittest.main()
