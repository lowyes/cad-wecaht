#!/usr/bin/env python3
"""
One-command backend harness for the FastAPI + OpenCV drawing recognizer.

The harness verifies the existing closed loop:
reference image -> feature index -> recognition API -> glTF URL/static files.
It does not change recognition logic or hard-code recognition results.
"""

from __future__ import annotations

import contextlib
import importlib.util
import io
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
    """Re-run inside conda base when this Python lacks harness dependencies."""
    missing = [name for name in REQUIRED_MODULES if importlib.util.find_spec(name) is None]
    if not missing:
        return

    if os.environ.get("HARNESS_CONDA_BOOTSTRAPPED") == "1":
        print(f"[FAIL] missing Python modules after conda bootstrap: {', '.join(missing)}")
        print("       Fix: install dependencies with `pip install -r requirements.txt` in conda base.")
        sys.exit(1)

    conda = os.environ.get("HARNESS_CONDA_EXE") or shutil.which("conda")
    if not conda:
        print(f"[FAIL] missing Python modules: {', '.join(missing)}")
        print("       Fix: activate conda base, then run `pip install -r requirements.txt`.")
        sys.exit(1)

    env = os.environ.copy()
    env["HARNESS_CONDA_BOOTSTRAPPED"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    command = [
        conda,
        "run",
        "-n",
        DEFAULT_CONDA_ENV,
        "python",
        str(Path(__file__).resolve()),
        *sys.argv[1:],
    ]
    if os.name == "nt" and conda.lower().endswith((".bat", ".cmd")):
        command = [os.environ.get("COMSPEC", "cmd.exe"), "/c", *command]

    print(
        "[INFO] current Python is missing "
        f"{', '.join(missing)}; retrying with conda env `{DEFAULT_CONDA_ENV}`"
    )
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
        self.errors: list[str] = []

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
        self.errors.append(message)

    def skip(self, message: str) -> None:
        print(f"[SKIP] {message}")
        self.skipped += 1

    def info(self, message: str) -> None:
        print(f"[INFO] {message}")


def project_path(relative_path: str | Path) -> Path:
    return PROJECT_ROOT / Path(relative_path)


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
        "data/manifest.json",
        "data/ref_images/part_0001.png",
        "data/models/part_0001/test2.gltf",
        "data/models/part_0001/data.bin",
        "scripts/build_feature_index.py",
        "app.py",
    ]

    missing = [path for path in required if not project_path(path).exists()]
    if missing:
        for path in missing:
            result.fail(f"{path} not found", f"restore or place `{path}` under the project root.")
        return

    result.pass_("required files exist")


def check_change_logging_docs(result: HarnessResult) -> None:
    agents_path = project_path("AGENTS.md")
    state_path = project_path("docs/STATE.md")
    dev_log_path = project_path("docs/DEV_LOG.md")
    expected_heading = "Change Logging Rule"

    if not agents_path.exists():
        result.fail(
            "AGENTS.md not found",
            "create AGENTS.md and include the Change Logging Rule for future agents.",
        )
        return

    log_docs = [path for path in (state_path, dev_log_path) if path.exists()]
    if not log_docs:
        result.fail(
            "docs/STATE.md or docs/DEV_LOG.md not found",
            "create a persistent Markdown log under docs/.",
        )
        return

    docs_to_check = [agents_path, *log_docs]
    missing_rule = []
    for path in docs_to_check:
        text = path.read_text(encoding="utf-8", errors="replace")
        if expected_heading not in text:
            missing_rule.append(path.relative_to(PROJECT_ROOT).as_posix())

    if missing_rule:
        result.fail(
            f"Change Logging Rule missing from: {', '.join(missing_rule)}",
            "add the rule before marking code changes complete.",
        )
        return

    result.pass_("change logging rule documented")


