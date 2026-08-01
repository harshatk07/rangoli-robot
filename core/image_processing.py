"""
Module 1: Image Processing & Skeletonization
Pipeline Step: Image -> OpenCV preprocessing -> Skeletonized single-pixel line map.
Saves intermediate pipeline images (original, grayscale, threshold, edges) for web UI preview.
"""

import os
import cv2
import numpy as np


def zhang_suen_thinning(binary_img: np.ndarray) -> np.ndarray:
    """
    Perform Zhang-Suen skeletonization/thinning algorithm on a binary image.
    Input: Binary image (255 for foreground lines, 0 for background).
    Output: Single-pixel wide line skeleton (255 for skeleton, 0 for background).
    """
    img = (binary_img // 255).astype(np.uint8)
    prev = np.zeros_like(img)

    while True:
        deletion_list = []
        rows, cols = img.shape
        for r in range(1, rows - 1):
            for c in range(1, cols - 1):
                if img[r, c] == 1:
                    P2 = img[r - 1, c]
                    P3 = img[r - 1, c + 1]
                    P4 = img[r, c + 1]
                    P5 = img[r + 1, c + 1]
                    P6 = img[r + 1, c]
                    P7 = img[r + 1, c - 1]
                    P8 = img[r, c - 1]
                    P9 = img[r - 1, c - 1]

                    neighbors = [P2, P3, P4, P5, P6, P7, P8, P9]
                    B = sum(neighbors)

                    transitions = 0
                    for i in range(len(neighbors)):
                        if neighbors[i] == 0 and neighbors[(i + 1) % 8] == 1:
                            transitions += 1

                    if 2 <= B <= 6 and transitions == 1:
                        if P2 * P4 * P6 == 0 and P4 * P6 * P8 == 0:
                            deletion_list.append((r, c))

        for r, c in deletion_list:
            img[r, c] = 0

        deletion_list = []
        for r in range(1, rows - 1):
            for c in range(1, cols - 1):
                if img[r, c] == 1:
                    P2 = img[r - 1, c]
                    P3 = img[r - 1, c + 1]
                    P4 = img[r, c + 1]
                    P5 = img[r + 1, c + 1]
                    P6 = img[r + 1, c]
                    P7 = img[r + 1, c - 1]
                    P8 = img[r, c - 1]
                    P9 = img[r - 1, c - 1]

                    neighbors = [P2, P3, P4, P5, P6, P7, P8, P9]
                    B = sum(neighbors)

                    transitions = 0
                    for i in range(len(neighbors)):
                        if neighbors[i] == 0 and neighbors[(i + 1) % 8] == 1:
                            transitions += 1

                    if 2 <= B <= 6 and transitions == 1:
                        if P2 * P4 * P8 == 0 and P2 * P6 * P8 == 0:
                            deletion_list.append((r, c))

        for r, c in deletion_list:
            img[r, c] = 0

        if np.array_equal(img, prev):
            break
        prev = img.copy()

    return (img * 255).astype(np.uint8)


def preprocess_rangoli_image(image_path_or_bytes, target_size=(600, 600), output_dir: str = None) -> tuple:
    """
    Load an image, preprocess with OpenCV (grayscale, Gaussian blur, Otsu threshold),
    and extract single-pixel line skeleton.
    Optionally saves intermediate pipeline stage images to output_dir.
    
    Returns:
        tuple: (skeleton_matrix, dict_of_saved_image_filenames)
    """
    if isinstance(image_path_or_bytes, str):
        img = cv2.imread(image_path_or_bytes)
    else:
        file_bytes = np.frombuffer(image_path_or_bytes, dtype=np.uint8)
        img = cv2.imdecode(file_bytes, cv2.IMREAD_COLOR)

    if img is None:
        raise ValueError("Could not read image file.")

    # 1. Resize to target dimension (600x600 mm mapping scale)
    img_resized = cv2.resize(img, target_size, interpolation=cv2.INTER_AREA)

    # 2. Convert to Grayscale
    gray = cv2.cvtColor(img_resized, cv2.COLOR_BGR2GRAY)

    # 3. Noise removal with Gaussian Blur
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)

    # 4. Otsu's Binarization
    _, binary = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    # Invert if needed so Rangoli lines are WHITE 255, background is BLACK 0
    if np.mean(binary) > 127:
        binary = cv2.bitwise_not(binary)

    # 5. Morphological cleaning
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    cleaned = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)

    # 6. Skeletonization
    try:
        skeleton = cv2.ximgproc.thinning(cleaned, thinningType=cv2.ximgproc.THINNING_ZHANGSUEN)
    except AttributeError:
        skeleton = zhang_suen_thinning(cleaned)

    saved_images = {}
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)
        cv2.imwrite(os.path.join(output_dir, 'original.png'), img_resized)
        cv2.imwrite(os.path.join(output_dir, 'grayscale.png'), gray)
        cv2.imwrite(os.path.join(output_dir, 'threshold.png'), binary)
        cv2.imwrite(os.path.join(output_dir, 'edges.png'), skeleton)

        saved_images = {
            'original': 'original.png',
            'grayscale': 'grayscale.png',
            'threshold': 'threshold.png',
            'edges': 'edges.png'
        }

    return skeleton, saved_images
