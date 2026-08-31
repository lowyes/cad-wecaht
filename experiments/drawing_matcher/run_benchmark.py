from __future__ import annotations

import argparse
from dataclasses import asdict
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import platform
import statistics
import sys


MODULE_ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = MODULE_ROOT.parents[1]
LOCAL_DEPENDENCIES = MODULE_ROOT / ".deps"
if LOCAL_DEPENDENCIES.exists():
    sys.path.insert(0, str(LOCAL_DEPENDENCIES))

from matcher import (  # noqa: E402
    AlikedLightGlueMagsacMatcher,
    MatcherConfig,
    SiftMagsacMatcher,
    load_references,
)
from test_cases import build_cases  # noqa: E402


def percentile(values: list[float], fraction: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round((len(ordered) - 1) * fraction)))
    return ordered[index]


def evaluate_method(matcher, cases):
    rows = []
    for case in cases:
        result = matcher.recognize(case.image)
        predicted = result.model_id if result.accepted else None
        correct = predicted == case.expected_model_id
        rows.append(
            {
                "case_id": case.case_id,
                "expected_model_id": case.expected_model_id,
                "predicted_model_id": predicted,
                "correct": correct,
                "result": result.to_dict(),
            }
        )
        print(
            f"{matcher.method_name:28} {case.case_id:31} "
            f"expected={case.expected_model_id or 'reject':10} "
            f"actual={predicted or 'reject':10} "
            f"score={result.score:.3f} margin={result.margin:.3f} "
            f"{result.latency_ms:8.1f}ms {'PASS' if correct else 'FAIL'}"
        )

    positive_rows = [row for row in rows if row["expected_model_id"] is not None]
    negative_rows = [row for row in rows if row["expected_model_id"] is None]
    latencies = [row["result"]["latency_ms"] for row in rows]
    return {
        "method": matcher.method_name,
        "summary": {
            "cases": len(rows),
            "passed": sum(row["correct"] for row in rows),
            "accuracy": round(sum(row["correct"] for row in rows) / len(rows), 6),
            "positive_accuracy": round(
                sum(row["correct"] for row in positive_rows) / max(len(positive_rows), 1),
                6,
            ),
            "negative_rejection_rate": round(
                sum(row["correct"] for row in negative_rows) / max(len(negative_rows), 1),
                6,
            ),
            "latency_mean_ms": round(statistics.fmean(latencies), 3),
            "latency_p50_ms": round(statistics.median(latencies), 3),
            "latency_p95_ms": round(percentile(latencies, 0.95), 3),
            "latency_max_ms": round(max(latencies), 3),
        },
        "cases": rows,
    }


def parse_args():
    parser = argparse.ArgumentParser(
        description="Benchmark fixed engineering drawing matchers without touching the mini-program runtime."
    )
    parser.add_argument(
        "--method",
        choices=("both", "sift", "aliked"),
        default="both",
    )
    parser.add_argument("--device", choices=("auto", "cpu", "cuda"), default="auto")
    parser.add_argument("--max-keypoints", type=int, default=2048)
    parser.add_argument("--max-image-size", type=int, default=1024)
    parser.add_argument(
        "--references",
        type=Path,
        default=PROJECT_ROOT / "miniprogram" / "assets" / "markers",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=MODULE_ROOT / "reports" / "latest.json",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    config = MatcherConfig(
        max_keypoints=max(256, args.max_keypoints),
        max_image_size=max(320, args.max_image_size),
    )
    references = load_references(args.references.resolve())
    cases = build_cases(references, project_root=PROJECT_ROOT)

    print(f"References: {', '.join(references)}")
    print(f"Cases: {len(cases)}")
    print(f"OpenCV: {__import__('cv2').__version__}")

    matchers = []
    if args.method in ("both", "sift"):
        matchers.append(SiftMagsacMatcher(references, config))
    if args.method in ("both", "aliked"):
        matchers.append(
            AlikedLightGlueMagsacMatcher(
                references,
                config,
                device=args.device,
            )
        )

    results = [evaluate_method(matcher, cases) for matcher in matchers]
    report = {
        "created_at": datetime.now(timezone.utc).astimezone().isoformat(),
        "project_root": str(PROJECT_ROOT),
        "python": sys.version,
        "platform": platform.platform(),
        "method_request": args.method,
        "reference_ids": list(references),
        "case_count": len(cases),
        "config": asdict(config),
        "environment": {
            "cuda_visible_devices": os.getenv("CUDA_VISIBLE_DEVICES"),
        },
        "results": results,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf8",
    )

    print("\nSummary")
    for result in results:
        summary = result["summary"]
        print(
            f"{result['method']:28} accuracy={summary['accuracy']:.1%} "
            f"positive={summary['positive_accuracy']:.1%} "
            f"negative={summary['negative_rejection_rate']:.1%} "
            f"mean={summary['latency_mean_ms']:.1f}ms "
            f"p95={summary['latency_p95_ms']:.1f}ms"
        )
    print(f"Report: {args.output.resolve()}")
    return 0 if all(item["summary"]["accuracy"] == 1.0 for item in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
