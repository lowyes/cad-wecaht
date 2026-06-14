#!/usr/bin/env python3
import subprocess
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def run(script: str) -> int:
    completed = subprocess.run([sys.executable, str(PROJECT_ROOT / script)], cwd=str(PROJECT_ROOT))
    return completed.returncode


def main() -> int:
    for script in ("scripts/build_feature_index.py", "scripts/build_model_cards.py", "scripts/verify_model_cards.py"):
        code = run(script)
        if code != 0:
            return code
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
