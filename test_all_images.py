import cv2
import numpy as np
import sys
import os
sys.path.insert(0, '.')
from services.matcher import match_with_sift_ransac
from services.model_service import load_manifest

manifest = load_manifest()

test_dir = 'data/test_images'
all_images = [f for f in os.listdir(test_dir) if f.lower().endswith(('.jpg', '.png'))]

print(f'Testing all images in {test_dir}:')
print('-' * 80)
print(f'{"Image":<30} {"Good":<8} {"Inliers":<8} {"Ratio":<8} {"Conf":<8} {"Matched"}')
print('-' * 80)

for img_name in all_images:
    img_path = os.path.join(test_dir, img_name)
    result = match_with_sift_ransac(img_path, manifest, preprocess_mode='otsu')
    m = result['models'][0]
    matched = 'Y' if m['matched'] else 'N'
    print(f'{img_name:<30} {m["good_matches"]:<8} {m["inliers"]:<8} {m.get("inlier_ratio",0):.3f} {m["confidence"]:<8.3f} {matched}')

print('-' * 80)
print(f'\nReference: part_0001.png')
result = match_with_sift_ransac('data/ref_images/part_0001.png', manifest, preprocess_mode='otsu')
m = result['models'][0]
print(f'{"part_0001.png":<30} {m["good_matches"]:<8} {m["inliers"]:<8} {m.get("inlier_ratio",0):.3f} {m["confidence"]:<8.3f} Y')
