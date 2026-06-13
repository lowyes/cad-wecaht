from __future__ import annotations

from pathlib import Path
from typing import Any

import cv2
import numpy as np

from .feature_extract import extract_sift_features
from .image_preprocess import preprocess_for_sift


REGION_SCORE_THRESHOLD = 0.23
REGION_PAIR_SCORE_THRESHOLD = 0.20
REGION_PAIR_EDGE_THRESHOLD = 0.11
MIN_MATCHED_REGIONS = 2


def preprocess_to_binary_for_regions(image_path: str) -> np.ndarray:
    """Return a white-background/black-line binary image for view detection."""
    return preprocess_for_sift(image_path, mode="otsu")


def detect_view_regions(binary: np.ndarray) -> list[dict[str, int | float]]:
    """
    Detect major engineering drawing view regions without assuming layout.

    The detector builds several morphology scales, extracts connected
    components, filters small annotation/noise boxes, and merges nearby boxes.
    """
    if binary.ndim == 3:
        gray = cv2.cvtColor(binary, cv2.COLOR_BGR2GRAY)
    else:
        gray = binary

    height, width = gray.shape[:2]
    image_area = max(height * width, 1)
    ink = (gray < 200).astype(np.uint8) * 255

    boxes: list[dict[str, int | float]] = []
    for scale in (0.006, 0.010, 0.015, 0.022):
        kernel_w = max(5, int(width * scale))
        kernel_h = max(5, int(height * scale))
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (kernel_w, kernel_h))
        merged = cv2.morphologyEx(ink, cv2.MORPH_CLOSE, kernel, iterations=1)
        merged = cv2.dilate(merged, kernel, iterations=1)

        label_count, _, stats, _ = cv2.connectedComponentsWithStats(merged, connectivity=8)
        for label_index in range(1, label_count):
            x, y, box_w, box_h, component_area = stats[label_index]
            box_area = int(box_w * box_h)
            if box_area < image_area * 0.006:
                continue
            if box_w < width * 0.06 or box_h < height * 0.06:
                continue
            if box_area > image_area * 0.65:
                continue

            aspect = max(box_w / max(box_h, 1), box_h / max(box_w, 1))
            if aspect > 8.0:
                continue

            crop_ink = ink[y : y + box_h, x : x + box_w]
            ink_density = float((crop_ink > 0).mean())
            if ink_density < 0.01:
                continue

            boxes.append({
                "x": int(x),
                "y": int(y),
                "w": int(box_w),
                "h": int(box_h),
                "area": int(box_area),
                "ink_density": ink_density,
                "component_area": int(component_area),
            })

    merged_boxes = merge_nearby_boxes(boxes, width, height)
    return sorted(merged_boxes, key=lambda box: int(box["area"]), reverse=True)[:6]


def merge_nearby_boxes(
    boxes: list[dict[str, int | float]],
    image_w: int,
    image_h: int,
) -> list[dict[str, int | float]]:
    """Merge overlapping or very close candidate boxes."""
    candidates = [dict(box) for box in boxes]

    def rect(box: dict[str, int | float]) -> tuple[int, int, int, int]:
        x = int(box["x"])
        y = int(box["y"])
        return x, y, x + int(box["w"]), y + int(box["h"])

    def should_merge(a: dict[str, int | float], b: dict[str, int | float]) -> bool:
        ax1, ay1, ax2, ay2 = rect(a)
        bx1, by1, bx2, by2 = rect(b)
        gap_x = max(0, max(bx1 - ax2, ax1 - bx2))
        gap_y = max(0, max(by1 - ay2, ay1 - by2))
        intersection = max(0, min(ax2, bx2) - max(ax1, bx1)) * max(0, min(ay2, by2) - max(ay1, by1))
        smaller_area = min(int(a["w"]) * int(a["h"]), int(b["w"]) * int(b["h"]))
        if smaller_area > 0 and intersection / smaller_area > 0.35:
            return True
        return gap_x < image_w * 0.018 and gap_y < image_h * 0.018

    changed = True
    while changed:
        changed = False
        next_boxes: list[dict[str, int | float]] = []
        used = [False] * len(candidates)
        for index, box in enumerate(candidates):
            if used[index]:
                continue
            current = dict(box)
            for other_index in range(index + 1, len(candidates)):
                if used[other_index]:
                    continue
                other = candidates[other_index]
                if not should_merge(current, other):
                    continue

                ax1, ay1, ax2, ay2 = rect(current)
                bx1, by1, bx2, by2 = rect(other)
                x1 = min(ax1, bx1)
                y1 = min(ay1, by1)
                x2 = max(ax2, bx2)
                y2 = max(ay2, by2)
                current = {
                    "x": int(x1),
                    "y": int(y1),
                    "w": int(x2 - x1),
                    "h": int(y2 - y1),
                    "area": int((x2 - x1) * (y2 - y1)),
                    "ink_density": max(float(current.get("ink_density", 0.0)), float(other.get("ink_density", 0.0))),
                    "component_area": int(current.get("component_area", 0)) + int(other.get("component_area", 0)),
                }
                used[other_index] = True
                changed = True
            used[index] = True
            next_boxes.append(current)
        candidates = next_boxes

    return candidates