def check_gltf_references(result: HarnessResult) -> None:
    gltf_path = project_path("data/models/part_0001/test2.gltf")
    if not gltf_path.exists():
        result.fail("data/models/part_0001/test2.gltf not found")
        return

    try:
        gltf = read_json(gltf_path)
    except Exception as exc:
        result.fail(f"cannot parse test2.gltf: {exc}", "make sure the file is valid JSON glTF.")
        return

    buffer_uris = [buffer.get("uri") for buffer in gltf.get("buffers", []) if isinstance(buffer, dict)]
    if "data.bin" not in buffer_uris:
        result.fail(
            "test2.gltf does not reference data.bin",
            "add a buffer entry with uri `data.bin` or update the model asset pair.",
        )
        return

    if not (gltf_path.parent / "data.bin").exists():
        result.fail(
            "test2.gltf references data.bin, but data.bin is missing",
            "place data.bin in data/models/part_0001/.",
        )
        return

    result.pass_("glTF references data.bin correctly")


def normalize_manifest(raw_manifest: Any, result: HarnessResult) -> list[dict[str, Any]]:
    if isinstance(raw_manifest, list):
        return [item for item in raw_manifest if isinstance(item, dict)]
    if isinstance(raw_manifest, dict):
        if isinstance(raw_manifest.get("models"), list):
            return [item for item in raw_manifest["models"] if isinstance(item, dict)]
        return [raw_manifest]

    result.fail("manifest.json must be a model object, a model list, or contain a `models` list.")
    return []


def check_manifest(result: HarnessResult) -> list[dict[str, Any]]:
    manifest_path = project_path("data/manifest.json")
    if not manifest_path.exists():
        result.fail("data/manifest.json not found")
        return []

    try:
        manifest = normalize_manifest(read_json(manifest_path), result)
    except Exception as exc:
        result.fail(f"cannot read manifest.json: {exc}", "fix JSON syntax in data/manifest.json.")
        return []

    if not manifest:
        result.fail("manifest.json contains no models")
        return []

    required_fields = ("model_id", "name", "ref_image", "feature_file", "gltf_url")
    failures_before = result.failed

    for item in manifest:
        model_id = item.get("model_id", "<unknown>")
        missing_fields = [field for field in required_fields if not item.get(field)]
        if missing_fields:
            result.fail(f"manifest item {model_id} is missing: {', '.join(missing_fields)}")
            continue

        for field in ("ref_image", "feature_file"):
            target = project_path(item[field])
            if not target.exists():
                result.fail(
                    f"manifest {model_id}.{field} points to a missing file: {item[field]}",
                    f"create `{item[field]}` or correct data/manifest.json.",
                )

        gltf_file = url_to_static_path(item["gltf_url"])
        if gltf_file is None:
            result.fail(
                f"manifest {model_id}.gltf_url is not under /static/models/: {item['gltf_url']}",
                "use a URL such as /static/models/part_0001/test2.gltf.",
            )
        elif not gltf_file.exists():
            result.fail(
                f"manifest {model_id}.gltf_url points to a missing file: {item['gltf_url']}",
                f"create `{gltf_file.relative_to(PROJECT_ROOT)}` or correct gltf_url.",
            )

    if result.failed == failures_before:
        result.pass_("manifest is valid")

    return manifest


def check_reference_image(result: HarnessResult) -> None:
    ref_path = project_path("data/ref_images/part_0001.png")
    image = cv2.imread(str(ref_path))
    if image is None:
        result.fail(
            "cannot load data/ref_images/part_0001.png with OpenCV",
            "replace it with a valid PNG/JPG reference image.",
        )
        return

    height, width = image.shape[:2]
    if width <= 0 or height <= 0:
        result.fail(f"reference image has invalid size: width={width} height={height}")
        return

    result.pass_(f"reference image loaded: width={width} height={height}")


