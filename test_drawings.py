import cv2
import numpy as np
import sys
import os
sys.path.insert(0, '.')
from services.matcher import match_with_sift_ransac
from services.model_service import load_manifest

manifest = load_manifest()

print('Testing engineering drawings:')
print('-' * 80)
print(f'{"Image":<40} {"Good":<8} {"Inliers":<8} {"Ratio":<8} {"Conf":<8} {"Matched"}')
print('-' * 80)

# 测试现有图片
test_images = [
    'data/ref_images/part_0001.png',
    'data/test_images/scan_test_01.jpg',
    'data/test_images/scan_test_02.jpg',
]

for img_path in test_images:
    if os.path.exists(img_path):
        result = match_with_sift_ransac(img_path, manifest, preprocess_mode='otsu')
        m = result['models'][0]
        matched = 'Y' if m['matched'] else 'N'
        print(f'{img_path:<40} {m["good_matches"]:<8} {m["inliers"]:<8} {m.get("inlier_ratio",0):.3f} {m["confidence"]:<8.3f} {matched}')
    else:
        print(f'{img_path:<40} File not found')

print('-' * 80)
