#!/usr/bin/env python3
"""Visualize preprocessed SIFT matches between scan_test_01 and part_0001."""

from __future__ import annotations

import sys
from pathlib import Path

import cv2

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from services.feature_extract import extract_sift_features  # noqa: E402
from services.image_preprocess import preprocess_image  # noqa: E402


def main() -> int:
    ref_path = PROJECT_ROOT / "data" / "ref_images" / "part_0001.png"
    scan_path = PROJECT_ROOT / "data" / "test_images" / "scan_test_01.jpg"
    out_dir = PROJECT_ROOT / "data" / "test_images" / "generated"
    out_dir.mkdir(parents=True, exist_ok=True)

    if not ref_path.exists():
        print(f"[FAIL] reference image not found: {ref_path}")
        return 1
    if not scan_path.exists():
        print(f"[FAIL] scan image not found: {scan_path}")
        return 1

    ref_gray = preprocess_image(str(ref_path))
    scan_gray = preprocess_image(str(scan_path))

    ref_kp, ref_desc = extract_sift_features(ref_gray)
    scan_kp, scan_desc = extract_sift_features(scan_gray)

    print(f"[INFO] ref preprocessed shape: {ref_gray.shape}, keypoints: {len(ref_kp)}, descriptors: {ref_desc.shape}")
    print(f"[INFO] scan preprocessed shape: {scan_gray.shape}, keypoints: {len(scan_kp)}, descriptors: {scan_desc.shape}")

    ref_preprocessed_path = out_dir / "part_0001_ref_preprocessed.jpg"
    scan_preprocessed_path = out_dir / "scan_test_01_preprocessed.jpg"
    cv2.imwrite(str(ref_preprocessed_path), ref_gray)
    cv2.imwrite(str(scan_preprocessed_path), scan_gray)
    print(f"[PASS] wrote {ref_preprocessed_path.relative_to(PROJECT_ROOT)}")
    print(f"[PASS] wrote {scan_preprocessed_path.relative_to(PROJECT_ROOT)}")

    if len(scan_desc) == 0 or len(ref_desc) == 0:
        print("[FAIL] no descriptors available for matching")
        return 1

    scan_desc = scan_desc.astype("float32")
    ref_desc = ref_desc.astype("float32")
    bf = cv2.BFMatcher(cv2.NORM_L2)
    knn = bf.knnMatch(scan_desc, ref_desc, k=2)

    good_matches = []
    for match_pair in knn:
        if len(match_pair) == 2:
            m, n = match_pair
            if m.distance < 0.8 * n.distance:
                good_matches.append(m)

    confidence = min(len(good_matches) / max(len(scan_desc), 1) * 2.0, 1.0)
    print(f"[INFO] raw knn pairs: {len(knn)}")
    print(f"[INFO] good matches after Lowe ratio 0.8: {len(good_matches)}")
    print(f"[INFO] confidence by current matcher formula: {confidence:.4f}")

    good_sorted = sorted(good_matches, key=lambda match: match.distance)
    draw_count = min(50, len(good_sorted))
    match_visualization = cv2.drawMatches(
        scan_gray,
        scan_kp,
        ref_gray,
        ref_kp,
        good_sorted[:draw_count],
        None,
        flags=cv2.DrawMatchesFlags_NOT_DRAW_SINGLE_POINTS,
    )
    match_path = out_dir / "scan_test_01_vs_part_0001_sift_matches.jpg"
    cv2.imwrite(str(match_path), match_visualization)
    print(f"[PASS] wrote {match_path.relative_to(PROJECT_ROOT)}")
    print("[INFO] visualization: left = scan_test_01 preprocessed, right = part_0001 reference preprocessed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
