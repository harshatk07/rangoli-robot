"""
Module 3: Nearest-Neighbor Path Optimization & Workspace Scaler
Pipeline Step: Continuous vector paths -> Polyline Simplification -> Nearest-Neighbor TSP Travel Minimization -> Boundary Clamping.
"""

import math
import numpy as np


class SmudgeRiskModel:
    def __init__(self, canvas_mm=600.0, grid_res_mm=5.0, wheelbase_mm=120.0, nozzle_offset_mm=60.0):
        self.canvas_mm = canvas_mm
        self.grid_res = grid_res_mm
        self.grid_dim = int(canvas_mm // grid_res_mm)  # 120x120 grid
        self.wheelbase = wheelbase_mm
        self.nozzle_offset = nozzle_offset_mm
        self.sigma_powder = 5.0
        self.gamma = 2.5

        self.powder_density = np.zeros((self.grid_dim, self.grid_dim), dtype=np.float32)
        self.risk_map = np.zeros((self.grid_dim, self.grid_dim), dtype=np.float32)

    def update_drawn_stroke(self, start_pt: tuple, end_pt: tuple):
        """Updates continuous 2D powder density and smudge risk field after drawing a stroke."""
        x0, y0 = start_pt
        x1, y1 = end_pt
        length = math.hypot(x1 - x0, y1 - y0)
        steps = max(1, int(length / 2.0))

        for step in range(steps + 1):
            t = step / float(steps)
            px = x0 + t * (x1 - x0)
            py = y0 + t * (y1 - y0)

            gx_min = max(0, int((px - 15.0) // self.grid_res))
            gx_max = min(self.grid_dim - 1, int((px + 15.0) // self.grid_res))
            gy_min = max(0, int((py - 15.0) // self.grid_res))
            gy_max = min(self.grid_dim - 1, int((py + 15.0) // self.grid_res))

            for gy in range(gy_min, gy_max + 1):
                for gx in range(gx_min, gx_max + 1):
                    cell_x = (gx + 0.5) * self.grid_res
                    cell_y = (gy + 0.5) * self.grid_res
                    d2 = (cell_x - px) ** 2 + (cell_y - py) ** 2
                    intensity = math.exp(-d2 / (2.0 * self.sigma_powder ** 2))
                    self.powder_density[gy, gx] = max(self.powder_density[gy, gx], intensity)

        self.risk_map = 1.0 - np.exp(-self.gamma * self.powder_density)

    def evaluate_trajectory_risk(self, trajectory_pts: list) -> float:
        if not trajectory_pts or len(trajectory_pts) < 2:
            return 0.0

        total_risk = 0.0
        total_samples = 0

        for i in range(len(trajectory_pts) - 1):
            p1 = trajectory_pts[i]
            p2 = trajectory_pts[i + 1]
            dx = p2[0] - p1[0]
            dy = p2[1] - p1[1]
            dist = math.hypot(dx, dy)
            theta = math.atan2(dy, dx)

            steps = max(1, int(dist / 5.0))
            for s in range(steps):
                t = s / float(steps)
                cx = p1[0] + t * dx
                cy = p1[1] + t * dy

                wl_x = cx - (self.wheelbase / 2.0) * math.sin(theta)
                wl_y = cy + (self.wheelbase / 2.0) * math.cos(theta)
                wr_x = cx + (self.wheelbase / 2.0) * math.sin(theta)
                wr_y = cy - (self.wheelbase / 2.0) * math.cos(theta)

                risk_l = self._sample_risk_at(wl_x, wl_y)
                risk_r = self._sample_risk_at(wr_x, wr_y)

                total_risk += (risk_l + risk_r) / 2.0
                total_samples += 1

        return float(total_risk / max(1, total_samples))

    def _sample_risk_at(self, x: float, y: float) -> float:
        gx = int(x // self.grid_res)
        gy = int(y // self.grid_res)
        if 0 <= gx < self.grid_dim and 0 <= gy < self.grid_dim:
            return float(self.risk_map[gy, gx])
        return 0.0


class GridPlanner:
    def __init__(self, canvas_width_mm: float = 610.0, canvas_height_mm: float = 610.0, grid_cols: int = 8, grid_rows: int = 8, nozzle_offset_mm: float = 60.0, margin_mm: float = 15.0):
        self.canvas_width = canvas_width_mm
        self.canvas_height = canvas_height_mm
        self.grid_cols = grid_cols
        self.grid_rows = grid_rows
        self.swath_size = canvas_height_mm / float(grid_rows)
        self.margin = margin_mm
        self.min_x = margin_mm
        self.max_x = canvas_width_mm - margin_mm
        self.min_y = margin_mm
        self.max_y = canvas_height_mm - margin_mm
        self.nozzle_offset = nozzle_offset_mm
        self.risk_model = SmudgeRiskModel(canvas_mm=canvas_width_mm, grid_res_mm=5.0, nozzle_offset_mm=nozzle_offset_mm)

    def clamp_and_scale_paths(self, continuous_paths: list, drawing_size_mm: float = 610.0) -> list:
        """Scales and clamps vector paths to fit within drawing_size_mm centered in 610x610 mm canvas."""
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
        """Optimizes stroke ordering using Nearest-Neighbor TSP to eliminate long diagonal travel moves."""
        scaled_paths = self.clamp_and_scale_paths(continuous_paths, drawing_size_mm)
        if not scaled_paths:
            return []

        unvisited = list(scaled_paths)
        execution_plan = []

        current_pos = unvisited[0][0]

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

            if len(execution_plan) > 0:
                travel_d = math.hypot(start_pt[0] - current_pos[0], start_pt[1] - current_pos[1])
                if travel_d > 0.5:
                    execution_plan.append({'type': 'MOVE', 'pts': [current_pos, start_pt], 'dispense': False})

            execution_plan.append({'type': 'DRAW', 'pts': next_path, 'dispense': True})
            current_pos = end_pt

        # Update Risk Model
        for seg in execution_plan:
            if seg['type'] == 'DRAW' and len(seg['pts']) >= 2:
                pts = seg['pts']
                for i in range(len(pts) - 1):
                    self.risk_model.update_drawn_stroke(pts[i], pts[i + 1])

        return execution_plan

    def get_predicted_risk_score(self, execution_segments: list) -> float:
        all_move_pts = []
        for seg in execution_segments:
            all_move_pts.extend(seg['pts'])
        return self.risk_model.evaluate_trajectory_risk(all_move_pts)
