from __future__ import annotations

from typing import Any

from config import TOP_K


STRONG_MISMATCHES = {
    ("open_semicircle_slots", "closed_side_holes"),
    ("closed_side_holes", "open_semicircle_slots"),
    ("rectangular_base_with_left_right_open_semicircle_slots", "chamfered_polygon_plate"),
    ("single_center_concentric_hole", "center_plus_two_side_holes"),
}


def compare_query_to_model_card(query_signature: dict[str, Any], model_card: dict[str, Any]) -> dict[str, Any]:
    query_top = query_signature.get("top_view", {})
    card_top = model_card.get("top_view", {})
    details = {}

    part_score = _text_score(query_signature.get("part_category"), model_card.get("part_category"), unknown_score=0.55)
    hole_score = _field_score(query_top.get("hole_layout"), card_top.get("hole_layout"), details, "top_view.hole_layout")
    side_score = _field_score(query_top.get("side_feature_type"), card_top.get("side_feature_type"), details, "top_view.side_feature_type")
    contour_score = _field_score(
        query_top.get("outer_contour_type"),
        card_top.get("outer_contour_type"),
        details,
        "top_view.outer_contour_type",
    )
    chamfer_score = 1.0 if query_top.get("has_chamfered_outer_contour") == card_top.get("has_chamfered_outer_contour") else 0.25
    dimension_score = _dimension_score(query_signature.get("dimensions", {}), model_card.get("dimensions", {}))
    view_score = _view_score(query_signature, model_card)

    score = (
        0.20 * part_score
        + 0.25 * hole_score
        + 0.25 * side_score
        + 0.15 * contour_score
        + 0.10 * dimension_score
        + 0.05 * view_score
    )
    penalty = _strong_penalty(query_top, card_top)
    final_score = max(0.0, score - penalty)

    return {
        "model_id": model_card["model_id"],
        "name": model_card.get("name", model_card["model_id"]),
        "vlm_score": round(float(final_score), 3),
        "base_score": round(float(score), 3),
        "penalty": round(float(penalty), 3),
        "details": details,
    }


def rank_model_cards(
    query_signature: dict[str, Any],
    model_cards: list[dict[str, Any]],
    top_k: int = TOP_K,
) -> list[dict[str, Any]]:
    ranked = [compare_query_to_model_card(query_signature, card) for card in model_cards]
    ranked.sort(key=lambda item: item["vlm_score"], reverse=True)
    return ranked[:top_k]


def _field_score(query_value: Any, card_value: Any, details: dict[str, Any], field: str) -> float:
    score = _text_score(query_value, card_value, unknown_score=0.55)
    details[field] = {"query": query_value, "card": card_value, "score": round(score, 3)}
    return score


def _text_score(query_value: Any, card_value: Any, unknown_score: float = 0.4) -> float:
    if query_value is None or query_value in ("", "unknown", "uncertain"):
        return unknown_score
    if card_value is None or card_value in ("", "unknown", "uncertain"):
        return unknown_score
    if query_value == card_value:
        return 1.0
    pair = (str(query_value), str(card_value))
    reverse_pair = (str(card_value), str(query_value))
    if pair in STRONG_MISMATCHES or reverse_pair in STRONG_MISMATCHES:
        return 0.0
    return 0.25


def _dimension_score(query_dimensions: dict[str, Any], card_dimensions: dict[str, Any]) -> float:
    comparable = []
    for key, card_value in card_dimensions.items():
        query_value = query_dimensions.get(key)
        if query_value in (None, "") or card_value in (None, ""):
            continue
        try:
            relative_error = abs(float(query_value) - float(card_value)) / max(abs(float(card_value)), 1.0)
        except (TypeError, ValueError):
            continue
        comparable.append(max(0.0, 1.0 - relative_error))
    if not comparable:
        return 0.55
    return float(sum(comparable) / len(comparable))


def _view_score(query_signature: dict[str, Any], model_card: dict[str, Any]) -> float:
    query_count = query_signature.get("view_count")
    if query_count in (None, 0):
        return 0.55
    card_count = sum(1 for key in ("top_view", "front_view", "side_view") if model_card.get(key, {}).get("exists"))
    return max(0.0, 1.0 - abs(float(query_count) - float(card_count)) / 3.0)


def _strong_penalty(query_top: dict[str, Any], card_top: dict[str, Any]) -> float:
    penalty = 0.0
    pairs = [
        (query_top.get("side_feature_type"), card_top.get("side_feature_type")),
        (query_top.get("hole_layout"), card_top.get("hole_layout")),
        (query_top.get("outer_contour_type"), card_top.get("outer_contour_type")),
    ]
    for query_value, card_value in pairs:
        if (query_value, card_value) in STRONG_MISMATCHES:
            penalty += 0.35
    if query_top.get("has_chamfered_outer_contour") is True and card_top.get("has_chamfered_outer_contour") is False:
        penalty += 0.15
    return min(penalty, 0.7)
