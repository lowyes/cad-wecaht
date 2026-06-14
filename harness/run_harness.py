#!/usr/bin/env python3
"""Backend closed-loop harness.

Verifies:
manifest -> reference/features -> FastAPI API -> static glTF/bin URLs.
For major changes, prefer `harness/verify_major.py`, which also runs this file.
"""

from __future__ import annotations

import importlib.util
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONDA_ENV = os.environ.get("HARNESS_CONDA_ENV", "base")
REQUIRED_MODULES = ("cv2", "numpy", "fastapi", "httpx", "multipart")


def ensure_runtime() -> None:
    missing = [name for name in REQUIRED_MODULES if importlib.util.find_spec(name) is None]
    if not missing:
        return
    if os.environ.get("HARNESS_CONDA_BOOTSTRAPPED") == "1":
        print(f"[FAIL] missing modules after conda bootstrap: {', '.join(missing)}")
        sys.exit(1)

    conda = os.environ.get("HARNESS_CONDA_EXE") or shutil.which("conda")
    if not conda:
        print(f"[FAIL] missing modules and conda not found: {', '.join(missing)}")
        sys.exit(1)

    env = os.environ.copy()
    env["HARNESS_CONDA_BOOTSTRAPPED"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    command = [conda, "run", "-n", DEFAULT_CONDA_ENV, "python", str(Path(__file__).resolve()), *sys.argv[1:]]
    if os.name == "nt" and conda.lower().endswith((".bat", ".cmd")):
        command = [os.environ.get("COMSPEC", "cmd.exe"), "/c", *command]
    completed = subprocess.run(command, cwd=str(PROJECT_ROOT), env=env)
    sys.exit(completed.returncode)


ensure_runtime()

import cv2  # noqa: E402
import numpy as np  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


class HarnessResult:
    def __init__(self) -> None:
        self.passed = 0
        self.failed = 0
        self.skipped = 0

    @property
    def success(self) -> bool:
        return self.failed == 0

    def pass_(self, message: str) -> None:
        print(f"[PASS] {message}")
        self.passed += 1

    def fail(self, message: str, fix: str | None = None) -> None:
        print(f"[FAIL] {message}")
        if fix:
            print(f"       Fix: {fix}")
        self.failed += 1

    def skip(self, message: str) -> None:
        print(f"[SKIP] {message}")
        self.skipped += 1

    def info(self, message: str) -> None:
        print(f"[INFO] {message}")


def project_path(path: str | Path) -> Path:
    return PROJECT_ROOT / Path(path)


def read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def url_to_static_path(url: str) -> Path | None:
    prefix = "/static/models/"
    if not url.startswith(prefix):
        return None
    return project_path("data/models") / url[len(prefix) :]


def check_required_files(result: HarnessResult) -> None:
    required = [
        "app.py",
        "data/manifest.json",
        "data/ref_images/part_0001.png",
        "data/model_cards/part_0001.json",
        "data/models/part_0001/test2.gltf",
        "data/models/part_0001/data.bin",
        "scripts/build_feature_index.py",
        "scripts/verify_model_cards.py",
    ]
    missing = [path for path in required if not project_path(path).exists()]
    if missing:
        for path in missing:
            result.fail(f"{path} not found")
        return
    result.pass_("required files exist")


def check_change_logging_docs(result: HarnessResult) -> None:
    agents_path = project_path("AGENTS.md")
    state_path = project_path("docs/STATE.md")
    docs = [path for path in (agents_path, state_path) if path.exists()]
    if len(docs) < 2:
        result.fail("AGENTS.md and docs/STATE.md must exist")
        return
    missing = [path.name for path in docs if "Change Logging Rule" not in path.read_text(encoding="utf-8", errors="replace")]
    if missing:
        result.fail(f"Change Logging Rule missing from: {', '.join(missing)}")
        return
    result.pass_("change logging rule documented")


def check_manifest(result: HarnessResult) -> list[dict[str, Any]]:
    try:
        manifest = read_json(project_path("data/manifest.json"))
    except Exception as exc:
        result.fail(f"cannot read manifest: {exc}")
        return []
    if not isinstance(manifest, list) or not manifest:
        result.fail("manifest must be a non-empty list")
        return []

    required_fields = ("model_id", "name", "ref_image", "feature_file", "model_card", "gltf_url")
    failures_before = result.failed
    for item in manifest:
        model_id = item.get("model_id", "<unknown>")
        for field in required_fields:
            if not item.get(field):
                result.fail(f"manifest {model_id} missing field: {field}")
        for field in ("ref_image", "feature_file", "model_card"):
            if item.get(field) and not project_path(item[field]).exists():
                result.fail(f"manifest {model_id}.{field} target missing: {item[field]}")
        gltf_path = url_to_static_path(item.get("gltf_url", ""))
        if gltf_path is None or not gltf_path.exists():
            result.fail(f"manifest {model_id}.gltf_url target missing: {item.get('gltf_url')}")
    if result.failed == failures_before:
        result.pass_("manifest is valid")
    return manifest


def check_gltf_references(result: HarnessResult) -> None:
    gltf_path = project_path("data/models/part_0001/test2.gltf")
    try:
        gltf = read_json(gltf_path)
    except Exception as exc:
        result.fail(f"cannot parse glTF JSON: {exc}")
        return
    buffer_uris = [buffer.get("uri") for buffer in gltf.get("buffers", []) if isinstance(buffer, dict)]
    if "data.bin" not in buffer_uris:
        result.fail("test2.gltf does not reference data.bin")
        return
    result.pass_("glTF references data.bin correctly")


def check_reference_and_features(result: HarnessResult) -> None:
    image = cv2.imread(str(project_path("data/ref_images/part_0001.png")))
    if image is None:
        result.fail("reference image cannot be read by OpenCV")
        return
    result.pass_(f"reference image loaded: width={image.shape[1]} height={image.shape[0]}")

    feature_path = project_path("data/features/part_0001.npz")
    if not feature_path.exists():
        result.info("feature index missing; rebuilding")
        completed = subprocess.run([sys.executable, "scripts/build_feature_index.py"], cwd=str(PROJECT_ROOT))
        if completed.returncode != 0:
            result.fail("feature index rebuild failed")
            return
    try:
        with np.load(str(feature_path)) as data:
            descriptor_count = int(data["descriptors"].shape[0])
    except Exception as exc:
        result.fail(f"cannot load feature index: {exc}")
        return
    if descriptor_count <= 0:
        result.fail("feature index has zero descriptors")
        return
    result.pass_(f"feature index loaded: descriptors={descriptor_count}")


def create_client(result: HarnessResult) -> TestClient | None:
    if str(PROJECT_ROOT) not in sys.path:
        sys.path.insert(0, str(PROJECT_ROOT))
    try:
        from app import app
    except Exception as exc:
        result.fail(f"cannot import FastAPI app: {exc}")
        return None
    return TestClient(app)


def post_image(client: TestClient, path: Path, mime_type: str):
    with path.open("rb") as file:
        return client.post("/api/recognize", files={"file": (path.name, file, mime_type)})


def check_api(client: TestClient, result: HarnessResult) -> None:
    health = client.get("/api/health")
    if health.status_code == 200 and health.json().get("success") is True:
        result.pass_("/api/health")
    else:
        result.fail(f"/api/health failed: {health.status_code}")

    models = client.get("/api/models")
    body = models.json() if models.status_code == 200 else {}
    if models.status_code == 200 and any(model.get("model_id") == "part_0001" for model in body.get("models", [])):
        result.pass_("/api/models returns part_0001")
    else:
        result.fail(f"/api/models failed: {models.status_code}")

    for url, label in (
        ("/static/models/part_0001/test2.gltf", "static glTF file accessible"),
        ("/static/models/part_0001/data.bin", "static bin file accessible"),
    ):
        response = client.get(url)
        if response.status_code == 200:
            result.pass_(label)
        else:
            result.fail(f"{url} returned HTTP {response.status_code}")

    response = post_image(client, project_path("data/ref_images/part_0001.png"), "image/png")
    body = response.json() if response.status_code == 200 else {}
    top1 = body.get("top1") or {}
    if (
        response.status_code == 200
        and body.get("success") is True
        and body.get("matched") is True
        and top1.get("model_id") == "part_0001"
        and top1.get("gltf_url")
    ):
        result.pass_("/api/recognize matches reference image")
    else:
        result.fail(f"/api/recognize reference check failed: {body}")


def main() -> int:
    os.chdir(PROJECT_ROOT)
    print("=" * 40)
    print("Backend Closed-Loop Harness")
    print("=" * 40)
    print(f"[INFO] Python: {sys.executable}")
    print(f"[INFO] Conda env preference: {DEFAULT_CONDA_ENV}")
    print()

    result = HarnessResult()
    check_required_files(result)
    check_change_logging_docs(result)
    check_manifest(result)
    check_gltf_references(result)
    check_reference_and_features(result)

    client = create_client(result)
    if client is not None:
        check_api(client, result)

    print()
    print("=" * 40)
    print(f"Harness result: {'PASS' if result.success else 'FAIL'}")
    print("=" * 40)
    return 0 if result.success else 1


if __name__ == "__main__":
    raise SystemExit(main())
