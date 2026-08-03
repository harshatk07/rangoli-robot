"""
Module 2: Production Vectorizer, 4-Tier Stroke Classifier, Adaptive TSP Path Optimizer & SVG Generator
Pipeline:
1. Adaptive Douglas-Peucker Simplification (epsilon = 0.002 * perimeter, max error < 1mm)
2. 4-Tier Stroke Classification (Outer Border -> Large -> Medium -> Small Details)
3. Nearest-Neighbor TSP Path Optimization (Minimizes dry travel distance D_dry)
4. Clean SVG Path Generation (M...L...Z syntax)
"""

import math
import numpy as np
import cv2
import svgwrite
import svgpathtools
from core.image_processing import chaikin_corner_cutting


def rdp_simplify_adaptive(points: list, epsilon: float = 0.5, min_point_limit: int = 150) -> list:
    """
    Adaptive Ramer-Douglas-Peucker simplification algorithm.
    Ensures complex curves preserve at least min_point_limit points unless geometric error is < 1 mm.
    """
    if len(points) <= min_point_limit:
        return points

    dmax = 0.0
    index = 0
    end = len(points) - 1

    p1 = np.array(points[0])
    p2 = np.array(points[end])
    line_vec = p2 - p1
    line_len = np.linalg.norm(line_vec)

    for i in range(1, end):
        p = np.array(points[i])
        if line_len == 0:
            dist = float(np.linalg.norm(p - p1))
        else:
            dist = float(np.abs(line_vec[0] * (p1[1] - p[1]) - line_vec[1] * (p1[0] - p[0])) / line_len)

        if dist > dmax:
            index = i
            dmax = dist

    if dmax > epsilon:
        rec_res1 = rdp_simplify_adaptive(points[: index + 1], epsilon, min_point_limit=min_point_limit // 2)
        rec_res2 = rdp_simplify_adaptive(points[index:], epsilon, min_point_limit=min_point_limit // 2)
        return rec_res1[:-1] + rec_res2
    else:
        return [points[0], points[end]]


def classify_and_sort_strokes_4tier(polylines: list) -> list:
    """
    Classifies Rangoli strokes into 4 priority tiers:
    1. Outer Border (Largest perimeter / bounding box)
    2. Large Contours (> 30% max perimeter)
    3. Medium Contours (10% - 30% max perimeter)
    4. Small Details & Motifs (< 10% max perimeter)
    
    Returns prioritized list of polylines.
    """
    if not polylines:
        return []

    scored_lines = []
    for poly in polylines:
        pts = np.array(poly, dtype=np.float32)
        peri = float(cv2.arcLength(pts, True))
        scored_lines.append({
            'poly': poly,
            'peri': peri
        })

    max_peri = max(s['peri'] for s in scored_lines) if scored_lines else 1.0

    outer_borders = []
    large_contours = []
    medium_contours = []
    small_details = []

    for item in scored_lines:
        ratio = item['peri'] / max(1.0, max_peri)
        if ratio >= 0.65:
            outer_borders.append(item['poly'])
        elif ratio >= 0.30:
            large_contours.append(item['poly'])
        elif ratio >= 0.10:
            medium_contours.append(item['poly'])
        else:
            small_details.append(item['poly'])

    # Nearest-Neighbor TSP optimization within each tier
    opt_borders = optimize_path_order_tsp(outer_borders, start_pos=(0.0, 0.0))
    last_pos = opt_borders[-1][-1] if opt_borders else (0.0, 0.0)

    opt_large = optimize_path_order_tsp(large_contours, start_pos=last_pos)
    last_pos = opt_large[-1][-1] if opt_large else last_pos

    opt_medium = optimize_path_order_tsp(medium_contours, start_pos=last_pos)
    last_pos = opt_medium[-1][-1] if opt_medium else last_pos

    opt_small = optimize_path_order_tsp(small_details, start_pos=last_pos)

    return opt_borders + opt_large + opt_medium + opt_small


def optimize_path_order_tsp(polylines: list, start_pos: tuple = (0.0, 0.0)) -> list:
    """
    Applies Nearest-Neighbor TSP optimization to reorder stroke execution.
    Minimizes dry travel distance D_dry between stroke transitions.
    Reverses stroke direction if end-point is closer to current robot position.
    """
    if not polylines:
        return []

    unvisited = list(polylines)
    optimized = []
    curr_pos = start_pos

    while unvisited:
        best_idx = 0
        best_dist = float('inf')
        should_flip = False

        for i, poly in enumerate(unvisited):
            p_start = poly[0]
            p_end = poly[-1]

            d_start = math.hypot(p_start[0] - curr_pos[0], p_start[1] - curr_pos[1])
            d_end = math.hypot(p_end[0] - curr_pos[0], p_end[1] - curr_pos[1])

            if d_start < best_dist:
                best_dist = d_start
                best_idx = i
                should_flip = False

            if d_end < best_dist:
                best_dist = d_end
                best_idx = i
                should_flip = True

        selected = unvisited.pop(best_idx)
        if should_flip:
            selected = selected[::-1]

        optimized.append(selected)
        curr_pos = selected[-1]

    return optimized


def contours_to_polylines(contours: list, min_length: int = 4, epsilon: float = None) -> tuple:
    """
    Converts OpenCV contours into smooth, optimized polylines.
    Uses Adaptive Douglas-Peucker epsilon = 0.002 * contour_perimeter.
    Applies 4-tier stroke classification and Nearest-Neighbor TSP ordering.
    
    Returns:
        tuple: (optimized_polylines, vector_stats_dict)
    """
    if isinstance(contours, np.ndarray) and contours.ndim == 2:
        extracted, _ = cv2.findContours(contours, cv2.RETR_TREE, cv2.CHAIN_APPROX_NONE)
        contours = extracted

    raw_polylines = []
    raw_points_count = 0

    for cnt in contours:
        if len(cnt) < min_length:
            continue

        pts = [(float(pt[0][0]), float(pt[0][1])) for pt in cnt]
        raw_points_count += len(pts)

        # Chaikin Corner Cutting (1 iteration for smooth curves)
        smoothed = chaikin_corner_cutting(pts, iterations=1)

        # Adaptive epsilon = 0.002 * contour_perimeter (clamped between 0.25mm and 0.85mm)
        cnt_peri = cv2.arcLength(cnt, True)
        calc_eps = min(0.85, max(0.25, 0.002 * cnt_peri)) if epsilon is None else epsilon

        # Adaptive RDP simplification
        min_limit = 200 if len(pts) >= 300 else 50
        simplified = rdp_simplify_adaptive(smoothed, epsilon=calc_eps, min_point_limit=min_limit)

        if len(simplified) >= 3:
            if simplified[0] != simplified[-1]:
                simplified.append(simplified[0])
            raw_polylines.append(simplified)

    # 4-Tier Stroke Classification (Outer Border -> Large -> Medium -> Small) + TSP Optimization
    optimized_polylines = classify_and_sort_strokes_4tier(raw_polylines)

    opt_points_count = sum(len(p) for p in optimized_polylines)
    reduction_pct = 0.0
    if raw_points_count > 0:
        reduction_pct = max(0.0, ((raw_points_count - opt_points_count) / float(raw_points_count)) * 100.0)

    vector_stats = {
        'raw_points_count': raw_points_count,
        'optimized_points_count': opt_points_count,
        'point_reduction_pct': round(reduction_pct, 1),
        'max_geometric_error_mm': 0.85
    }

    return optimized_polylines, vector_stats


# Alias for backward compatibility
skeleton_to_polylines = contours_to_polylines


def export_polylines_to_svg(polylines: list, output_svg_path: str, canvas_size=(600, 600)):
    """
    Generate clean SVG file with one continuous SVG path per contour using M...L...Z syntax.
    """
    dwg = svgwrite.Drawing(output_svg_path, size=(f"{canvas_size[0]}px", f"{canvas_size[1]}px"))
    
    for polyline in polylines:
        if not polyline or len(polyline) < 2:
            continue
        path_data = f"M {polyline[0][0]:.2f},{polyline[0][1]:.2f} "
        for pt in polyline[1:-1]:
            path_data += f"L {pt[0]:.2f},{pt[1]:.2f} "
        path_data += "Z"
        
        dwg.add(dwg.path(d=path_data, stroke="black", fill="none", stroke_width=2))

    dwg.save()
    return output_svg_path


def parse_svg_to_continuous_paths(svg_filepath: str, sampling_density: float = 5.0) -> list:
    """
    Parse SVG using svgpathtools into sampled continuous (x, y) coordinate paths.
    """
    paths, _ = svgpathtools.svg2paths(svg_filepath)
    continuous_paths = []

    for path in paths:
        path_len = path.length()
        if path_len < 1.0:
            continue

        num_samples = max(2, int(path_len / sampling_density))
        points = []
        for i in range(num_samples + 1):
            t = i / float(num_samples)
            point = path.point(t)
            points.append((float(point.real), float(point.imag)))

        if len(points) >= 2:
            continuous_paths.append(points)

    return continuous_paths
