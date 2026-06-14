#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
os.chdir(PROJECT_ROOT)
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from services.recognition_pipeline import recognize_engineering_drawing  # noqa: E402


def main() -> int:
    cases_path = PROJECT_ROOT / "harness" / "test_cases.json"
    cases = json.loads(cases_path.read_text(encoding="utf-8"))
    all_pass = True

    print("=" * 118)
    print("VLM-first Model Card Harness")
    print("=" * 118)
    print(
        f"{'image':<34} {'expect':<8} {'actual':<8} {'top':<12} "
        f"{'vlm':<6} {'pair':<6} {'final':<6} {'decision':<10} result"
    )
    print("-" * 118)

    for case in cases:
        image_path = PROJECT_ROOT / case["image"]
        result = recognize_engineering_drawing(str(image_path))
        top1 = result.get("top1") or {}
        actual_matched = bool(result.get("matched"))
        expected_matched = bool(case["expected_matched"])
        expected_model_id = case.get("expected_model_id")
        top_model_id = top1.get("model_id")

        ok = actual_matched == expected_matched
        if expected_model_id and actual_matched:
            ok = ok and top_model_id == expected_model_id
        all_pass = all_pass and ok

        print(
            f"{case['image']:<34} "
            f"{str(expected_matched):<8} "
            f"{str(actual_matched):<8} "
            f"{str(top_model_id):<12} "
            f"{top1.get('vlm_score', 0):<6} "
            f"{top1.get('pair_judge_score', 0):<6} "
            f"{top1.get('final_score', 0):<6} "
            f"{top1.get('decision', ''):<10} "
            f"{'PASS' if ok else 'FAIL'}"
        )
        reason = top1.get("reason")
        if reason:
            print(f"  reason: {reason}")

    print("-" * 118)
    print(f"Overall: {'PASS' if all_pass else 'FAIL'}")
    return 0 if all_pass else 1


if __name__ == "__main__":
    raise SystemExit(main())
