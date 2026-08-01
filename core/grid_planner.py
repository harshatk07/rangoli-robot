"""
Module 3: Probabilistic Smudge Risk Model (PSRM) & Adaptive Planner
Pipeline Step: Continuous vector paths -> Pre-planning geometry analysis -> Probabilistic Smudge Risk Evaluation.
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
        self.sigma_powder = 5.0  # 5mm Gaussian dispersion
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
        """Computes integrated Smudge Risk Score R(C) in [0.0, 1.0]."""
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
    def __init__(self, canvas_width_mm: float = 600.0, canvas_height_mm: float = 600.0, grid_cols: int = 8, grid_rows: int = 8, nozzle_offset_mm: float = 60.0):
        self.canvas_width = canvas_width_mm
        self.canvas_height = canvas_height_mm
        self.grid_cols = grid_cols
        self.grid_rows = grid_rows
        self.swath_size = canvas_height_mm / grid_rows
        self.nozzle_offset = nozzle_offset_mm
        self.risk_model = SmudgeRiskModel(canvas_mm=canvas_width_mm, grid_res_mm=5.0, nozzle_offset_mm=nozzle_offset_mm)

    def analyze_svg_geometry(self, continuous_paths: list) -> dict:
        """Computes topological geometric features of the Rangoli design."""
        all_pts = [pt for path in continuous_paths for pt in path]
        if not all_pts:
            return {'strategy': 'HORIZONTAL_SWATH', 'aspect_ratio': 1.0, 'direction_ratio': 1.0, 'radial_std': 1.0}

        xs = [pt[0] for pt in all_pts]
        ys = [pt[1] for pt in all_pts]

        dx_total = max(xs) - min(xs)
        dy_total = max(ys) - min(ys)
        aspect_ratio = dx_total / (dy_total + 1e-5)

        dx_sum = 0.0
        dy_sum = 0.0
        for path in continuous_paths:
            for i in range(len(path) - 1):
                dx_sum += abs(path[i+1][0] - path[i][0])
                dy_sum += abs(path[i+1][1] - path[i][1])

        direction_ratio = dx_sum / (dy_sum + 1e-5)

        cx, cy = np.mean(xs), np.mean(ys)
        radii = [math.hypot(pt[0] - cx, pt[1] - cy) for pt in all_pts]
        radial_std = float(np.std(radii) / (np.mean(radii) + 1e-5)) if radii else 1.0

        # Prototype Heuristic Strategy Selection Guidelines
        if radial_std < 0.28:
            recommended_strategy = 'RADIAL_REGION'
        elif direction_ratio < 0.85 or aspect_ratio < 0.85:
            recommended_strategy = 'VERTICAL_SWATH'
        else:
            recommended_strategy = 'HORIZONTAL_SWATH'

        return {
            'strategy': recommended_strategy,
            'aspect_ratio': round(float(aspect_ratio), 2),
            'direction_ratio': round(float(direction_ratio), 2),
            'radial_std': round(radial_std, 2)
        }

    def plan_grid_aware_path(self, continuous_paths: list) -> list:
        """Main entry point: Evaluates strategies and builds continuous risk map."""
        analysis = self.analyze_svg_geometry(continuous_paths)
        strategy = analysis['strategy']

        if strategy == 'VERTICAL_SWATH':
            segments = self._plan_vertical_swaths(continuous_paths)
        elif strategy == 'RADIAL_REGION':
            segments = self._plan_radial_regions(continuous_paths)
        else:
            segments = self._plan_horizontal_swaths(continuous_paths)

        # Update Risk Map dynamically as paths are drawn
        for seg in segments:
            if seg['type'] == 'DRAW' and len(seg['pts']) >= 2:
                pts = seg['pts']
                for i in range(len(pts) - 1):
                    self.risk_model.update_drawn_stroke(pts[i], pts[i + 1])

        return segments

    def get_predicted_risk_score(self, execution_segments: list) -> float:
        """Computes overall predicted trajectory risk score R(C) in [0.0, 1.0]."""
        all_move_pts = []
        for seg in execution_segments:
            all_move_pts.extend(seg['pts'])
        return self.risk_model.evaluate_trajectory_risk(all_move_pts)

    def _plan_horizontal_swaths(self, continuous_paths: list) -> list:
        swaths = {i: [] for i in range(self.grid_rows)}
        for path in continuous_paths:
            if len(path) < 2: continue
            min_y = min(pt[1] for pt in path)
            idx = min(self.grid_rows - 1, max(0, int(min_y // self.swath_size)))
            swaths[idx].append(path)

        execution_plan = []
        current_pos = (0.0, 0.0)

        for idx in range(self.grid_rows):
            strokes = swaths[idx]
            if not strokes: continue
            strokes.sort(key=lambda p: min(pt[0] for pt in p))

            for path in strokes:
                start_pt, end_pt = path[0], path[-1]
                if math.hypot(end_pt[0] - current_pos[0], end_pt[1] - current_pos[1]) < math.hypot(start_pt[0] - current_pos[0], start_pt[1] - current_pos[1]):
                    path = list(reversed(path))
                    start_pt, end_pt = path[0], path[-1]

                if math.hypot(start_pt[0] - current_pos[0], start_pt[1] - current_pos[1]) > 2.0:
                    execution_plan.append({'type': 'MOVE', 'pts': [current_pos, start_pt], 'dispense': False})

                execution_plan.append({'type': 'DRAW', 'pts': path, 'dispense': True})
                current_pos = end_pt

        return execution_plan

    def _plan_vertical_swaths(self, continuous_paths: list) -> list:
        swaths = {i: [] for i in range(self.grid_cols)}
        for path in continuous_paths:
            if len(path) < 2: continue
            min_x = min(pt[0] for pt in path)
            idx = min(self.grid_cols - 1, max(0, int(min_x // self.swath_size)))
            swaths[idx].append(path)

        execution_plan = []
        current_pos = (0.0, 0.0)

        for idx in range(self.grid_cols):
            strokes = swaths[idx]
            if not strokes: continue
            strokes.sort(key=lambda p: min(pt[1] for pt in p))

            for path in strokes:
                start_pt, end_pt = path[0], path[-1]
                if math.hypot(end_pt[0] - current_pos[0], end_pt[1] - current_pos[1]) < math.hypot(start_pt[0] - current_pos[0], start_pt[1] - current_pos[1]):
                    path = list(reversed(path))
                    start_pt, end_pt = path[0], path[-1]

                if math.hypot(start_pt[0] - current_pos[0], start_pt[1] - current_pos[1]) > 2.0:
                    execution_plan.append({'type': 'MOVE', 'pts': [current_pos, start_pt], 'dispense': False})

                execution_plan.append({'type': 'DRAW', 'pts': path, 'dispense': True})
                current_pos = end_pt

        return execution_plan

    def _plan_radial_regions(self, continuous_paths: list) -> list:
        cx, cy = 300.0, 300.0
        sorted_paths = sorted(continuous_paths, key=lambda p: min(math.hypot(pt[0] - cx, pt[1] - cy) for pt in p))

        execution_plan = []
        current_pos = (0.0, 0.0)

        for path in sorted_paths:
            if len(path) < 2: continue
            start_pt, end_pt = path[0], path[-1]

            if math.hypot(end_pt[0] - current_pos[0], end_pt[1] - current_pos[1]) < math.hypot(start_pt[0] - current_pos[0], start_pt[1] - current_pos[1]):
                path = list(reversed(path))
                start_pt, end_pt = path[0], path[-1]

            if math.hypot(start_pt[0] - current_pos[0], start_pt[1] - current_pos[1]) > 2.0:
                execution_plan.append({'type': 'MOVE', 'pts': [current_pos, start_pt], 'dispense': False})

            execution_plan.append({'type': 'DRAW', 'pts': path, 'dispense': True})
            current_pos = end_pt

        return execution_plan
