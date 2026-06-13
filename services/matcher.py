from pathlib import Path

import cv2
import numpy as np

from .feature_extract import deserialize_keypoints, extract_sift_features
from .image_preprocess import preprocess_for_sift
from .view_region_detector import match_region_sets


INLIER_THRESHOLD = 10
CONFIDENCE_SCALE = 25.0
MIN_GOOD_MATCHES = 15
MIN_INLIER_RATIO = 0.15
MIN_CONFIDENCE = 0.40
MIN_INLIER_COVERAGE = 0.15

NEAR_MISS_INLIERS = 8
NEAR_MISS_RATIO = 0.25
NEAR_MISS_COVERAGE = 0.22
NEAR_MISS_LINE_SCORE = 0.29
NEAR_MISS_COMPONENT_SCORE = 0.12


def match_sift(query_des, ref_des, ratio_threshold: float = 0.70):
    """Match SIFT descriptors with Lowe's ratio test."""
    if query_des is None or ref_des is None or len(query_des) == 0 or len(ref_des) == 0:
        return []

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


def _overlap_ratio(a_start: float, a_end: float, b_start: float, b_end: float) -> float:
    intersection = max(0.0, min(a_end, b_end) - max(a_start, b_start))
    union = max(a_end, b_end) - min(a_start, b_start)
    return intersection / max(union, 1e-6)


def _extract_axis_segments(image_path: str) -> list[tuple[str, float, float, float, float]]:
    """Extract normalized horizontal/vertical line segments from a drawing."""
    image = preprocess_for_sift(image_path, mode="otsu")
    ink = (image < 128).astype(np.uint8) * 255
    ink = cv2.morphologyEx(
        ink,
        cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)),
    )

    edges = cv2.Canny(ink, 50, 150)
    height, width = image.shape[:2]
    min_length = max(25, int(min(height, width) * 0.08))
    raw_lines = cv2.HoughLinesP(
        edges,
        1,
        np.pi / 180,
        threshold=40,
        minLineLength=min_length,
        maxLineGap=12,
    )
    if raw_lines is None:
        return []

    segments = []
    for x1, y1, x2, y2 in raw_lines[:, 0, :]:
        x1, y1, x2, y2 = map(float, (x1, y1, x2, y2))
        dx = x2 - x1
        dy = y2 - y1
        angle = abs(np.degrees(np.arctan2(dy, dx)))

        if angle < 8 or angle > 172:
            axis_position = (y1 + y2) / (2 * height)
            start = min(x1, x2) / width
            end = max(x1, x2) / width
            length = end - start
            if length > 0.05:
                segments.append(("h", float(axis_position), float(start), float(end), float(length)))
        elif 82 < angle < 98:
            axis_position = (x1 + x2) / (2 * width)
            start = min(y1, y2) / height
            end = max(y1, y2) / height
            length = end - start
            if length > 0.05:
                segments.append(("v", float(axis_position), float(start), float(end), float(length)))

    return sorted(segments, key=lambda segment: -segment[4])[:80]


def compute_line_layout_score(query_image_path: str, ref_image_path: str) -> float:
    """Compare normalized horizontal/vertical line layout between two drawings."""
    try:
        query_segments = _extract_axis_segments(query_image_path)
        ref_segments = _extract_axis_segments(ref_image_path)
    except Exception:
        return 0.0

    def weighted_recall(source, target) -> float:
        total = sum(segment[4] for segment in source) or 1.0
        hit = 0.0
        for segment in source:
            best = 0.0
            for candidate in target:
                if segment[0] != candidate[0]:
                    continue
                if abs(segment[1] - candidate[1]) > 0.045:
                    continue
                best = max(best, _overlap_ratio(segment[2], segment[3], candidate[2], candidate[3]))
            if best >= 0.35:
                hit += segment[4] * best
        return hit / total

    recall = weighted_recall(ref_segments, query_segments)
    precision = weighted_recall(query_segments, ref_segments)
    return float(2 * recall * precision / (recall + precision + 1e-6))


