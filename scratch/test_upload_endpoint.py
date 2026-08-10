import urllib.request
import numpy as np
import cv2

img = np.zeros((400, 400, 3), dtype=np.uint8)
cv2.circle(img, (200, 200), 100, (255, 255, 255), 4)
_, encoded = cv2.imencode('.png', img)

boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW'
header = f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="test_upload.png"\r\nContent-Type: image/png\r\n\r\n'.encode()
footer = f'\r\n--{boundary}--\r\n'.encode()
body = header + encoded.tobytes() + footer

req = urllib.request.Request(
    'http://127.0.0.1:5000/api/process',
    data=body,
    headers={'Content-Type': f'multipart/form-data; boundary={boundary}'}
)
res = urllib.request.urlopen(req)
print('[POST /api/process SUCCESS] Status:', res.status)
print('Response bytes:', len(res.read()))
