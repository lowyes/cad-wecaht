"""Run all labeled test_images through the matcher with diagnostic output."""

import contextlib
import io
import os
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
os.chdir(PROJECT_ROOT)
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from services.matcher import match_query_to_models, match_with_sift_ransac  # noqa: E402
from services.model_service import load_manifest  # noqa: E402


MANIFEST = load_manifest()
MODES = ["gray", "otsu"]
TEST_CASES = [
    ("scan_test_01.jpg", True),
    ("scan_test_02.jpg", True),
    ("scan_test_03.png", True),
    ("scan_test_04.png", False),
    ("scan_test_05.png", False),
    ("scan_test_06.png", False),
    ("scan_test_07.png", False),
    ("scan_test_08.png", False),
    ("random_noise.jpg", False),
    ("noise_test.jpg", False),
]


def main() -> int:
    print("=" * 118)
    print("Detailed Matching Diagnosis")
    print("=" * 118)

    all_pass = True
    for filename, should_match in TEST_CASES:
        path = PROJECT_ROOT / "data" / "test_images" / filename
        if not path.exists():
            print(f"\n{filename}: SKIP (not found)")
            continue

        print(f"\n--- {filename} (expect: {'MATCH' if should_match else 'REJECT'}) ---")
        for mode in MODES:
            with contextlib.redirect_stdout(io.StringIO()):
                result = match_with_sift_ransac(str(path), MANIFEST, preprocess_mode=mode)

            for model in result["models"]:
                if model["model_id"] != "part_0001":
                    continue
                print(
                    f"  mode={mode:<6} "
                    f"goodM={model['good_matches']:<5} "
                    f"inliers={model['inliers']:<5} "
                    f"ratio={model.get('inlier_ratio', 0):.3f} "
                    f"coverage={model.get('inlier_coverage', 0):.3f} "
                    f"line={model.get('line_score', 0):.3f} "
                    f"comp={model.get('component_score', 0):.3f} "
                    f"regions={model.get('matched_region_count', 0)}/{model.get('ref_region_count', 0)} "
                    f"region_score={model.get('region_score', 0):.3f} "
                    f"conf={model['confidence']:.3f} "
                    f"matched={model['matched']}"
                )

        final_result = match_query_to_models(str(path), MANIFEST)
        top1 = final_result[0] if final_result else {}
        final_matched = bool(top1.get("matched", False))
        result_str = "[PASS]" if final_matched == should_match else "[FAIL]"
        if final_matched != should_match:
            all_pass = False

        print(
            f"  votes={top1.get('mode_votes', 0)} "
            f"top_region={top1.get('matched_region_count', 0)}/{top1.get('ref_region_count', 0)} "
            f"top_region_score={top1.get('region_score', 0):.3f} "
            f"final={'MATCH' if final_matched else 'REJECT'} "
            f"{result_str}"
        )

    print("\n" + "=" * 118)
    print(f"Overall: {'PASS' if all_pass else 'FAIL'}")
    return 0 if all_pass else 1


if __name__ == "__main__":
    raise SystemExit(main())
