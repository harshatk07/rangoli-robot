"""
Module 1: Single-Color Rangoli White Boundary Extraction, Auto-Crop & Contour Pipeline
Pipeline:
1. White Boundary Isolation (Filters out colored powder fills: red, green, blue, yellow, orange, purple)
2. Adaptive Thresholding (Handles Black/White, Photo, Color)
3. Perspective Correction (Quadrilateral transform for angled mobile photos)
4. Auto-Crop & Centering (Crop empty margins, pad 5%, scale & center on 600x600 mm canvas)
5. Morphological Closing & Opening
6. FindContours (RETR_TREE, CHAIN_APPROX_NONE)
7. Min Area Filtering & Duplicate Contour Removal
8. Chaikin Corner Cutting Contour Smoothing
9. SVG Overlay Image Generation
10. Extended Diagnostics & Stage Image Generation
"""

import os
import time
import math
import cv2
import numpy as np


def generate_svg_overlay_image(original_img: np.ndarray, polylines: list, output_filepath: str):
    """
    Draws extracted green vector polylines directly on top of the original image
    for clear visual verification of SVG alignment.
    """
    overlay = original_img.copy()
    for poly in polylines:
        pts = np.array(poly, dtype=np.int32).reshape((-1, 1, 2))
        cv2.polylines(overlay, [pts], isClosed=True, color=(0, 255, 128), thickness=2, lineType=cv2.LINE_AA)

    cv2.imwrite(output_filepath, overlay)
    return output_filepath


def extract_white_boundary_outline(img_bgr: np.ndarray, gray_img: np.ndarray) -> tuple:
    """
    Isolates white Rangoli boundary lines while suppressing colored powder fills
    (red, green, blue, yellow, orange, purple) and background regions.
    Target: One continuous white outline for single-color powder dispensing.
    """
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
    sat = hsv[:, :, 1]

    max_sat = float(np.max(sat))
    mean_sat = float(np.mean(sat))
    corner_pixels = np.concatenate([
        gray_img[:30, :30].ravel(),
        gray_img[:30, -30:].ravel(),
        gray_img[-30:, :30].ravel(),
        gray_img[-30:, -30:].ravel()
    ])
    mean_corner = float(np.mean(corner_pixels))

    # If image contains colored powders (high saturation present)
    if mean_sat > 25.0 or max_sat > 70.0:
        image_type = "Colored Rangoli (White Boundary Extracted, Colors Ignored)"
        lower_white = np.array([0, 0, 115], dtype=np.uint8)
        upper_white = np.array([180, 55, 255], dtype=np.uint8)
        white_mask = cv2.inRange(hsv, lower_white, upper_white)

        blurred = cv2.GaussianBlur(white_mask, (5, 5), 0)
        _, binary = cv2.threshold(blurred, 90, 255, cv2.THRESH_BINARY)
    else:
        # Monochromatic / Black & White Rangoli
        std_gray = float(np.std(gray_img))
        blurred = cv2.GaussianBlur(gray_img, (5, 5), 0)

        if mean_corner > 140.0:
            image_type = "Black Outline on White Background"
            _, binary = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
        elif std_gray > 45.0 and 40.0 < mean_corner < 215.0:
            image_type = "Camera Photograph (Adaptive Gaussian)"
            clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
            equalized = clahe.apply(gray_img)
            blurred_eq = cv2.GaussianBlur(equalized, (5, 5), 0)
            binary = cv2.adaptiveThreshold(
                blurred_eq, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 19, 5
            )
        else:
            image_type = "White Outline on Dark Background"
            _, binary = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    # Check corners of binary mask: Background corners MUST be 0 (black)!
    corner_bin = np.concatenate([
        binary[:20, :20].ravel(),
        binary[:20, -20:].ravel(),
        binary[-20:, :20].ravel(),
        binary[-20:, -20:].ravel()
    ])
    if np.mean(corner_bin) > 127:
        binary = cv2.bitwise_not(binary)

    # If binary mask has no non-zero pixels, trigger Canny Edge Detection fallback!
    if cv2.countNonZero(binary) < 50:
        image_type += " (Canny Edge Detection Fallback)"
        edges = cv2.Canny(gray_img, 30, 120)
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        binary = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel)

    return binary, image_type


