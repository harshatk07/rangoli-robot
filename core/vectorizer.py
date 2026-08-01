"""
Module 2: Vectorizer & SVG Generator
Pipeline Step: Skeletonized image -> SVG generation (svgwrite) -> Path extraction (svgpathtools).
"""

import math
import numpy as np
import svgwrite
import svgpathtools


def rdp_simplify(points: list, epsilon: float = 2.0) -> list:
    """
    Ramer-Douglas-Peucker algorithm for polyline curve simplification.
    Reduces redundant collinear points while keeping shapes accurate.
    """
    if len(points) < 3:
        return points

    dmax = 0.0
    index = 0
    end = len(points) - 1

    # Calculate distance of each point from line between first and last point
    p1 = np.array(points[0])
    p2 = np.array(points[end])
    line_vec = p2 - p1
    line_len = np.linalg.norm(line_vec)

    for i in range(1, end):
        p = np.array(points[i])
        if line_len == 0:
            dist = float(np.linalg.norm(p - p1))
        else:
            # 2D perpendicular distance calculation compatible with NumPy 2.x
            dist = float(np.abs(line_vec[0] * (p1[1] - p[1]) - line_vec[1] * (p1[0] - p[0])) / line_len)

        if dist > dmax:
            index = i
            dmax = dist

    if dmax > epsilon:
        rec_res1 = rdp_simplify(points[: index + 1], epsilon)
        rec_res2 = rdp_simplify(points[index:], epsilon)
        return rec_res1[:-1] + rec_res2
    else:
        return [points[0], points[end]]


def skeleton_to_polylines(skeleton_img: np.ndarray, min_length: int = 5, epsilon: float = 2.0) -> list:
    """
    Extract ordered polylines from single-pixel skeleton matrix.
    Returns: List of continuous polylines [[(x1,y1), (x2,y2), ...], ...]
    """
    import cv2

    # Find contours from skeleton image
    contours, _ = cv2.findContours(skeleton_img, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)

    polylines = []
    for cnt in contours:
        if len(cnt) < min_length:
            continue

        # Extract (x, y) coordinates
        pts = [(float(pt[0][0]), float(pt[0][1])) for pt in cnt]
        
        # Apply RDP simplification
        simplified_pts = rdp_simplify(pts, epsilon=epsilon)
        if len(simplified_pts) >= 2:
            polylines.append(simplified_pts)

    return polylines


def export_polylines_to_svg(polylines: list, output_svg_path: str, canvas_size=(600, 600)):
    """
    Generate clean SVG file from polylines using svgwrite library.
    """
    dwg = svgwrite.Drawing(output_svg_path, size=(f"{canvas_size[0]}px", f"{canvas_size[1]}px"))
    
    for polyline in polylines:
        path_data = f"M {polyline[0][0]},{polyline[0][1]} "
        for pt in polyline[1:]:
            path_data += f"L {pt[0]},{pt[1]} "
        
        dwg.add(dwg.path(d=path_data, stroke="black", fill="none", stroke_width=2))

    dwg.save()
    return output_svg_path


def parse_svg_to_continuous_paths(svg_filepath: str, sampling_density: float = 5.0) -> list:
    """
    Parse SVG using svgpathtools into sampled continuous (x, y) coordinate paths.
    
    Returns:
        List of continuous paths: [ [(x1,y1), (x2,y2), ...], [(x1,y1), ...], ... ]
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