def crop_regions(
    image: np.ndarray,
    boxes: list[dict[str, int | float]],
    padding: int = 8,
) -> list[dict[str, Any]]:
    """Crop image regions and retain their source boxes."""
    height, width = image.shape[:2]
    regions = []
    for index, box in enumerate(boxes):
        x = int(box["x"])
        y = int(box["y"])
        box_w = int(box["w"])
        box_h = int(box["h"])
        x1 = max(0, x - padding)
        y1 = max(0, y - padding)
        x2 = min(width, x + box_w + padding)
        y2 = min(height, y + box_h + padding)
        regions.append({
            "index": index,
            "box": box,
            "image": image[y1:y2, x1:x2],
        })
    return regions


def save_debug_regions(
    image: np.ndarray,
    boxes: list[dict[str, int | float]],
    output_dir: str | Path,
    prefix: str,
) -> None:
    """Save an overlay image and individual region crops for inspection."""
    target_dir = Path(output_dir)
    target_dir.mkdir(parents=True, exist_ok=True)

    if image.ndim == 2:
        overlay = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
    else:
        overlay = image.copy()

    for index, box in enumerate(boxes, start=1):
        x = int(box["x"])
        y = int(box["y"])
        w = int(box["w"])
        h = int(box["h"])
        cv2.rectangle(overlay, (x, y), (x + w, y + h), (0, 0, 255), 2)
        cv2.putText(overlay, str(index), (x + 4, y + 20), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 0, 255), 2)

    cv2.imwrite(str(target_dir / f"{prefix}_regions.png"), overlay)

    for region in crop_regions(image, boxes):
        cv2.imwrite(str(target_dir / f"{prefix}_region_{region['index'] + 1:02d}.png"), region["image"])


