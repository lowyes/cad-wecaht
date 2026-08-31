from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np


@dataclass
class BenchmarkCase:
    case_id: str
    expected_model_id: str | None
    image: np.ndarray


def _rotate(image: np.ndarray, degrees: float) -> np.ndarray:
    height, width = image.shape[:2]
    matrix = cv2.getRotationMatrix2D((width / 2, height / 2), degrees, 1.0)
    return cv2.warpAffine(
        image,
        matrix,
        (width, height),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(255, 255, 255),
    )


def _perspective(image: np.ndarray) -> np.ndarray:
    height, width = image.shape[:2]
    source = np.float32(
        [[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]]
    )
    destination = np.float32(
        [
            [width * 0.07, height * 0.05],
            [width * 0.94, height * 0.01],
            [width * 0.98, height * 0.94],
            [width * 0.03, height * 0.98],
        ]
    )
    matrix = cv2.getPerspectiveTransform(source, destination)
    return cv2.warpPerspective(
        image,
        matrix,
        (width, height),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(238, 238, 238),
    )


def _photo_like(image: np.ndarray, seed: int) -> np.ndarray:
    warped = _perspective(image)
    rng = np.random.default_rng(seed)
    noise = rng.normal(0, 4.0, warped.shape).astype(np.float32)
    noisy = np.clip(warped.astype(np.float32) + noise, 0, 255).astype(np.uint8)
    return cv2.GaussianBlur(noisy, (3, 3), 0.8)


def _zoom_crop(image: np.ndarray) -> np.ndarray:
    height, width = image.shape[:2]
    crop_x = max(1, int(width * 0.06))
    crop_y = max(1, int(height * 0.06))
    cropped = image[crop_y : height - crop_y, crop_x : width - crop_x]
    return cv2.resize(cropped, (width, height), interpolation=cv2.INTER_LINEAR)


def _negative_line_drawing(width: int = 960, height: int = 720) -> np.ndarray:
    image = np.full((height, width, 3), 255, dtype=np.uint8)
    cv2.rectangle(image, (80, 80), (880, 640), (0, 0, 0), 3)
    for x in range(150, 850, 110):
        cv2.line(image, (x, 130), (x - 60, 570), (0, 0, 0), 2)
    for radius in (35, 70, 105):
        cv2.circle(image, (480, 360), radius, (0, 0, 0), 2)
    cv2.putText(
        image,
        "UNLISTED TEST DRAWING",
        (250, 610),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.7,
        (0, 0, 0),
        2,
        cv2.LINE_AA,
    )
    return image


def _load_project_negatives(project_root: Path) -> list[BenchmarkCase]:
    source_root = project_root / "decs" / "工程制图小程序PRD_files"
    cases: list[BenchmarkCase] = []
    for filename in ("scan_test_05.png", "scan_test_06.png"):
        path = source_root / filename
        if not path.is_file():
            continue
        encoded = np.fromfile(path, dtype=np.uint8)
        image = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
        if image is not None:
            cases.append(
                BenchmarkCase(
                    case_id=f"negative/project_{path.stem}",
                    expected_model_id=None,
                    image=image,
                )
            )
    return cases


def build_cases(
    references: dict[str, np.ndarray],
    project_root: Path | None = None,
) -> list[BenchmarkCase]:
    cases: list[BenchmarkCase] = []
    for index, (model_id, image) in enumerate(references.items()):
        variants = {
            "original": image.copy(),
            "rotate_pos": _rotate(image, 7.0),
            "rotate_neg": _rotate(image, -7.0),
            "perspective": _perspective(image),
            "blur": cv2.GaussianBlur(image, (7, 7), 1.8),
            "dark": cv2.convertScaleAbs(image, alpha=0.62, beta=36),
            "zoom_crop": _zoom_crop(image),
            "photo_like": _photo_like(image, seed=20260804 + index),
        }
        cases.extend(
            BenchmarkCase(
                case_id=f"{model_id}/{variant_name}",
                expected_model_id=model_id,
                image=variant,
            )
            for variant_name, variant in variants.items()
        )

    rng = np.random.default_rng(20260804)
    cases.extend(
        [
            BenchmarkCase(
                case_id="negative/blank",
                expected_model_id=None,
                image=np.full((720, 960, 3), 255, dtype=np.uint8),
            ),
            BenchmarkCase(
                case_id="negative/noise",
                expected_model_id=None,
                image=rng.integers(0, 256, (720, 960, 3), dtype=np.uint8),
            ),
            BenchmarkCase(
                case_id="negative/line_drawing",
                expected_model_id=None,
                image=_negative_line_drawing(),
            ),
        ]
    )
    if project_root is not None:
        cases.extend(_load_project_negatives(project_root))
    return cases