def correct_perspective_if_needed(img: np.ndarray, binary: np.ndarray) -> tuple:
    """
    Detects if the photo was taken at an angle by finding outer quadrilateral bounds.
    Performs perspective transform to generate a top-down square image.
    """
    h, w = binary.shape
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    if not contours:
        return img, binary, False

    largest_cnt = max(contours, key=cv2.contourArea)
    area = cv2.contourArea(largest_cnt)
    img_area = h * w

    if area < 0.20 * img_area:
        return img, binary, False

    peri = cv2.arcLength(largest_cnt, True)
    approx = cv2.approxPolyDP(largest_cnt, 0.03 * peri, True)

    if len(approx) == 4:
        pts = approx.reshape(4, 2).astype(np.float32)

        rect = np.zeros((4, 2), dtype="float32")
        s = pts.sum(axis=1)
        rect[0] = pts[np.argmin(s)]
        rect[2] = pts[np.argmax(s)]

        diff = np.diff(pts, axis=1)
        rect[1] = pts[np.argmin(diff)]
        rect[3] = pts[np.argmax(diff)]

        side = max(w, h)
        dst = np.array([[0, 0], [side - 1, 0], [side - 1, side - 1], [0, side - 1]], dtype="float32")

        M = cv2.getPerspectiveTransform(rect, dst)
        warped_img = cv2.warpPerspective(img, M, (side, side))
        warped_binary = cv2.warpPerspective(binary, M, (side, side))

        return warped_img, warped_binary, True

    return img, binary, False


def skeletonize_binary_image(binary_img: np.ndarray) -> np.ndarray:
    """
    Applies morphological thinning (skeletonization) to convert thick stroke outlines
    into 1-pixel thin centerline vector paths. Prevents double-outline loops.
    """
    img = binary_img.copy()
    skel = np.zeros(img.shape, dtype=np.uint8)
    element = cv2.getStructuringElement(cv2.MORPH_CROSS, (3, 3))

    while True:
        eroded = cv2.erode(img, element)
        temp = cv2.dilate(eroded, element)
        temp = cv2.subtract(img, temp)
        skel = cv2.bitwise_or(skel, temp)
        img = eroded.copy()

        if cv2.countNonZero(img) == 0:
            break

    kernel_conn = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
    skel_connected = cv2.dilate(skel, kernel_conn)
    return skel_connected