def match_region_sets(
    query_image_path: str,
    ref_image_path: str,
    debug_output_dir: str | Path | None = None,
) -> dict[str, Any]:
    """Detect and greedily match query/ref view regions."""
    query_binary = preprocess_to_binary_for_regions(query_image_path)
    ref_binary = preprocess_to_binary_for_regions(ref_image_path)
    query_boxes = detect_view_regions(query_binary)
    ref_boxes = detect_view_regions(ref_binary)

    if debug_output_dir is not None:
        save_debug_regions(query_binary, query_boxes, debug_output_dir, "query")
        save_debug_regions(ref_binary, ref_boxes, debug_output_dir, "ref")

    query_regions = crop_regions(query_binary, query_boxes)
    ref_regions = crop_regions(ref_binary, ref_boxes)
    pairs = []
    for query_region in query_regions:
        for ref_region in ref_regions:
            pair = score_region_pair(query_region["image"], ref_region["image"])
            pair.update({
                "query_index": int(query_region["index"]),
                "ref_index": int(ref_region["index"]),
            })
            pairs.append(pair)

    pairs.sort(key=lambda item: float(item["score"]), reverse=True)
    chosen_pairs = []
    used_query = set()
    used_ref = set()
    for pair in pairs:
        if pair["query_index"] in used_query or pair["ref_index"] in used_ref:
            continue
        chosen_pairs.append(pair)
        used_query.add(pair["query_index"])
        used_ref.add(pair["ref_index"])

    top_pairs = chosen_pairs[: min(3, len(chosen_pairs))]
    if top_pairs:
        region_score = float(sum(float(pair["score"]) for pair in top_pairs) / len(top_pairs))
    else:
        region_score = 0.0

    matched_region_count = sum(
        1
        for pair in chosen_pairs
        if float(pair["score"]) >= REGION_PAIR_SCORE_THRESHOLD
        and float(pair["edge_score"]) >= REGION_PAIR_EDGE_THRESHOLD
    )
    supported = bool(region_score >= REGION_SCORE_THRESHOLD and matched_region_count >= MIN_MATCHED_REGIONS)

    return {
        "query_region_count": len(query_boxes),
        "ref_region_count": len(ref_boxes),
        "matched_region_count": int(matched_region_count),
        "region_score": round(region_score, 3),
        "region_supported": supported,
        "region_pairs": [
            {
                "query_index": int(pair["query_index"]),
                "ref_index": int(pair["ref_index"]),
                "score": round(float(pair["score"]), 3),
                "feature_score": round(float(pair["feature_score"]), 3),
                "edge_score": round(float(pair["edge_score"]), 3),
                "good_matches": int(pair["good_matches"]),
                "inliers": int(pair["inliers"]),
                "inlier_coverage": round(float(pair["inlier_coverage"]), 3),
            }
            for pair in chosen_pairs
        ],
    }


def score_region_pair(query_region: np.ndarray, ref_region: np.ndarray) -> dict[str, float | int]:
    """Score one query/ref region pair by local features and edge structure."""
    feature_score, good_matches, inliers, inlier_coverage = _compute_region_feature_score(query_region, ref_region)
    edge_score = _compute_region_edge_score(query_region, ref_region)
    score = 0.45 * feature_score + 0.55 * edge_score
    return {
        "score": float(score),
        "feature_score": float(feature_score),
        "edge_score": float(edge_score),
        "good_matches": int(good_matches),
        "inliers": int(inliers),
        "inlier_coverage": float(inlier_coverage),
    }


def _compute_region_feature_score(query_region: np.ndarray, ref_region: np.ndarray) -> tuple[float, int, int, float]:
    query_kp, query_des = extract_sift_features(query_region)
    ref_kp, ref_des = extract_sift_features(ref_region)
    if query_des is None or ref_des is None or len(query_des) == 0 or len(ref_des) == 0:
        return 0.0, 0, 0, 0.0

    good_matches = _match_sift_descriptors(query_des, ref_des)
    if len(good_matches) < 6:
        return min(len(good_matches) / 20.0, 0.2), len(good_matches), 0, 0.0

    inliers, inlier_coverage, homography_valid = _compute_region_inliers(
        query_kp,
        ref_kp,
        good_matches,
        query_region.shape,
    )
    inlier_ratio = inliers / max(len(good_matches), 1)
    score = (
        min(inliers / 18.0, 1.0) * 0.60
        + min(inlier_ratio / 0.35, 1.0) * 0.25
        + min(inlier_coverage / 0.20, 1.0) * 0.15
    )
    if not homography_valid:
        score *= 0.55
    return float(score), len(good_matches), int(inliers), float(inlier_coverage)


def _match_sift_descriptors(query_des: np.ndarray, ref_des: np.ndarray, ratio_threshold: float = 0.72):
    matcher = cv2.BFMatcher(cv2.NORM_L2)
    pairs = matcher.knnMatch(query_des.astype(np.float32), ref_des.astype(np.float32), k=2)
    good = []
    for pair in pairs:
        if len(pair) < 2:
            continue
        first, second = pair
        if first.distance < ratio_threshold * second.distance:
            good.append(first)
    return good


