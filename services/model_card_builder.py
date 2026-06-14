from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from config import GLM_RAW_DIR, MODEL_CARDS_DIR
from .vlm_client import call_glm_with_image
from .vlm_prompts import DIMENSION_PROMPT, MODEL_CARD_PROMPT, STRUCTURE_PROMPT
from .vlm_signature import extract_fallback_signature


def build_structure_signature(ref_image_path: str) -> dict[str, Any]:
    result = call_glm_with_image(ref_image_path, STRUCTURE_PROMPT)
    return result if isinstance(result, dict) else extract_fallback_signature(ref_image_path)


def build_dimension_signature(ref_image_path: str) -> dict[str, Any]:
    result = call_glm_with_image(ref_image_path, DIMENSION_PROMPT)
    return result if isinstance(result, dict) else {}


def build_model_card(model_info: dict[str, Any], structure: dict[str, Any], dimensions: dict[str, Any]) -> dict[str, Any]:
    ref_image = model_info.get("ref_image")
    raw_card = call_glm_with_image(ref_image, MODEL_CARD_PROMPT) if ref_image else None
    if isinstance(raw_card, dict):
        card = raw_card
    else:
        card = _fallback_model_card(model_info, structure, dimensions)
    card["model_id"] = model_info["model_id"]
    card["name"] = model_info.get("name", model_info["model_id"])
    card.setdefault("verified", False)
    card.setdefault("dimensions", dimensions)
    return card


def save_model_card(model_id: str, model_card: dict[str, Any]) -> Path:
    MODEL_CARDS_DIR.mkdir(parents=True, exist_ok=True)
    path = MODEL_CARDS_DIR / f"{model_id}.json"
    path.write_text(json.dumps(model_card, indent=2, ensure_ascii=False), encoding="utf-8")
    return path


def save_raw_result(model_id: str, name: str, payload: dict[str, Any]) -> Path:
    GLM_RAW_DIR.mkdir(parents=True, exist_ok=True)
    path = GLM_RAW_DIR / f"{model_id}_{name}_raw.json"
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    return path


def _fallback_model_card(
    model_info: dict[str, Any],
    structure: dict[str, Any],
    dimensions: dict[str, Any],
) -> dict[str, Any]:
    return {
        "model_id": model_info["model_id"],
        "name": model_info.get("name", model_info["model_id"]),
        "verified": False,
        "drawing_type": "engineering_drawing",
        "part_category": structure.get("part_category", "unknown"),
        "top_view": structure.get("top_view", {}),
        "front_view": structure.get("front_view", {}),
        "side_view": structure.get("side_view", {}),
        "dimensions": dimensions or structure.get("dimensions", {}),
        "key_features": structure.get("key_features", []),
        "negative_features": [],
        "match_priority": {
            "very_important": [
                "top_view.hole_layout",
                "top_view.side_feature_type",
                "top_view.outer_contour_type",
            ],
            "important": ["top_view.has_chamfered_outer_contour"],
            "weak": ["view_count", "symmetry"],
        },
        "brief_description": structure.get("brief_description", "Fallback generated model card."),
    }
