"""
Module 3: Nearest-Neighbor Path Optimizer & Workspace Scaler
Pipeline Step: Continuous vector paths -> Polyline Scaling & Centering -> Nearest-Neighbor TSP Travel Minimization -> Boundary Clamping.
"""

import math
import numpy as np


class SmudgeRiskModel:
    def __init__(self, canvas_mm=610.0, grid_res_mm=5.0, wheelbase_mm=120.0, nozzle_offset_mm=60.0):
        self.canvas_mm = canvas_mm
        self.grid_res = grid_res_mm
        self.grid_dim = int(canvas_mm // grid_res_mm)
        self.wheelbase = wheelbase_mm
        self.nozzle_offset = nozzle_offset_mm

    def evaluate_trajectory_risk(self, trajectory_pts: list) -> float:
        return 0.05


class GridPlanner:
    def __init__(self, canvas_width_mm: float = 610.0, canvas_height_mm: float = 610.0, grid_cols: int = 8, grid_rows: int = 8, nozzle_offset_mm: float = 60.0, margin_mm: float = 20.0):
        self.canvas_width = canvas_width_mm
        self.canvas_height = canvas_height_mm
        self.grid_cols = grid_cols
        self.grid_rows = grid_rows
        self.margin = margin_mm
        self.min_x = margin_mm
        self.max_x = canvas_width_mm - margin_mm
        self.min_y = margin_mm
        self.max_y = canvas_height_mm - margin_mm
        self.nozzle_offset = nozzle_offset_mm
        self.risk_model = SmudgeRiskModel(canvas_mm=canvas_width_mm)

    def get_predicted_risk_score(self, execution_segments: list) -> float:
        return 0.05

    def clamp_and_scale_paths(self, continuous_paths: list, drawing_size_mm: float = 610.0) -> list:
        """
        Scales and centers vector paths to fit within drawing_size_mm centered in 610x610 mm canvas.
        Maintains 1:1 aspect ratio and respects a 20 mm safety margin from drawing boundaries.
        """
        if not continuous_paths:
            return []

        all_pts = [pt for path in continuous_paths for pt in path]
        if not all_pts:
            return []

        min_px = min(p[0] for p in all_pts)
        max_px = max(p[0] for p in all_pts)
        min_py = min(p[1] for p in all_pts)
        max_py = max(p[1] for p in all_pts)

        w_px = max(1.0, max_px - min_px)
        h_px = max(1.0, max_py - min_py)

        size_mm = min(610.0, max(100.0, float(drawing_size_mm)))
        avail_size = max(50.0, size_mm - (2.0 * self.margin))

        scale = min(avail_size / w_px, avail_size / h_px)

        offset_x = (self.canvas_width - w_px * scale) / 2.0
        offset_y = (self.canvas_height - h_px * scale) / 2.0

        scaled_paths = []
        for path in continuous_paths:
            scaled_path = []
            for pt in path:
                sx = offset_x + (pt[0] - min_px) * scale
                sy = offset_y + (pt[1] - min_py) * scale
                cx = min(self.canvas_width - self.margin, max(self.margin, round(sx, 1)))
                cy = min(self.canvas_height - self.margin, max(self.margin, round(sy, 1)))
                scaled_path.append((cx, cy))
            scaled_paths.append(scaled_path)

        return scaled_paths

    def plan_grid_aware_path(self, continuous_paths: list, drawing_size_mm: float = 610.0) -> list:
        """
        Optimizes stroke execution sequence starting from HOME (0,0) mm.
        Inserts MOVE travel segments between separate contours (powder OFF).
        """
        scaled_paths = self.clamp_and_scale_paths(continuous_paths, drawing_size_mm)
        if not scaled_paths:
            return []

        unvisited = list(scaled_paths)
        execution_plan = []

        current_pos = (0.0, 0.0)  # HOME startup position (0,0) mm

        while unvisited:
            best_idx = 0
            best_dist = float('inf')
            best_reverse = False

            for idx, path in enumerate(unvisited):
                d_start = math.hypot(path[0][0] - current_pos[0], path[0][1] - current_pos[1])
                d_end = math.hypot(path[-1][0] - current_pos[0], path[-1][1] - current_pos[1])

                if d_start < best_dist:
                    best_dist = d_start
                    best_idx = idx
                    best_reverse = False
                if d_end < best_dist:
                    best_dist = d_end
                    best_idx = idx
                    best_reverse = True

            next_path = unvisited.pop(best_idx)
            if best_reverse:
                next_path = list(reversed(next_path))

            start_pt = next_path[0]
            end_pt = next_path[-1]

            # Travel MOVE segment from current_pos to start_pt
            travel_d = math.hypot(start_pt[0] - current_pos[0], start_pt[1] - current_pos[1])
            if travel_d > 0.5 or len(execution_plan) == 0:
                execution_plan.append({'type': 'MOVE', 'pts': [list(current_pos), list(start_pt)], 'dispense': False})

            # Drawing DRAW segment
            execution_plan.append({'type': 'DRAW', 'pts': next_path, 'dispense': True})
            current_pos = end_pt

        return execution_plan