def _extract_view_components(image_path: str) -> list[dict]:
    """Extract large view components and normalize each component mask."""
    image = preprocess_for_sift(image_path, mode="otsu")
    ink = (image < 128).astype(np.uint8) * 255
    ink = cv2.morphologyEx(
        ink,
        cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5)),
    )
    height, width = ink.shape[:2]
    contours, _ = cv2.findContours(ink, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    components = []
    for contour in contours:
        area = cv2.contourArea(contour)
        relative_area = area / max(height * width, 1)
        if relative_area < 0.01:
            continue

        x, y, component_width, component_height = cv2.boundingRect(contour)
        crop = ink[y : y + component_height, x : x + component_width]

        normalized = np.zeros((96, 96), dtype=np.uint8)
        scale = min(88 / max(component_width, 1), 88 / max(component_height, 1))
        resized_width = max(1, int(component_width * scale))
        resized_height = max(1, int(component_height * scale))
        resized = cv2.resize(
            crop,
            (resized_width, resized_height),
            interpolation=cv2.INTER_NEAREST,
        )
        offset_x = (96 - resized_width) // 2
        offset_y = (96 - resized_height) // 2
        normalized[offset_y : offset_y + resized_height, offset_x : offset_x + resized_width] = resized

        components.append({
            "area": float(relative_area),
            "cx": float((x + component_width / 2) / width),
            "cy": float((y + component_height / 2) / height),
            "mask": normalized,
        })

    return sorted(components, key=lambda component: -component["area"])[:4]


def _component_mask_similarity(query_mask: np.ndarray, ref_mask: np.ndarray) -> float:
    query = cv2.dilate(query_mask, cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))) > 0
    ref = cv2.dilate(ref_mask, cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))) > 0
    intersection = np.logical_and(query, ref).sum()
    union = np.logical_or(query, ref).sum()
    iou = intersection / max(union, 1)

    query_float = (query_mask > 0).astype(np.float32)
    ref_float = (ref_mask > 0).astype(np.float32)
    query_float = (query_float - query_float.mean()) / (query_float.std() + 1e-6)
    ref_float = (ref_float - ref_float.mean()) / (ref_float.std() + 1e-6)
    correlation = float((query_float * ref_float).mean())

    return float(0.65 * iou + 0.35 * max(0.0, correlation))


def compute_component_shape_score(query_image_path: str, ref_image_path: str) -> float:
    """
    Compare normalized large-view component masks.

    This is generic for multi-model CAD drawings: it compares the internal
    shape of each major view, not a part-specific primitive such as a hole.
    """
    try:
        query_components = _extract_view_components(query_image_path)
        ref_components = _extract_view_components(ref_image_path)
    except Exception:
        return 0.0

    total = sum(component["area"] for component in ref_components) or 1.0
    score = 0.0
    used_query_indexes = set()

    for ref_component in ref_components:
        best_score = 0.0
        best_index = None
        for index, query_component in enumerate(query_components):
            if index in used_query_indexes:
                continue

            distance = np.hypot(
                (ref_component["cx"] - query_component["cx"]) * 1.5,
                (ref_component["cy"] - query_component["cy"]) * 1.5,
            )
            if distance > 0.22:
                continue

            size_score = np.exp(
                -abs(np.log((query_component["area"] + 1e-6) / (ref_component["area"] + 1e-6))) * 0.4
            )
            mask_score = _component_mask_similarity(query_component["mask"], ref_component["mask"])
            candidate_score = mask_score * size_score * max(0.0, 1.0 - distance / 0.22)
            if candidate_score > best_score:
                best_score = float(candidate_score)
                best_index = index

        if best_index is not None:
            used_query_indexes.add(best_index)
            score += ref_component["area"] * best_score

    return float(score / total)


def compute_homography_inliers(query_kp, ref_kp, good_matches, query_shape=None):
    """Compute RANSAC homography inliers and sanity-check the transform."""
    if len(good_matches) < 8:
        return 0, None, 0.0, False

    src_pts = np.float32([query_kp[match.queryIdx].pt for match in good_matches]).reshape(-1, 1, 2)
    dst_pts = np.float32([ref_kp[match.trainIdx].pt for match in good_matches]).reshape(-1, 1, 2)

    homography, mask = cv2.findHomography(src_pts, dst_pts, cv2.RANSAC, 3.0)
    if mask is None:
        return 0, homography, 0.0, False

    inliers = int(mask.sum())
    inlier_coverage = 0.0
    if inliers >= 4 and homography is not None:
        inlier_pts = src_pts[mask.ravel() == 1]
        if len(inlier_pts) >= 4:
            x_min, y_min = inlier_pts.min(axis=0)[0]
            x_max, y_max = inlier_pts.max(axis=0)[0]
            bbox_area = max(0.0, (x_max - x_min) * (y_max - y_min))
            if query_shape is not None:
                image_area = max(1, query_shape[0] * query_shape[1])
            else:
                all_x = [kp.pt[0] for kp in query_kp]
                all_y = [kp.pt[1] for kp in query_kp]
                image_area = max(1, (max(all_x) - min(all_x)) * (max(all_y) - min(all_y)))
            inlier_coverage = float(bbox_area / image_area)

    homography_valid = False
    if homography is not None and inliers >= 4:
        homography_valid = _check_homography_sanity(homography, query_kp, query_shape)

    return inliers, homography, inlier_coverage, homography_valid


