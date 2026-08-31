from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import numpy as np


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MARKER_ROOT = PROJECT_ROOT / "miniprogram" / "assets" / "markers"


def read_grayscale(path: Path) -> np.ndarray:
    encoded = np.fromfile(path, dtype=np.uint8)
    image = cv2.imdecode(encoded, cv2.IMREAD_GRAYSCALE)
    if image is None:
        raise ValueError(f"无法读取图片：{path}")
    return image


def analyze(path: Path, sift) -> dict[str, object]:
    image = read_grayscale(path)
    height, width = image.shape
    ink = image < 245
    y_points, x_points = np.where(ink)
    if not len(x_points):
        content_ratio = 0.0
    else:
        content_width = int(x_points.max() - x_points.min() + 1)
        content_height = int(y_points.max() - y_points.min() + 1)
        content_ratio = content_width * content_height / (width * height)

    keypoints = sift.detect(image, None)
    occupied_cells = {
        (
            min(5, int(keypoint.pt[0] / width * 6)),
            min(5, int(keypoint.pt[1] / height * 6)),
        )
        for keypoint in keypoints
    }
    ink_ratio = float(ink.mean())
    warnings = []
    if ink_ratio < 0.04:
        warnings.append("线条占比较低")
    if len(keypoints) < 500:
        warnings.append("局部特征点偏少")
    if len(occupied_cells) < 24:
        warnings.append("特征空间分布不均")

    return {
        "name": path.stem,
        "width": width,
        "height": height,
        "ink_ratio": ink_ratio,
        "content_ratio": content_ratio,
        "sift_keypoints": len(keypoints),
        "occupied_grid_cells": len(occupied_cells),
        "warnings": warnings,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="分析 XR-FRAME Marker 目标图质量")
    parser.add_argument("--markers", type=Path, default=DEFAULT_MARKER_ROOT)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    marker_root = args.markers.resolve()
    paths = sorted(marker_root.glob("*.png"))
    if not paths:
        raise SystemExit(f"没有找到 PNG 目标图：{marker_root}")

    sift = cv2.SIFT_create(
        nfeatures=4000,
        contrastThreshold=0.01,
        edgeThreshold=15,
    )
    print(f"Marker directory: {marker_root}")
    print("name                         size       ink    content  sift  grid   result")
    for path in paths:
        result = analyze(path, sift)
        warning_text = "、".join(result["warnings"]) or "通过"
        print(
            f"{result['name']:<28} "
            f"{result['width']:>4}x{result['height']:<4} "
            f"{result['ink_ratio']:>6.1%} "
            f"{result['content_ratio']:>7.1%} "
            f"{result['sift_keypoints']:>5} "
            f"{result['occupied_grid_cells']:>2}/36  "
            f"{warning_text}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
