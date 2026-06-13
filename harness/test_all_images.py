"""测试所有 test_images 的匹配结果（含详细诊断）"""
import sys, os, contextlib, io
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
os.chdir(PROJECT_ROOT)
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

# 先加载 matcher 直接测试，获取 coverage 信息
from services.model_service import load_manifest
from services.matcher import match_query_to_models, match_with_sift_ransac

manifest = load_manifest()

test_cases = [
    ("scan_test_01.jpg", True),
    ("scan_test_02.jpg", True),
    ("scan_test_03.png", True),
    ("scan_test_04.png", False),
    ("scan_test_05.png", False),
    ("random_noise.jpg", False),
    ("noise_test.jpg", False),
]

MODES = ["gray", "otsu"]

print("=" * 100)
print("Detailed Matching Diagnosis")
print("=" * 100)

all_pass = True

for filename, should_match in test_cases:
    path = PROJECT_ROOT / "data" / "test_images" / filename
    if not path.exists():
        print(f"\n{filename}: SKIP (not found)")
        continue

    print(f"\n--- {filename} (expect: {'MATCH' if should_match else 'REJECT'}) ---")

    mode_details = []
    for mode in MODES:
        with contextlib.redirect_stdout(io.StringIO()):
            result = match_with_sift_ransac(str(path), manifest, preprocess_mode=mode)
        for m in result["models"]:
            if m["model_id"] == "part_0001":
                print(f"  mode={mode:<6} goodM={m['good_matches']:<5} inliers={m['inliers']:<5} "
                      f"ratio={m.get('inlier_ratio',0):.3f}  coverage={m.get('inlier_coverage',0):.3f}  "
                      f"conf={m['confidence']:.3f}  matched={m['matched']}")
                mode_details.append(m)

    final_result = match_query_to_models(str(path), manifest)
    top1 = final_result[0] if final_result else {}
    votes = top1.get("mode_votes", 0)
    final_matched = bool(top1.get("matched", False))

    result_str = "[PASS]" if final_matched == should_match else "[FAIL]"
    if final_matched != should_match:
        all_pass = False
    print(f"  votes={votes}  final={'MATCH' if final_matched else 'REJECT'}  {result_str}")

print("\n" + "=" * 100)
print(f"Overall: {'PASS' if all_pass else 'FAIL'}")
sys.exit(0 if all_pass else 1)
