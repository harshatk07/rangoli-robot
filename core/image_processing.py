"""
Module 1: Production Single-Color Rangoli Line Art & Contour Vectorization Pipeline
Pipeline:
1. Multi-Format Image Loading (PNG, JPG, WEBP, transparent alpha channel handling)
2. Contrast Normalization (CLAHE / Otsu adaptive thresholding)
3. Noise Reduction (Bilateral & Gaussian Filtering)
4. Connected Component Contour Detection (cv2.RETR_TREE)
5. Conservative Douglas-Peucker Vector Simplification
6. Continuous Path & Bounding Box Preservation
"""

import os
import time
import math
import cv2
import numpy as np


def generate_svg_overlay_image(original_img: np.ndarray, polylines: list, output_filepath: str):
    """
    Draws extracted green vector polylines directly on top of original image.
    """
    overlay = original_img.copy()
    for poly in polylines:
        pts = np.array(poly, dtype=np.int32).reshape((-1, 1, 2))
        cv2.polylines(overlay, [pts], isClosed=True, color=(0, 255, 128), thickness=2, lineType=cv2.LINE_AA)
    cv2.imwrite(output_filepath, overlay)
    return output_filepath


def extract_white_boundary_outline(img_bgr: np.ndarray, gray_img: np.ndarray) -> tuple:
    """
    Extracts high-contrast binary line mask for Rangoli artwork.
    Supports black outlines on white backgrounds, white outlines on dark backgrounds,
    and colored Rangoli line art.
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

    # Bilateral filter preserves sharp line corners while smoothing background noise
    filtered_gray = cv2.bilateralFilter(gray_img, d=7, sigmaColor=50, sigmaSpace=50)

    if mean_sat > 30.0 or max_sat > 80.0:
        image_type = "Colored Rangoli (White Boundary Extracted)"
        lower_white = np.array([0, 0, 110], dtype=np.uint8)
        upper_white = np.array([180, 60, 255], dtype=np.uint8)
        binary = cv2.inRange(hsv, lower_white, upper_white)
    else:
        if mean_corner > 130.0:
            image_type = "Black Outline on White Background"
            # Invert so Rangoli line art is 255 (white) on 0 (black) background
            _, binary = cv2.threshold(filtered_gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
        elif 40.0 < mean_corner <= 130.0:
            image_type = "Camera Photograph (Adaptive Threshold)"
            clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
            equalized = clahe.apply(filtered_gray)
            binary = cv2.adaptiveThreshold(
                equalized, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 15, 4
            )
        else:
            image_type = "White Outline on Dark Background"
            _, binary = cv2.threshold(filtered_gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    # Check corners of binary mask: Background corners MUST be 0 (black)!
    corner_bin = np.concatenate([
        binary[:20, :20].ravel(),
        binary[:20, -20:].ravel(),
        binary[-20:, :20].ravel(),
        binary[-20:, -20:].ravel()
    ])
    if np.mean(corner_bin) > 127:
        binary = cv2.bitwise_not(binary)

    # Small morphological opening to remove 1-2px noise specks without breaking line continuity
    kernel_small = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel_small)

    return binary, image_type


def preprocess_rangoli_image(image_path_or_bytes, target_size=(600, 600), min_area: float = 8.0, output_dir: str = None) -> tuple:
    """
    Production Line-Art Vectorization Pipeline.
    Extracts continuous contours preserving crown, eyes, trunk, ornaments, hands, and lotus base.
    
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
        'valid_contours_count': 0,
        'processing_time_ms': 0.0,
        'failed_stage': None
    }

    # 1. Load image (Supports PNG, JPG, WEBP & transparent alpha BGRA)
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

    # Resize to target canvas size for uniform coordinate extraction
    img_resized = cv2.resize(img, target_size, interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(img_resized, cv2.COLOR_BGR2GRAY)

    # 2. Extract Binary Line Art Mask
    binary, img_type = extract_white_boundary_outline(img_resized, gray)
    diagnostics['image_type_detected'] = img_type

    # 3. Find Connected Contours (RETR_TREE preserves both outer outlines & inner detail cutouts)
    contours, hierarchy = cv2.findContours(binary, cv2.RETR_TREE, cv2.CHAIN_APPROX_NONE)
    diagnostics['total_contours_found'] = len(contours)

    # 4. Filter micro noise specks while PRESERVING all legitimate artwork details
    valid_contours = []
    removed_count = 0

    for cnt in contours:
        peri = cv2.arcLength(cnt, True)
        area = cv2.contourArea(cnt)

        # Keep all contours with arcLength > 10.0 px or area > 5.0 px^2 (preserves eyes, crown, ornaments, hands, lotus)
        if peri >= 10.0 or area >= 5.0:
            valid_contours.append(cnt)
        else:
            removed_count += 1

    diagnostics['contours_removed'] = removed_count
    diagnostics['valid_contours_count'] = len(valid_contours)

    t_end = time.time()
    diagnostics['processing_time_ms'] = round((t_end - t_start) * 1000.0, 1)

    # Create visualization diagnostic image
    contours_img = np.zeros((target_size[1], target_size[0], 3), dtype=np.uint8)
    if valid_contours:
        cv2.drawContours(contours_img, valid_contours, -1, (0, 255, 128), 2)

    saved_images = {}
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)
        cv2.imwrite(os.path.join(output_dir, 'original.png'), img_resized)
        cv2.imwrite(os.path.join(output_dir, 'grayscale.png'), gray)
        cv2.imwrite(os.path.join(output_dir, 'threshold.png'), binary)
        cv2.imwrite(os.path.join(output_dir, 'contours.png'), contours_img)

        saved_images = {
            'original': 'original.png',
            'grayscale': 'grayscale.png',
            'threshold': 'threshold.png',
            'contours': 'contours.png'
        }

    return valid_contours, saved_images, diagnostics
