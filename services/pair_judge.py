from __future__ import annotations

from typing import Any

from .model_service import load_manifest
from .matcher import match_query_to_models
from .view_region_detector import match_region_sets
from .vlm_client import call_glm_with_two_images
from .vlm_prompts import PAIR_JUDGE_PROMPT


def judge_pair(
    query_image_path: str,
    ref_image_path: str,
    query_signature: dict[str, Any],
    model_card: dict[str, Any],
) -> dict[str, Any]:
    vlm_result = call_glm_with_two_images(query_image_path, ref_image_path, PAIR_JUDGE_PROMPT)
    if isinstance(vlm_result, dict) and "match_score" in vlm_result:
        return _normalize_pair_result(vlm_result, "glm-4v-flash")
    return _fallback_pair_judge(query_image_path, ref_image_path, query_signature, model_card)


def _fallback_pair_judge(
    query_image_path: str,
    ref_image_path: str,
    query_signature: dict[str, Any],
    model_card: dict[str, Any],
) -> dict[str, Any]:
    region = match_region_sets(query_image_path, ref_image_path)
    legacy_top = _legacy_top_result(query_image_path, model_card["model_id"])
    legacy_matched = bool(legacy_top.get("matched"))
    region_supported = bool(region.get("region_supported"))
    region_score = float(region.get("region_score", 0.0))

    if legacy_matched and region_supported:
        match_score = max(0.82, min(0.96, 0.72 + region_score * 0.5))
        same_part = True
        decision = "match"
        reason = "Fallback accepted by full-image matcher and multi-region support."
    elif region_supported:
        match_score = max(0.62, min(0.78, 0.50 + region_score))
        same_part = match_score >= 0.70
        decision = "match" if same_part else "candidate"
        reason = "Fallback found multi-region support but full-image evidence is weaker."
    else:
        match_score = min(0.45, 0.15 + region_score * 0.8)
        same_part = False
        decision = "no_match"
        reason = "Fallback rejected because fewer than two reference view regions matched."

    return {
        "same_part": bool(same_part),
        "match_score": round(float(match_score), 3),
        "confidence": 0.72,
        "main_same_features": [],
        "main_differences": [] if same_part else ["multi-region support is insufficient"],
        "decision": decision,
        "reason": reason,
        "source": "opencv_fallback",
        "region_summary": region,
        "legacy_summary": legacy_top,
    }


def _legacy_top_result(query_image_path: str, model_id: str) -> dict[str, Any]:
    try:
        manifest = load_manifest()
        results = match_query_to_models(query_image_path, manifest)
    except Exception:
        return {}
    for result in results:
        if result.get("model_id") == model_id:
            return result
    return results[0] if results else {}


def _normalize_pair_result(result: dict[str, Any], source: str) -> dict[str, Any]:
    match_score = float(result.get("match_score", 0.0) or 0.0)
    same_part = bool(result.get("same_part", match_score >= 0.70))
    return {
        "same_part": same_part,
        "match_score": round(match_score, 3),
        "confidence": float(result.get("confidence", 0.0) or 0.0),
        "main_same_features": result.get("main_same_features", []),
        "main_differences": result.get("main_differences", []),
        "decision": result.get("decision", "match" if same_part else "no_match"),
        "reason": result.get("reason", ""),
        "source": source,
    }
