#!/usr/bin/env python3
"""One command for future agents to verify major backend changes."""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]


COMMANDS = [
    (
        "py_compile",
        [
            "-m",
            "py_compile",
            "app.py",
            "config.py",
            "services/model_service.py",
            "services/vlm_client.py",
            "services/vlm_signature.py",
            "services/model_card_matcher.py",
            "services/pair_judge.py",
            "services/recognition_pipeline.py",
            "harness/run_vlm_harness.py",
            "harness/test_all_images.py",
            "harness/run_harness.py",
        ],
    ),
    ("model_cards", ["scripts/verify_model_cards.py"]),
    ("vlm_model_card_harness", ["harness/run_vlm_harness.py"]),
    ("traditional_all_images", ["harness/test_all_images.py"]),
    ("backend_closed_loop", ["harness/run_harness.py"]),
]


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the full major-change verification suite.")
    parser.add_argument(
        "--live-vlm",
        action="store_true",
        help="Allow live GLM/VLM API calls. Default is offline fallback verification.",
    )
    args = parser.parse_args()

    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    if not args.live_vlm:
        env["VLM_DISABLE_REMOTE"] = "1"

    print("=" * 90, flush=True)
    print("Major Verification Harness", flush=True)
    print("=" * 90, flush=True)
    print(f"Python: {sys.executable}", flush=True)
    print(f"Project: {PROJECT_ROOT}", flush=True)
    print(f"VLM mode: {'live API allowed' if args.live_vlm else 'offline fallback only'}", flush=True)
    print(flush=True)

    failures = []
    for name, command in COMMANDS:
        full_command = [sys.executable, *command]
        print("-" * 90, flush=True)
        print(f"[RUN] {name}: {' '.join(full_command)}", flush=True)
        completed = subprocess.run(full_command, cwd=str(PROJECT_ROOT), env=env)
        if completed.returncode == 0:
            print(f"[PASS] {name}", flush=True)
        else:
            print(f"[FAIL] {name} exit={completed.returncode}", flush=True)
            failures.append((name, completed.returncode))

    print("-" * 90, flush=True)
    if failures:
        print("Overall: FAIL", flush=True)
        for name, code in failures:
            print(f"  {name}: exit={code}", flush=True)
        return 1

    print("Overall: PASS", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