def _check_homography_sanity(homography, query_kp, query_shape=None) -> bool:
    """Reject degenerate transforms while allowing normal scan/photo warp."""
    try:
        if homography is None or not np.all(np.isfinite(homography)):
            return False

        condition = np.linalg.cond(homography)
        if condition > 1e8:
            return False

        h22 = abs(homography[2, 2])
        if h22 < 0.1 or h22 > 10.0:
            return False

        if query_shape is not None:
            height, width = query_shape[:2]
            corners = np.float32([
                [0, 0],
                [width - 1, 0],
                [width - 1, height - 1],
                [0, height - 1],
            ]).reshape(-1, 1, 2)
        else:
            all_x = [kp.pt[0] for kp in query_kp]
            all_y = [kp.pt[1] for kp in query_kp]
            if not all_x or not all_y:
                return False
            x_min, x_max = min(all_x), max(all_x)
            y_min, y_max = min(all_y), max(all_y)
            if x_max - x_min < 10 or y_max - y_min < 10:
                return False
            corners = np.float32([
                [x_min, y_min],
                [x_max, y_min],
                [x_max, y_max],
                [x_min, y_max],
            ]).reshape(-1, 1, 2)

        transformed = cv2.perspectiveTransform(corners, homography).reshape(4, 2)
        if not np.all(np.isfinite(transformed)):
            return False

        source_area = abs(cv2.contourArea(corners.reshape(4, 2)))
        transformed_area = abs(cv2.contourArea(transformed))
        if source_area <= 0 or transformed_area <= 0:
            return False

        area_ratio = transformed_area / source_area
        if area_ratio < 0.05 or area_ratio > 20.0:
            return False

        edges = []
        for index in range(4):
            dx = transformed[(index + 1) % 4][0] - transformed[index][0]
            dy = transformed[(index + 1) % 4][1] - transformed[index][1]
            edges.append(float(np.hypot(dx, dy)))
        min_edge = min(edges)
        max_edge = max(edges)
        if min_edge < 1.0 or max_edge / min_edge > 20.0:
            return False

        return True
    except Exception:
        return False