def auto_crop_and_center(img: np.ndarray, binary: np.ndarray, target_size=(600, 600), pad_pct: float = 0.05) -> tuple:
    """
    Finds non-empty Rangoli bounding box, crops empty outer margins,
    centers the Rangoli with padding, and scales to target_size (600x600 mm).
    """
    non_zero = cv2.findNonZero(binary)
    if non_zero is None:
        resized_img = cv2.resize(img, target_size, interpolation=cv2.INTER_AREA)
        resized_bin = cv2.resize(binary, target_size, interpolation=cv2.INTER_AREA)
        return resized_img, resized_bin, False

    x, y, w, h = cv2.boundingRect(non_zero)
    img_h, img_w = binary.shape

    if w >= 0.95 * img_w and h >= 0.95 * img_h:
        resized_img = cv2.resize(img, target_size, interpolation=cv2.INTER_AREA)
        resized_bin = cv2.resize(binary, target_size, interpolation=cv2.INTER_AREA)
        return resized_img, resized_bin, False

    side = max(w, h)
    pad = int(side * pad_pct)
    cx, cy = x + w // 2, y + h // 2

    x1 = max(0, cx - side // 2 - pad)
    y1 = max(0, cy - side // 2 - pad)
    x2 = min(img_w, cx + side // 2 + pad)
    y2 = min(img_h, cy + side // 2 + pad)

    crop_img = img[y1:y2, x1:x2]
    crop_bin = binary[y1:y2, x1:x2]

    crop_h, crop_w = crop_bin.shape
    max_dim = max(crop_h, crop_w)

    sq_img = np.zeros((max_dim, max_dim, 3), dtype=np.uint8)
    sq_bin = np.zeros((max_dim, max_dim), dtype=np.uint8)

    dx = (max_dim - crop_w) // 2
    dy = (max_dim - crop_h) // 2

    if crop_img.ndim == 3:
        sq_img[dy:dy+crop_h, dx:dx+crop_w] = crop_img
    else:
        sq_img[dy:dy+crop_h, dx:dx+crop_w] = cv2.cvtColor(crop_img, cv2.COLOR_GRAY2BGR)

    sq_bin[dy:dy+crop_h, dx:dx+crop_w] = crop_bin

    final_img = cv2.resize(sq_img, target_size, interpolation=cv2.INTER_AREA)
    final_bin = cv2.resize(sq_bin, target_size, interpolation=cv2.INTER_AREA)

    return final_img, final_bin, True


def chaikin_corner_cutting(pts: list, iterations: int = 1) -> list:
    """
    Applies Chaikin's Corner Cutting algorithm to smooth polygon contours.
    Replaces sharp pixel corners with smooth organic curves.
    """
    if len(pts) < 4:
        return pts

    current = pts
    for _ in range(iterations):
        smoothed = []
        n = len(current)
        for i in range(n):
            p0 = current[i]
            p1 = current[(i + 1) % n]

            q = (0.75 * p0[0] + 0.25 * p1[0], 0.75 * p0[1] + 0.25 * p1[1])
            r = (0.25 * p0[0] + 0.75 * p1[0], 0.25 * p0[1] + 0.75 * p1[1])

            smoothed.append(q)
            smoothed.append(r)
        current = smoothed

    return current


def remove_duplicate_contours(contours: list, dist_threshold: float = 3.0, area_ratio_threshold: float = 0.10) -> tuple:
    """
    Filters out redundant / duplicate / near-overlapping contours.
    Returns: (filtered_contours, count_removed)
    """
    if not contours:
        return [], 0

    kept = []
    removed = 0

    for cnt in contours:
        area = cv2.contourArea(cnt)
        M = cv2.moments(cnt)
        if M["m00"] == 0:
            removed += 1
            continue
        cx = M["m10"] / M["m00"]
        cy = M["m01"] / M["m00"]

        is_dup = False
        for k_cnt, k_area, k_cx, k_cy in kept:
            d_center = math.hypot(cx - k_cx, cy - k_cy)
            a_diff = abs(area - k_area) / max(1.0, max(area, k_area))

            if d_center < dist_threshold and a_diff < area_ratio_threshold:
                is_dup = True
                break

        if is_dup:
            removed += 1
        else:
            kept.append((cnt, area, cx, cy))

    filtered = [item[0] for item in kept]
    return filtered, removed


def preprocess_rangoli_image(image_path_or_bytes, target_size=(600, 600), min_area: float = 50.0, output_dir: str = None) -> tuple:
    """
    Comprehensive Single-Color Powder Image Processing Pipeline.
    Extracts white boundary lines while suppressing colored powders (red, green, blue, yellow, orange, purple).
    
    Returns:
        tuple: (valid_contours, saved_images_dict, diagnostics_dict)
    """
    t_start = time.time()

    diagnostics = {
        'image_size_px': [0, 0],
        'image_type_detected': 'Unknown',
        'perspective_corrected': False,
        'auto_cropped': False,
        'total_contours_found': 0,
        'contours_removed': 0,
        'duplicate_contours_merged': 0,
        'valid_contours_count': 0,
        'processing_time_ms': 0.0,
        'failed_stage': None
    }

    # 1. Image Loading with PIL Fallback for WebP / PNG Alpha Transparency
    img = None
    if isinstance(image_path_or_bytes, str):
        img = cv2.imread(image_path_or_bytes, cv2.IMREAD_UNCHANGED)
        if img is None:
            try:
                from PIL import Image
                pil_img = Image.open(image_path_or_bytes).convert('RGB')
                img = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)
            except Exception as e_pil:
                print(f"[PIPELINE WARNING] PIL load failed: {e_pil}")
    else:
        file_bytes = np.frombuffer(image_path_or_bytes, dtype=np.uint8)
        img = cv2.imdecode(file_bytes, cv2.IMREAD_UNCHANGED)
        if img is None:
            try:
                from PIL import Image
                import io
                pil_img = Image.open(io.BytesIO(image_path_or_bytes)).convert('RGB')
                img = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)
            except Exception as e_pil:
                print(f"[PIPELINE WARNING] PIL decode failed: {e_pil}")

    if img is None:
        diagnostics['failed_stage'] = "Image Loading: Could not read image file or buffer."
        raise ValueError(diagnostics['failed_stage'])

    # Handle 4-channel BGRA images (e.g. transparent PNG / WebP)
    if img.ndim == 3 and img.shape[2] == 4:
        alpha = img[:, :, 3]
        bgr = img[:, :, :3]
        white_bg = np.ones_like(bgr, dtype=np.uint8) * 255
        alpha_factor = alpha[:, :, np.newaxis] / 255.0
        img = (bgr * alpha_factor + white_bg * (1.0 - alpha_factor)).astype(np.uint8)

    orig_h, orig_w = img.shape[:2]
    diagnostics['image_size_px'] = [orig_w, orig_h]

    img_resized = cv2.resize(img, target_size, interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(img_resized, cv2.COLOR_BGR2GRAY)

    # 2. Extract White Boundary Outline (Filters out colored powder fills)
    binary, img_type = extract_white_boundary_outline(img_resized, gray)
    diagnostics['image_type_detected'] = img_type

    # 3. Perspective Correction for Angled Mobile Photos
    img_corr, bin_corr, p_corrected = correct_perspective_if_needed(img_resized, binary)
    diagnostics['perspective_corrected'] = p_corrected

    # 4. Auto-Crop & Centering
    final_img, final_bin, cropped = auto_crop_and_center(img_corr, bin_corr, target_size=target_size)
    diagnostics['auto_cropped'] = cropped

    # 5. Morphological Closing & Thinning (Skeletonization)
    kernel_close = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    closing = cv2.morphologyEx(final_bin, cv2.MORPH_CLOSE, kernel_close)

    # Skeletonization converts thick outlines into single 1-pixel centerline paths
    skeleton = skeletonize_binary_image(closing)
    morphology_result = skeleton

    # 6. FindContours (RETR_LIST, CHAIN_APPROX_NONE for centerline paths)
    contours, hierarchy = cv2.findContours(morphology_result, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
    diagnostics['total_contours_found'] = len(contours)

    # 7. Min Area Filtering
    valid_contours_raw = []
    removed_small = 0
    for cnt in contours:
        area = cv2.contourArea(cnt)
        arc_len = cv2.arcLength(cnt, True)
        if area >= min_area or arc_len >= 10.0:
            valid_contours_raw.append(cnt)
        else:
            removed_small += 1

    # Canny Edge Detection Fallback if 0 valid contours were found!
    if not contours or len(valid_contours_raw) == 0:
        print("[PIPELINE] Standard thresholding produced 0 contours. Executing Canny edge detection fallback...")
        edges = cv2.Canny(gray, 30, 120)
        kernel_canny = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        morphology_result = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel_canny)
        contours, hierarchy = cv2.findContours(morphology_result, cv2.RETR_TREE, cv2.CHAIN_APPROX_NONE)
        diagnostics['total_contours_found'] = len(contours)
        diagnostics['image_type_detected'] += " (Canny Fallback)"

        valid_contours_raw = []
        for cnt in contours:
            arc_len = cv2.arcLength(cnt, True)
            if arc_len >= 8.0:
                valid_contours_raw.append(cnt)

    # 8. Duplicate Contour Removal
    valid_contours, dups_removed = remove_duplicate_contours(valid_contours_raw)
    diagnostics['contours_removed'] = removed_small
    diagnostics['duplicate_contours_merged'] = dups_removed
    diagnostics['valid_contours_count'] = len(valid_contours)

    if len(valid_contours) > 0:
        diagnostics['failed_stage'] = None
    else:
        diagnostics['failed_stage'] = f"Min Area & Duplicate Filter: All {len(contours)} contours were filtered out."

    t_end = time.time()
    diagnostics['processing_time_ms'] = round((t_end - t_start) * 1000.0, 1)

    # Create visualization image for extracted white contours
    contours_img = np.zeros((target_size[1], target_size[0], 3), dtype=np.uint8)
    if valid_contours:
        cv2.drawContours(contours_img, valid_contours, -1, (0, 255, 128), 2)

    saved_images = {}
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)
        cv2.imwrite(os.path.join(output_dir, 'original.png'), final_img)
        cv2.imwrite(os.path.join(output_dir, 'grayscale.png'), gray)
        cv2.imwrite(os.path.join(output_dir, 'threshold.png'), final_bin)
        cv2.imwrite(os.path.join(output_dir, 'morphology.png'), morphology_result)
        cv2.imwrite(os.path.join(output_dir, 'contours.png'), contours_img)
        cv2.imwrite(os.path.join(output_dir, 'edges.png'), contours_img)

        saved_images = {
            'original': 'original.png',
            'grayscale': 'grayscale.png',
            'threshold': 'threshold.png',
            'morphology': 'morphology.png',
            'contours': 'contours.png',
            'edges': 'contours.png'
        }

    return valid_contours, saved_images, diagnostics
