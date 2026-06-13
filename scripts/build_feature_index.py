#!/usr/bin/env python3
"""Build full-image and auto-detected view-region SIFT feature indexes."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import cv2
import numpy as np


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from services.feature_extract import extract_sift_features  # noqa: E402
from services.image_preprocess import preprocess_for_sift  # noqa: E402
from services.view_region_detector import (  # noqa: E402
    crop_regions,
    detect_view_regions,
    preprocess_to_binary_for_regions,
)


def serialize_keypoints(keypoints) -> np.ndarray:
    if not keypoints:
        return np.array([], dtype=np.float32).reshape(0, 7)
    return np.array(
        [
            (kp.pt[0], kp.pt[1], kp.size, kp.angle, kp.response, kp.octave, kp.class_id)
            for kp in keypoints
        ],
        dtype=np.float32,
    )


def save_feature_file(image: np.ndarray, feature_path: Path) -> tuple[int, int]:
    keypoints, descriptors = extract_sift_features(image)
    feature_path.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        str(feature_path),
        descriptors=descriptors,
        keypoints=serialize_keypoints(keypoints),
        keypoints_count=len(keypoints),
    )
    return len(keypoints), len(descriptors)


def build_region_index(model_id: str, ref_image_path: Path, features_dir: Path) -> int:
    binary = preprocess_to_binary_for_regions(str(ref_image_path))
    boxes = detect_view_regions(binary)
    regions = crop_regions(binary, boxes)

    region_dir = PROJECT_ROOT / "data" / "ref_regions" / model_id
    region_dir.mkdir(parents=True, exist_ok=True)

    for old_file in region_dir.glob("region_*.png"):
        old_file.unlink()
    for old_file in features_dir.glob(f"{model_id}_region_*_sift.npz"):
        old_file.unlink()

    for region in regions:
        region_number = int(region["index"]) + 1
        region_image = region["image"]
        region_image_path = region_dir / f"region_{region_number:02d}.png"
        region_feature_path = features_dir / f"{model_id}_region_{region_number:02d}_sift.npz"
        cv2.imwrite(str(region_image_path), region_image)
        keypoint_count, descriptor_count = save_feature_file(region_image, region_feature_path)
        print(
            f"  region_{region_number:02d}: "
            f"{keypoint_count} keypoints, {descriptor_count} descriptors -> {region_feature_path}"
        )

    return len(regions)


def build_feature_index() -> int:
    manifest_path = PROJECT_ROOT / "data" / "manifest.json"
    if not manifest_path.exists():
        print("[FAIL] data/manifest.json not found")
        return 1

    with manifest_path.open("r", encoding="utf-8") as file:
        manifest = json.load(file)

    features_dir = PROJECT_ROOT / "data" / "features"
    features_dir.mkdir(parents=True, exist_ok=True)

    failures = 0
    for item in manifest:
        model_id = item["model_id"]
        ref_image_path = PROJECT_ROOT / item["ref_image"]
        feature_file_path = PROJECT_ROOT / item["feature_file"]

        if not ref_image_path.exists():
            print(f"[WARN] reference image not found for {model_id}: {ref_image_path}")
            failures += 1
            continue

        try:
            full_image = preprocess_for_sift(str(ref_image_path), mode="gray")
            keypoint_count, descriptor_count = save_feature_file(full_image, feature_file_path)
            print(
                f"Built full feature index for {model_id}: "
                f"{keypoint_count} keypoints, {descriptor_count} descriptors -> {feature_file_path}"
            )

            region_count = build_region_index(model_id, ref_image_path, features_dir)
            print(f"Built {region_count} auto-detected reference regions for {model_id}")
        except Exception as exc:
            print(f"[FAIL] error while processing {model_id}: {exc}")
            failures += 1

    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(build_feature_index())