def _compute_region_inliers(query_kp, ref_kp, good_matches, query_shape) -> tuple[int, float, bool]:
    if len(good_matches) < 6:
        return 0, 0.0, False

    src_pts = np.float32([query_kp[match.queryIdx].pt for match in good_matches]).reshape(-1, 1, 2)
    dst_pts = np.float32([ref_kp[match.trainIdx].pt for match in good_matches]).reshape(-1, 1, 2)
    homography, mask = cv2.findHomography(src_pts, dst_pts, cv2.RANSAC, 3.0)
    if mask is None:
        return 0, 0.0, False

    inliers = int(mask.sum())
    inlier_coverage = 0.0
    if inliers >= 4:
        inlier_pts = src_pts[mask.ravel() == 1]
        x_min, y_min = inlier_pts.min(axis=0)[0]
        x_max, y_max = inlier_pts.max(axis=0)[0]
        inlier_coverage = float(max(0.0, (x_max - x_min) * (y_max - y_min)) / max(query_shape[0] * query_shape[1], 1))

    homography_valid = _is_homography_reasonable(homography, query_shape)
    return inliers, inlier_coverage, homography_valid


def _is_homography_reasonable(homography: np.ndarray | None, query_shape) -> bool:
    if homography is None or not np.all(np.isfinite(homography)):
        return False
    try:
        if np.linalg.cond(homography) > 1e8:
            return False
        height, width = query_shape[:2]
        corners = np.float32([
            [0, 0],
            [width - 1, 0],
            [width - 1, height - 1],
            [0, height - 1],
        ]).reshape(-1, 1, 2)
        transformed = cv2.perspectiveTransform(corners, homography).reshape(4, 2)
        if not np.all(np.isfinite(transformed)):
            return False
        source_area = abs(cv2.contourArea(corners.reshape(4, 2)))
        transformed_area = abs(cv2.contourArea(transformed))
        if source_area <= 0 or transformed_area <= 0:
            return False
        area_ratio = transformed_area / source_area
        return 0.04 <= area_ratio <= 25.0
    except Exception:
        return False


def _compute_region_edge_score(query_region: np.ndarray, ref_region: np.ndarray) -> float:
    query_mask = _normalize_region_mask(query_region)
    ref_mask = _normalize_region_mask(ref_region)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    query_dilated = cv2.dilate(query_mask, kernel) > 0
    ref_dilated = cv2.dilate(ref_mask, kernel) > 0
    intersection = np.logical_and(query_dilated, ref_dilated).sum()
    union = np.logical_or(query_dilated, ref_dilated).sum()
    iou = intersection / max(union, 1)

    query_float = (query_mask > 0).astype(np.float32)
    ref_float = (ref_mask > 0).astype(np.float32)
    query_float = (query_float - query_float.mean()) / (query_float.std() + 1e-6)
    ref_float = (ref_float - ref_float.mean()) / (ref_float.std() + 1e-6)
    correlation = max(0.0, float((query_float * ref_float).mean()))

    return float(0.65 * iou + 0.35 * correlation)


def _normalize_region_mask(region: np.ndarray, canvas_size: int = 160) -> np.ndarray:
    if region.ndim == 3:
        gray = cv2.cvtColor(region, cv2.COLOR_BGR2GRAY)
    else:
        gray = region
    mask = (gray < 200).astype(np.uint8) * 255
    height, width = mask.shape[:2]
    canvas = np.zeros((canvas_size, canvas_size), dtype=np.uint8)
    scale = min((canvas_size - 12) / max(width, 1), (canvas_size - 12) / max(height, 1))
    resized_w = max(1, int(width * scale))
    resized_h = max(1, int(height * scale))
    resized = cv2.resize(mask, (resized_w, resized_h), interpolation=cv2.INTER_NEAREST)
    offset_x = (canvas_size - resized_w) // 2
    offset_y = (canvas_size - resized_h) // 2
    canvas[offset_y : offset_y + resized_h, offset_x : offset_x + resized_w] = resized
    return canvas