def match_with_sift_ransac(query_image_path: str, manifest: list, preprocess_mode: str = "gray") -> dict:
    """Run SIFT + RANSAC matching for each model in the manifest."""
    query_img = preprocess_for_sift(query_image_path, mode=preprocess_mode)
    query_kp, query_des = extract_sift_features(query_img)

    result = {
        "preprocess_mode": preprocess_mode,
        "query_keypoints": len(query_kp),
        "query_descriptors": len(query_des) if query_des is not None else 0,
        "models": [],
    }

    for item in manifest:
        model_result = {
            "model_id": item["model_id"],
            "name": item["name"],
            "ref_keypoints": 0,
            "good_matches": 0,
            "inliers": 0,
            "confidence": 0.0,
            "matched": False,
            "inlier_ratio": 0.0,
            "inlier_coverage": 0.0,
            "homography_valid": False,
            "line_score": 0.0,
            "component_score": 0.0,
            "region_score": 0.0,
            "matched_region_count": 0,
            "query_region_count": 0,
            "ref_region_count": 0,
            "region_supported": False,
            "near_miss_promoted": False,
        }

        feature_file = item["feature_file"]
        if not Path(feature_file).exists() or query_des is None or len(query_des) == 0:
            result["models"].append(model_result)
            continue

        data = np.load(feature_file)
        ref_des = data["descriptors"].astype(np.float32)
        ref_kp = deserialize_keypoints(data.get("keypoints", np.array([])))
        model_result["ref_keypoints"] = len(ref_kp)

        if len(ref_des) == 0 or len(ref_kp) == 0:
            result["models"].append(model_result)
            continue

        good_matches = match_sift(query_des, ref_des)
        model_result["good_matches"] = len(good_matches)

        if len(good_matches) >= MIN_GOOD_MATCHES:
            inliers, _, inlier_coverage, homography_valid = compute_homography_inliers(
                query_kp,
                ref_kp,
                good_matches,
                query_img.shape,
            )
            inlier_ratio = inliers / len(good_matches) if good_matches else 0.0
            base_confidence = min(inliers / CONFIDENCE_SCALE, 1.0)

            if not homography_valid:
                confidence = base_confidence * 0.2
            elif inlier_coverage < MIN_INLIER_COVERAGE:
                confidence = base_confidence * 0.3
            elif inlier_ratio < MIN_INLIER_RATIO:
                confidence = base_confidence * (inlier_ratio / MIN_INLIER_RATIO)
            else:
                confidence = base_confidence

            model_result.update({
                "inliers": inliers,
                "homography_valid": homography_valid,
                "inlier_ratio": round(float(inlier_ratio), 3),
                "inlier_coverage": round(float(inlier_coverage), 3),
                "confidence": round(float(min(confidence, 1.0)), 3),
            })

        ref_image_path = item.get("ref_image")
        if ref_image_path and Path(ref_image_path).exists():
            line_score = compute_line_layout_score(query_image_path, ref_image_path)
            model_result["line_score"] = round(float(line_score), 3)
            component_score = compute_component_shape_score(query_image_path, ref_image_path)
            model_result["component_score"] = round(float(component_score), 3)
            region_summary = match_region_sets(query_image_path, ref_image_path)
            model_result["region_score"] = region_summary["region_score"]
            model_result["matched_region_count"] = region_summary["matched_region_count"]
            model_result["query_region_count"] = region_summary["query_region_count"]
            model_result["ref_region_count"] = region_summary["ref_region_count"]
            model_result["region_supported"] = bool(region_summary["region_supported"])

        strict_match = (
            model_result["inliers"] >= INLIER_THRESHOLD
            and model_result["inlier_coverage"] >= MIN_INLIER_COVERAGE
            and model_result["homography_valid"]
            and model_result["confidence"] >= MIN_CONFIDENCE
        )

        near_miss_match = (
            model_result["inliers"] >= NEAR_MISS_INLIERS
            and model_result["inlier_ratio"] >= NEAR_MISS_RATIO
            and model_result["inlier_coverage"] >= NEAR_MISS_COVERAGE
            and model_result["line_score"] >= NEAR_MISS_LINE_SCORE
            and (
                model_result["component_score"] >= NEAR_MISS_COMPONENT_SCORE
                or model_result["region_supported"]
                or model_result["inliers"] <= 10
            )
        )

        model_result["near_miss_promoted"] = bool(not strict_match and near_miss_match)
        model_result["matched"] = bool(strict_match or near_miss_match)
        result["models"].append(model_result)

    return result


def match_query_to_models(query_image_path: str, manifest: list) -> list:
    """Combine multiple preprocessing modes into a final ranked result list."""
    modes = ["gray", "otsu"]
    mode_results = {}

    for mode in modes:
        detailed = match_with_sift_ransac(query_image_path, manifest, preprocess_mode=mode)
        for model in detailed["models"]:
            mode_results.setdefault(model["model_id"], []).append(model)

    results = []
    for item in manifest:
        model_id = item["model_id"]
        matches = mode_results.get(model_id, [])
        if not matches:
            results.append({
                "model_id": model_id,
                "name": item["name"],
                "confidence": 0.0,
                "matched": False,
                "good_matches": 0,
                "inliers": 0,
                "inlier_ratio": 0.0,
                "line_score": 0.0,
                "component_score": 0.0,
                "region_score": 0.0,
                "matched_region_count": 0,
                "query_region_count": 0,
                "ref_region_count": 0,
                "region_supported": False,
                "mode_votes": 0,
            })
            continue

        votes = sum(1 for model in matches if model["matched"])
        best = max(matches, key=lambda model: (model["confidence"], model["region_score"], model["line_score"]))

        final_matched = votes >= 1

        results.append({
            "model_id": model_id,
            "name": item["name"],
            "confidence": best["confidence"],
            "matched": final_matched,
            "good_matches": best["good_matches"],
            "inliers": best["inliers"],
            "inlier_ratio": best.get("inlier_ratio", 0.0),
            "inlier_coverage": best.get("inlier_coverage", 0.0),
            "line_score": best.get("line_score", 0.0),
            "component_score": best.get("component_score", 0.0),
            "region_score": best.get("region_score", 0.0),
            "matched_region_count": best.get("matched_region_count", 0),
            "query_region_count": best.get("query_region_count", 0),
            "ref_region_count": best.get("ref_region_count", 0),
            "region_supported": any(model.get("region_supported") for model in matches),
            "mode_votes": votes,
            "near_miss_promoted": any(model.get("near_miss_promoted") for model in matches),
        })

    results.sort(
        key=lambda item: (item["matched"], item["confidence"], item["region_score"], item["line_score"]),
        reverse=True,
    )
    return results
