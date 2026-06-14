from __future__ import annotations

from typing import Any

import cv2
import numpy as np

from .image_preprocess import preprocess_for_sift
from .view_region_detector import detect_view_regions, preprocess_to_binary_for_regions
from .vlm_client import call_glm_with_image
from .vlm_prompts import QUERY_SIGNATURE_PROMPT


def extract_query_signature(image_path: str) -> dict[str, Any]:
    """Extract a model-card-like query signature."""
    vlm_result = call_glm_with_image(image_path, QUERY_SIGNATURE_PROMPT)
    if isinstance(vlm_result, dict):
        vlm_result.setdefault("source", "glm-4v-flash")
        return _normalize_signature(vlm_result)

    fallback = extract_fallback_signature(image_path)
    fallback["source"] = "opencv_fallback"
    return fallback


def extract_fallback_signature(image_path: str) -> dict[str, Any]:
    """Best-effort CPU-only signature used when VLM is unavailable."""
    binary = preprocess_to_binary_for_regions(image_path)
    boxes = detect_view_regions(binary)
    view_count = len(boxes)
    circle_count = _count_circles(image_path)
    line_density = float((binary < 200).mean())

    has_center_concentric = circle_count >= 2
    has_chamfer = _has_many_diagonal_lines(binary)
    signature = {
        "is_engineering_drawing": line_density > 0.005,
        "drawing_quality": "fallback",
        "view_count": view_count,
        "part_category": "unknown",
        "top_view": {
            "exists": view_count > 0,
            "outer_contour_type": "unknown",
            "hole_layout": "single_center_concentric_hole" if has_center_concentric else "unknown",
            "has_center_concentric_circles": bool(has_center_concentric),
            "center_circle_count": int(circle_count),
            "side_feature_type": "uncertain",
            "left_side_feature": "uncertain",
            "right_side_feature": "uncertain",
            "side_closed_hole_count": None,
            "has_chamfered_outer_contour": bool(has_chamfer),
            "symmetry": "unknown",
        },
        "front_view": {"exists": view_count >= 1},
        "side_view": {"exists": view_count >= 2},
        "dimensions": {},
        "key_features": [],
        "brief_description": "Fallback OpenCV signature; VLM was unavailable.",
        "confidence": 0.35,
    }
    return signature


def _normalize_signature(signature: dict[str, Any]) -> dict[str, Any]:
    top_view = signature.setdefault("top_view", {})
    signature.setdefault("is_engineering_drawing", True)
    signature.setdefault("view_count", 0)
    signature.setdefault("part_category", "unknown")
    signature.setdefault("front_view", {})
    signature.setdefault("side_view", {})
    signature.setdefault("dimensions", {})
    signature.setdefault("key_features", [])
    signature.setdefault("brief_description", "")
    signature.setdefault("confidence", 0.0)
    top_view.setdefault("outer_contour_type", "unknown")
    top_view.setdefault("hole_layout", "unknown")
    top_view.setdefault("has_center_concentric_circles", False)
    top_view.setdefault("center_circle_count", 0)
    top_view.setdefault("side_feature_type", "uncertain")
    top_view.setdefault("has_chamfered_outer_contour", False)
    top_view.setdefault("symmetry", "unknown")
    return signature


def _count_circles(image_path: str) -> int:
    gray = preprocess_for_sift(image_path, mode="gray")
    blurred = cv2.medianBlur(gray, 5)
    circles = cv2.HoughCircles(
        blurred,
        cv2.HOUGH_GRADIENT,
        dp=1.2,
        minDist=max(20, min(gray.shape[:2]) // 12),
        param1=80,
        param2=28,
        minRadius=5,
        maxRadius=max(12, min(gray.shape[:2]) // 5),
    )
    return 0 if circles is None else int(circles.shape[1])


def _has_many_diagonal_lines(binary: np.ndarray) -> bool:
    edges = cv2.Canny(binary, 50, 150)
    lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=50, minLineLength=30, maxLineGap=8)
    if lines is None:
        return False
    diagonal_count = 0
    for x1, y1, x2, y2 in lines[:, 0, :]:
        angle = abs(np.degrees(np.arctan2(y2 - y1, x2 - x1)))
        if 15 < angle < 75 or 105 < angle < 165:
            diagonal_count += 1
    return diagonal_count >= 4
