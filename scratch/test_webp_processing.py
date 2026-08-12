import sys
import os
sys.path.insert(0, os.path.abspath('.'))

import cv2
import numpy as np
from core.image_processing import preprocess_rangoli_image

# Create a test black-and-white mandala WebP image in memory/disk
h, w = 740, 740
test_img = np.ones((h, w, 3), dtype=np.uint8) * 255 # white background

# Draw black mandala concentric circles and radial lines
cv2.circle(test_img, (w//2, h//2), 200, (0, 0, 0), 3)
cv2.circle(test_img, (w//2, h//2), 150, (0, 0, 0), 2)
cv2.circle(test_img, (w//2, h//2), 100, (0, 0, 0), 2)
for angle in range(0, 360, 15):
    rad = np.radians(angle)
    x1 = int(w//2 + 100 * np.cos(rad))
    y1 = int(h//2 + 100 * np.sin(rad))
    x2 = int(w//2 + 200 * np.cos(rad))
    y2 = int(h//2 + 200 * np.sin(rad))
    cv2.line(test_img, (x1, y1), (x2, y2), (0, 0, 0), 2)

test_path = 'uploads/test_mandala.webp'
os.makedirs('uploads', exist_ok=True)
cv2.imwrite(test_path, test_img)

print(f"Testing end-to-end processing for test WebP image '{test_path}'...")
contours, saved, diag = preprocess_rangoli_image(test_path, output_dir='uploads')
print(f"Extraction result: {len(contours)} contours extracted!")
print(f"Image Type Detected: {diag.get('image_type_detected')}")
print(f"Failed Stage: {diag.get('failed_stage')}")

assert len(contours) > 0, "Error: Contours count is 0!"
print("EMPIRICAL TEST PASSED SUCCESSFULLY!")
