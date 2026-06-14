#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from services.model_service import load_manifest, load_model_card  # noqa: E402


REQUIRED_TOP_VIEW = [
    "outer_contour_type",
    "hole_layout",
    "has_center_concentric_circles",
    "center_circle_count",
    "side_feature_type",
    "left_side_feature",
    "right_side_feature",
    "side_closed_hole_count",
    "has_chamfered_outer_contour",
    "symmetry",
]


def main() -> int:
    failures = 0
    for item in load_manifest():
        model_id = item["model_id"]
        card = load_model_card(model_id)
        if not card:
            print(f"[FAIL] {model_id}: model card missing")
            failures += 1
            continue
        for key in ("model_id", "name", "verified", "drawing_type", "part_category", "top_view", "front_view", "side_view", "dimensions", "key_features", "negative_features", "match_priority", "brief_description"):
            if key not in card:
                print(f"[FAIL] {model_id}: missing {key}")
                failures += 1
        if card.get("verified") is not True:
            print(f"[FAIL] {model_id}: verified is not true")
            failures += 1
        top_view = card.get("top_view") or {}
        for key in REQUIRED_TOP_VIEW:
            if key not in top_view:
                print(f"[FAIL] {model_id}: top_view missing {key}")
                failures += 1
        if item.get("gltf_url") and not (PROJECT_ROOT / "data/models" / item["gltf_url"].replace("/static/models/", "")).exists():
            print(f"[FAIL] {model_id}: glTF target missing")
            failures += 1
        if failures == 0:
            print(f"[PASS] {model_id}: model card verified")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
