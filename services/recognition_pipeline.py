from __future__ import annotations

from typing import Any

from config import CANDIDATE_THRESHOLD, FINAL_MATCH_THRESHOLD, PAIR_JUDGE_MATCH_THRESHOLD, TOP_K
from .model_card_matcher import rank_model_cards
from .model_service import get_model_by_id, load_model_cards, load_manifest
from .pair_judge import judge_pair
from .vlm_signature import extract_query_signature


def recognize_engineering_drawing(image_path: str) -> dict[str, Any]:
    query_signature = extract_query_signature(image_path)
    model_cards = load_model_cards(verified_only=True)

    if not model_cards:
        return {
            "success": False,
            "matched": False,
            "message": "No verified model cards are available.",
            "query_signature": query_signature,
            "candidates": [],
        }

    ranked = rank_model_cards(query_signature, model_cards, top_k=TOP_K)
    manifest = load_manifest()
    enriched_candidates = []
    for candidate in ranked:
        model_card = next(card for card in model_cards if card["model_id"] == candidate["model_id"])
        model_info = get_model_by_id(candidate["model_id"], manifest)
        if not model_info:
            continue

        pair = judge_pair(image_path, model_info["ref_image"], query_signature, model_card)
        pair_score = float(pair.get("match_score", 0.0))
        vlm_score = float(candidate.get("vlm_score", 0.0))
        final_score = 0.4 * vlm_score + 0.6 * pair_score
        decision = "match" if (
            final_score >= FINAL_MATCH_THRESHOLD
            and pair_score >= PAIR_JUDGE_MATCH_THRESHOLD
            and pair.get("same_part")
        ) else "candidate" if final_score >= CANDIDATE_THRESHOLD else "no_match"

        enriched_candidates.append({
            "model_id": candidate["model_id"],
            "name": candidate["name"],
            "vlm_score": round(vlm_score, 3),
            "pair_judge_score": round(pair_score, 3),
            "final_score": round(float(final_score), 3),
            "matched": decision == "match",
            "decision": decision,
            "reason": pair.get("reason", ""),
            "pair_judge": pair,
            "gltf_url": model_info.get("gltf_url"),
            "bin_file": model_info.get("bin_file"),
            "model_format": model_info.get("model_format"),
            "category": model_info.get("category"),
        })

    enriched_candidates.sort(key=lambda item: item["final_score"], reverse=True)
    top1 = enriched_candidates[0] if enriched_candidates else None
    matched = bool(top1 and top1["matched"])

    return {
        "success": True,
        "matched": matched,
        "top1": top1 if top1 else None,
        "candidates": enriched_candidates,
        "query_signature": query_signature,
        "message": None if matched else "No high-confidence model-card match.",
    }
