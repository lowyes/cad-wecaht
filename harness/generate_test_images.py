#!/usr/bin/env python3
"""
Generate synthetic test images from data/ref_images/part_0001.png.

The generated images simulate common scan/camera degradation and are intended
for manual stability checks. They are not required for the harness to pass.
"""

from __future__ import annotations

import importlib.util
import os
import shutil
import subprocess
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONDA_ENV = os.environ.get("HARNESS_CONDA_ENV", "base")
REQUIRED_MODULES = ("cv2", "numpy")


def ensure_runtime() -> None:
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


def write_image(path: Path, image, params: list[int] | None = None) -> None:
    ok = cv2.imwrite(str(path), image, params or [])
    if not ok:
        raise RuntimeError(f"failed to write {path}")


def log_generated(path: Path) -> None:
    print(f"[PASS] generated {path.relative_to(PROJECT_ROOT)}")


def rotate_image(image, angle: float):
    height, width = image.shape[:2]
    center = (width / 2, height / 2)
    matrix = cv2.getRotationMatrix2D(center, angle, 1.0)
    return cv2.warpAffine(image, matrix, (width, height), borderMode=cv2.BORDER_REFLECT)


def apply_low_res(image):
    height, width = image.shape[:2]
    small = cv2.resize(
        image,
        (max(1, int(width * 0.4)), max(1, int(height * 0.4))),
        interpolation=cv2.INTER_AREA,
    )
    return cv2.resize(small, (width, height), interpolation=cv2.INTER_LINEAR)


def apply_noise(image):
    noise = np.random.default_rng(42).normal(0, 6, image.shape).astype(np.float32)
    noisy = image.astype(np.float32) + noise
    return np.clip(noisy, 0, 255).astype(np.uint8)


def apply_perspective(image):
    height, width = image.shape[:2]
    src = np.float32([
        [0, 0],
        [width - 1, 0],
        [width - 1, height - 1],
        [0, height - 1],
    ])

    dx = int(width * 0.04)
    dy = int(height * 0.04)
    dst = np.float32([
        [dx, dy],
        [width - dx, 0],
        [width - int(dx * 0.5), height - dy],
        [0, height],
    ])

    matrix = cv2.getPerspectiveTransform(src, dst)
    return cv2.warpPerspective(
        image,
        matrix,
        (width, height),
        borderMode=cv2.BORDER_REPLICATE,
    )


def apply_shadow(image):
    height, width = image.shape[:2]
    gradient = np.linspace(0.65, 1.05, width, dtype=np.float32)
    mask = np.tile(gradient, (height, 1))
    if image.ndim == 3:
        mask = mask[:, :, np.newaxis]
    shaded = image.astype(np.float32) * mask
    return np.clip(shaded, 0, 255).astype(np.uint8)


def write_jpeg_compressed(path: Path, image, quality: int) -> None:
    write_image(path, image, [cv2.IMWRITE_JPEG_QUALITY, quality])


def generate_test_images() -> int:
    ref_image_path = PROJECT_ROOT / "data" / "ref_images" / "part_0001.png"
    output_dir = PROJECT_ROOT / "data" / "test_images" / "generated"
    output_dir.mkdir(parents=True, exist_ok=True)

    if not ref_image_path.exists():
        print(f"[FAIL] reference image not found: {ref_image_path}")
        return 1

    image = cv2.imread(str(ref_image_path))
    if image is None:
        print(f"[FAIL] OpenCV cannot read reference image: {ref_image_path}")
        return 1

    height, width = image.shape[:2]
    print("Engineering Drawing Test Image Generator")
    print(f"[INFO] Python: {sys.executable}")
    print(f"[INFO] source: {ref_image_path}")
    print(f"[INFO] output: {output_dir}")
    print(f"[INFO] size: width={width} height={height}")
    print()

    generated_count = 0

    def save(name: str, generated_image, params: list[int] | None = None) -> None:
        nonlocal generated_count
        path = output_dir / name
        write_image(path, generated_image, params)
        log_generated(path)
        generated_count += 1

    blur_light = cv2.GaussianBlur(image, (3, 3), 0.8)
    save("part_0001_blur_light.jpg", blur_light)

    blur_medium = cv2.GaussianBlur(image, (7, 7), 1.5)
    save("part_0001_blur_medium.jpg", blur_medium)

    save("part_0001_blur.jpg", blur_medium)

    rotate = rotate_image(image, 3)
    save("part_0001_rotate.jpg", rotate)

    rotate_neg = rotate_image(image, -3)
    save("part_0001_rotate_neg3deg.jpg", rotate_neg)

    save("part_0001_low_quality.jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 20])

    low_res = apply_low_res(image)
    save("part_0001_low_res.jpg", low_res)

    dark = cv2.convertScaleAbs(image, alpha=0.5, beta=0)
    save("part_0001_dark.jpg", dark)

    bright = cv2.convertScaleAbs(image, alpha=1.15, beta=25)
    save("part_0001_bright.jpg", bright)

    margin_x = max(1, int(width * 0.05))
    margin_y = max(1, int(height * 0.05))
    crop = image[margin_y : height - margin_y, margin_x : width - margin_x]
    save("part_0001_crop.jpg", crop)

    noise = apply_noise(image)
    save("part_0001_noise.jpg", noise)

    perspective = apply_perspective(image)
    save("part_0001_perspective.jpg", perspective)

    shadow = apply_shadow(image)
    save("part_0001_shadow.jpg", shadow)

    scan_like = apply_perspective(image)
    scan_like = cv2.GaussianBlur(scan_like, (3, 3), 0.8)
    scan_like = cv2.convertScaleAbs(scan_like, alpha=0.75, beta=0)
    scan_like_path = output_dir / "part_0001_scan_like.jpg"
    write_jpeg_compressed(scan_like_path, scan_like, quality=45)
    log_generated(scan_like_path)
    generated_count += 1

    print()
    print(f"[PASS] generated {generated_count} test images")
    return 0


if __name__ == "__main__":
    raise SystemExit(generate_test_images())
