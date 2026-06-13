"""调试单应性矩阵"""
import sys, os, contextlib, io
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
os.chdir(PROJECT_ROOT)
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import cv2
import numpy as np
from services.image_preprocess import preprocess_for_sift
from services.feature_extract import extract_sift_features, deserialize_keypoints
from services.matcher import match_sift

manifest_ref = np.load("data/features/part_0001.npz")
ref_des = manifest_ref["descriptors"].astype(np.float32)
ref_kp = deserialize_keypoints(manifest_ref.get("keypoints", np.array([])))

test_images = [
    ("scan_test_01.jpg", "otsu"),
    ("scan_test_02.jpg", "gray"),
    ("random_noise.jpg", "gray"),
]

for filename, mode in test_images:
    path = f"data/test_images/{filename}"
    print(f"\n=== {filename} (mode={mode}) ===")

    query_img = preprocess_for_sift(path, mode=mode)
    query_kp, query_des = extract_sift_features(query_img)

    if query_des is None or len(query_des) == 0:
        continue

    good = match_sift(query_des.astype(np.float32), ref_des)
    if len(good) < 8:
        continue

    src_pts = np.float32([query_kp[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
    dst_pts = np.float32([ref_kp[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)

    H, mask = cv2.findHomography(src_pts, dst_pts, cv2.RANSAC, 3.0)
    if H is None:
        print("  H is None")
        continue

    inliers = int(mask.sum()) if mask is not None else 0
    det = np.linalg.det(H)
    cond = np.linalg.cond(H)
    h22 = abs(H[2, 2])

    print(f"  inliers: {inliers}")
    print(f"  H:\n{H}")
    print(f"  det(H) = {det:.6e}")
    print(f"  cond(H) = {cond:.6e}")
    print(f"  H[2,2] = {h22:.6f}")

    # 判断
    valid = abs(det) >= 1e-6 and abs(det) <= 1e6 and cond <= 1e8 and 0.1 <= h22 <= 10.0
    print(f"  homography_valid (new check): {valid}")
