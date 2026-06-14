#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from services.model_card_builder import (  # noqa: E402
    build_dimension_signature,
    build_model_card,
    build_structure_signature,
    save_model_card,
    save_raw_result,
)
from services.model_service import load_manifest  # noqa: E402


def main() -> int:
    force = "--force" in sys.argv
    failures = 0
    for item in load_manifest():
        model_id = item["model_id"]
        card_path = PROJECT_ROOT / item.get("model_card", f"data/model_cards/{model_id}.json")
        if card_path.exists() and not force:
            existing = json.loads(card_path.read_text(encoding="utf-8"))
            if existing.get("verified") is True:
                print(f"[SKIP] {card_path.relative_to(PROJECT_ROOT)} is verified; use --force to rebuild")
                continue

        ref_image = PROJECT_ROOT / item["ref_image"]
        if not ref_image.exists():
            print(f"[FAIL] missing reference image for {model_id}: {ref_image}")
            failures += 1
            continue
        structure = build_structure_signature(str(ref_image))
        dimensions = build_dimension_signature(str(ref_image))
        card = build_model_card(item, structure, dimensions)
        if not card.get("verified"):
            card["verified"] = False

        save_raw_result(model_id, "structure", structure)
        save_raw_result(model_id, "dimension", dimensions)
        save_raw_result(model_id, "model_card", card)
        path = save_model_card(model_id, card)
        print(f"[PASS] wrote {path.relative_to(PROJECT_ROOT)}")
        if not card.get("verified"):
            print("       Review this card manually, then set verified=true.")

    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