def build_feature_index(result: HarnessResult) -> bool:
    script = project_path("scripts/build_feature_index.py")
    if not script.exists():
        result.fail("scripts/build_feature_index.py not found")
        return False

    completed = subprocess.run(
        [sys.executable, str(script)],
        cwd=str(PROJECT_ROOT),
        capture_output=True,
        text=True,
        timeout=90,
    )
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout).strip()
        result.fail(
            f"feature index generation failed with exit code {completed.returncode}",
            "run `python scripts/build_feature_index.py` and inspect the output."
            + (f" Last output: {detail[-300:]}" if detail else ""),
        )
        return False

    return True


def check_feature_index(result: HarnessResult) -> None:
    feature_path = project_path("data/features/part_0001.npz")
    if not feature_path.exists():
        result.info("data/features/part_0001.npz not found; building feature index now")
        if not build_feature_index(result):
            return

    if not feature_path.exists():
        result.fail(
            "data/features/part_0001.npz still does not exist after build",
            "check manifest feature_file and scripts/build_feature_index.py.",
        )
        return

    try:
        with np.load(str(feature_path)) as feature_data:
            if "descriptors" not in feature_data:
                result.fail(
                    "feature index does not contain `descriptors`",
                    "rebuild it with `python scripts/build_feature_index.py`.",
                )
                return
            descriptors = feature_data["descriptors"]
            descriptor_count = descriptors.shape[0] if descriptors.ndim else 0
    except Exception as exc:
        result.fail(f"cannot load feature index: {exc}", "delete the .npz and rebuild the index.")
        return

    if descriptor_count <= 0:
        result.fail(
            "feature index has zero descriptors",
            "use a clearer reference image, then rebuild the feature index.",
        )
        return

    result.pass_(f"feature index loaded: descriptors={descriptor_count}")


def create_client(result: HarnessResult) -> TestClient | None:
    if str(PROJECT_ROOT) not in sys.path:
        sys.path.insert(0, str(PROJECT_ROOT))

    try:
        from app import app
    except Exception as exc:
        result.fail(
            f"cannot import FastAPI app: {exc}",
            "install requirements in conda base and verify app.py imports cleanly.",
        )
        return None

    return TestClient(app)


def check_api_health(client: TestClient, result: HarnessResult) -> None:
    response = client.get("/api/health")
    if response.status_code != 200:
        result.fail(f"/api/health returned HTTP {response.status_code}")
        return

    body = response.json()
    if body.get("success") is not True:
        result.fail(f"/api/health returned success != true: {body}")
        return

    result.pass_("/api/health")


def check_api_models(client: TestClient, result: HarnessResult) -> None:
    response = client.get("/api/models")
    if response.status_code != 200:
        result.fail(f"/api/models returned HTTP {response.status_code}")
        return

    body = response.json()
    models = body.get("models") or []
    part = next((model for model in models if model.get("model_id") == "part_0001"), None)

    if body.get("success") is not True:
        result.fail(f"/api/models returned success != true: {body}")
    elif body.get("count", 0) < 1 or not models:
        result.fail("/api/models returned no models")
    elif not part:
        result.fail(f"/api/models did not include part_0001; returned {[m.get('model_id') for m in models]}")
    elif not part.get("gltf_url"):
        result.fail("/api/models returned part_0001 with an empty gltf_url")
    else:
        result.pass_("/api/models returns part_0001")


def check_static_files(client: TestClient, result: HarnessResult) -> None:
    static_targets = [
        ("/static/models/part_0001/test2.gltf", "static glTF file accessible"),
        ("/static/models/part_0001/data.bin", "static bin file accessible"),
    ]

    for url, message in static_targets:
        response = client.get(url)
        if response.status_code == 200:
            result.pass_(message)
        else:
            result.fail(
                f"{url} returned HTTP {response.status_code}",
                "verify app.py mounts data/models at /static/models and the file exists.",
            )


def post_image(client: TestClient, url: str, path: Path, mime_type: str):
    with path.open("rb") as file:
        return client.post(url, files={"file": (path.name, file, mime_type)})


def confidence_from_response(body: dict[str, Any]) -> Any:
    top1 = body.get("top1")
    if isinstance(top1, dict) and "confidence" in top1:
        return top1["confidence"]

    candidates = body.get("candidates") or []
    if candidates and isinstance(candidates[0], dict):
        return candidates[0].get("confidence", 0)

    return 0


def check_recognize_reference(client: TestClient, result: HarnessResult) -> None:
    ref_path = project_path("data/ref_images/part_0001.png")
    if not ref_path.exists():
        result.fail("reference image is missing; cannot test /api/recognize")
        return

    with contextlib.redirect_stdout(io.StringIO()):
        response = post_image(client, "/api/recognize", ref_path, "image/png")

    if response.status_code != 200:
        result.fail(f"/api/recognize returned HTTP {response.status_code}: {response.text[:200]}")
        return

    body = response.json()
    top1 = body.get("top1")
    if body.get("success") is not True:
        result.fail(f"/api/recognize returned success != true: {body}")
    elif body.get("matched") is not True:
        result.fail(
            "reference image did not match with matched=true",
            "rebuild features and check the matcher threshold in services/model_service.py.",
        )
    elif not isinstance(top1, dict) or top1.get("model_id") != "part_0001":
        result.fail(f"/api/recognize top1.model_id is not part_0001: {top1}")
    elif not top1.get("gltf_url"):
        result.fail("/api/recognize top1.gltf_url is empty")
    else:
        result.pass_("/api/recognize matches reference image")


def check_recognize_scan_test(client: TestClient, result: HarnessResult) -> None:
    scan_path = project_path("data/test_images/scan_test_01.jpg")
    if not scan_path.exists():
        result.skip("data/test_images/scan_test_01.jpg not found")
        return

    with contextlib.redirect_stdout(io.StringIO()):
        response = post_image(client, "/api/recognize", scan_path, "image/jpeg")

    if response.status_code != 200:
        result.info(f"scan_test_01 request returned HTTP {response.status_code}")
        return

    body = response.json()
    confidence = confidence_from_response(body)
    result.info(f"scan_test_01 confidence = {confidence} matched = {body.get('matched', False)}")


def run_comparison_experiment(result: HarnessResult) -> None:
    """
    对 scan_test_01.jpg 运行多种预处理+特征提取组合的对比实验
    """
    import cv2
    import json
    from services.image_preprocess import preprocess_for_sift
    from services.feature_extract import extract_sift_features, deserialize_keypoints
    from services.matcher import match_with_sift_ransac, match_sift
    from services.model_service import load_manifest

    scan_path = project_path("data/test_images/scan_test_01.jpg")
    if not scan_path.exists():
        result.skip("scan_test_01.jpg not found for comparison experiment")
        return

    debug_dir = project_path("data/debug")
    debug_dir.mkdir(parents=True, exist_ok=True)

    manifest = load_manifest()

    print()
    print("=" * 70)
    print("Comparison Experiment: scan_test_01.jpg")
    print("=" * 70)
    print(f"{'Method':<20} {'Query KPs':<12} {'Ref KPs':<12} {'Good':<8} {'Inliers':<8} {'Conf':<8} {'Matched'}")
    print("-" * 70)

    methods = [
        ("sift+gray", "gray"),
        ("sift+otsu", "otsu"),
        ("sift+adaptive", "adaptive"),
        ("sift+edge", "edge"),
    ]

    report = {"test_image": "scan_test_01.jpg", "methods": []}

    for method_name, mode in methods:
        try:
            # 使用 matcher 的详细匹配函数
            detailed = match_with_sift_ransac(str(scan_path), manifest, preprocess_mode=mode)

            if detailed["models"]:
                m = detailed["models"][0]
                matched = "Y" if m["matched"] else "N"
                print(f"{method_name:<20} {detailed['query_keypoints']:<12} {m['ref_keypoints']:<12} "
                      f"{m['good_matches']:<8} {m['inliers']:<8} {m['confidence']:<8.3f} {matched}")

                report["methods"].append({
                    "method": method_name,
                    "preprocess_mode": mode,
                    "query_keypoints": detailed["query_keypoints"],
                    "query_descriptors": detailed["query_descriptors"],
                    "ref_keypoints": m["ref_keypoints"],
                    "good_matches": m["good_matches"],
                    "inliers": m["inliers"],
                    "confidence": m["confidence"],
                    "matched": m["matched"]
                })

                # 保存预处理后的查询图
                preprocessed = preprocess_for_sift(str(scan_path), mode=mode)
                cv2.imwrite(str(debug_dir / f"query_{mode}.jpg"), preprocessed)

                # 保存匹配可视化图
                try:
                    query_img = preprocessed
                    ref_img = preprocess_for_sift(str(project_path("data/ref_images/part_0001.png")), mode=mode)

                    # 加载参考图特征
                    data = np.load(str(project_path("data/features/part_0001.npz")))
                    ref_des = data["descriptors"].astype(np.float32)
                    ref_kp_data = data.get("keypoints", np.array([]))
                    ref_kp = deserialize_keypoints(ref_kp_data)

                    if mode == "edge":
                        # 边缘图无法提取 SIFT 描述符，跳过匹配可视化
                        pass
                    else:
                        # 重新提取查询图特征用于可视化
                        query_kp, query_des = extract_sift_features(query_img)
                        if query_des is not None and len(query_des) > 0 and len(ref_des) > 0:
                            query_des = query_des.astype(np.float32)
                            good_matches = match_sift(query_des, ref_des)

                            if len(good_matches) > 0:
                                # 绘制匹配图
                                match_img = cv2.drawMatches(
                                    query_img, query_kp,
                                    ref_img, ref_kp,
                                    good_matches[:50],  # 最多显示50个匹配
                                    None,
                                    flags=cv2.DrawMatchesFlags_NOT_DRAW_SINGLE_POINTS
                                )
                                cv2.imwrite(str(debug_dir / f"matches_{mode}.jpg"), match_img)
                except Exception as e:
                    print(f"  (match visualization skipped: {e})")

        except Exception as e:
            print(f"{method_name:<20} ERROR: {e}")
            report["methods"].append({"method": method_name, "error": str(e)})

    print("-" * 70)

    # 保存对比报告
    report_path = debug_dir / "recognition_report.json"
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    print(f"Report saved: {report_path}")

    # 保存参考图预处理结果
    ref_path = project_path("data/ref_images/part_0001.png")
    for mode in ["gray", "otsu", "adaptive", "edge"]:
        try:
            ref_preprocessed = preprocess_for_sift(str(ref_path), mode=mode)
            cv2.imwrite(str(debug_dir / f"ref_{mode}.jpg"), ref_preprocessed)
        except Exception:
            pass

    result.info("comparison experiment completed")


def main() -> int:
    os.chdir(PROJECT_ROOT)

    print("=" * 40)
    print("Engineering Drawing Backend Harness")
    print("=" * 40)
    print(f"[INFO] Python: {sys.executable}")
    print(f"[INFO] Conda env preference: {DEFAULT_CONDA_ENV}")
    print()

    result = HarnessResult()

    check_required_files(result)
    check_change_logging_docs(result)
    check_gltf_references(result)
    check_manifest(result)
    check_reference_image(result)
    check_feature_index(result)

    client = create_client(result)
    if client is not None:
        check_api_health(client, result)
        check_api_models(client, result)
        check_static_files(client, result)
        check_recognize_reference(client, result)
        check_recognize_scan_test(client, result)

    # 运行对比实验
    run_comparison_experiment(result)

    print()
    print("=" * 40)
    print(f"Harness result: {'PASS' if result.success else 'FAIL'}")
    print("=" * 40)
    return 0 if result.success else 1


if __name__ == "__main__":
    raise SystemExit(main())
