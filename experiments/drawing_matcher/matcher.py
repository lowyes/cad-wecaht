from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any
import time

import cv2
import numpy as np


@dataclass(frozen=True)
class MatcherConfig:
    max_keypoints: int = 2048
    max_image_size: int = 1024
    reprojection_threshold: float = 4.0
    min_inliers: int = 18
    min_inlier_ratio: float = 0.22
    min_coverage: float = 0.035
    max_median_reprojection_error: float = 4.5
    min_score: float = 0.38
    min_margin: float = 0.055


@dataclass
class CandidateResult:
    model_id: str
    score: float
    raw_matches: int
    inliers: int
    inlier_ratio: float
    coverage: float
    median_reprojection_error: float | None
    geometry_valid: bool

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class RecognitionResult:
    method: str
    accepted: bool
    model_id: str | None
    score: float
    margin: float
    latency_ms: float
    reason: str
    candidates: list[CandidateResult]

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["candidates"] = [candidate.to_dict() for candidate in self.candidates]
        return payload


def load_references(reference_dir: Path) -> dict[str, np.ndarray]:
    references: dict[str, np.ndarray] = {}
    for image_path in sorted(reference_dir.glob("*_ar_target.png")):
        image = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError(f"Unable to read reference image: {image_path}")
        model_id = image_path.stem.removesuffix("_ar_target")
        references[model_id] = image
    if not references:
        raise ValueError(f"No reference images found in {reference_dir}")
    return references


def _coverage(points: np.ndarray, image_shape: tuple[int, ...]) -> float:
    if len(points) < 3:
        return 0.0
    hull = cv2.convexHull(points.astype(np.float32))
    area = float(cv2.contourArea(hull))
    height, width = image_shape[:2]
    return area / max(float(width * height), 1.0)


def verify_geometry(
    query_points: np.ndarray,
    reference_points: np.ndarray,
    query_shape: tuple[int, ...],
    reference_shape: tuple[int, ...],
    raw_matches: int,
    config: MatcherConfig,
) -> tuple[dict[str, Any], np.ndarray | None]:
    empty = {
        "raw_matches": raw_matches,
        "inliers": 0,
        "inlier_ratio": 0.0,
        "coverage": 0.0,
        "median_reprojection_error": None,
        "score": 0.0,
        "geometry_valid": False,
    }
    if len(query_points) < 4 or len(reference_points) < 4:
        return empty, None

    homography, mask = cv2.findHomography(
        query_points.astype(np.float32),
        reference_points.astype(np.float32),
        method=cv2.USAC_MAGSAC,
        ransacReprojThreshold=config.reprojection_threshold,
        maxIters=10000,
        confidence=0.999,
    )
    if homography is None or mask is None:
        return empty, None

    inlier_mask = mask.reshape(-1).astype(bool)
    inliers = int(inlier_mask.sum())
    if inliers < 4:
        return empty, homography

    inlier_ratio = inliers / max(raw_matches, 1)
    query_inliers = query_points[inlier_mask]
    reference_inliers = reference_points[inlier_mask]
    coverage = min(
        _coverage(query_inliers, query_shape),
        _coverage(reference_inliers, reference_shape),
    )

    projected = cv2.perspectiveTransform(
        query_inliers.reshape(-1, 1, 2).astype(np.float32),
        homography,
    ).reshape(-1, 2)
    errors = np.linalg.norm(projected - reference_inliers, axis=1)
    median_error = float(np.median(errors))

    inlier_score = min(inliers / 80.0, 1.0)
    ratio_score = min(inlier_ratio / 0.65, 1.0)
    coverage_score = min(coverage / 0.35, 1.0)
    error_score = max(0.0, 1.0 - median_error / 8.0)
    score = float(
        0.32 * inlier_score
        + 0.30 * ratio_score
        + 0.25 * coverage_score
        + 0.13 * error_score
    )
    geometry_valid = bool(
        inliers >= config.min_inliers
        and inlier_ratio >= config.min_inlier_ratio
        and coverage >= config.min_coverage
        and median_error <= config.max_median_reprojection_error
        and score >= config.min_score
    )

    return {
        "raw_matches": raw_matches,
        "inliers": inliers,
        "inlier_ratio": round(inlier_ratio, 6),
        "coverage": round(coverage, 6),
        "median_reprojection_error": round(median_error, 6),
        "score": round(score, 6),
        "geometry_valid": geometry_valid,
    }, homography


class _BaseMatcher:
    method_name = "base"

    def __init__(
        self,
        references: dict[str, np.ndarray],
        config: MatcherConfig | None = None,
    ) -> None:
        self.references = references
        self.config = config or MatcherConfig()

    def _match_candidates(self, query: np.ndarray) -> list[CandidateResult]:
        raise NotImplementedError

    def recognize(self, query: np.ndarray) -> RecognitionResult:
        started = time.perf_counter()
        candidates = sorted(
            self._match_candidates(query),
            key=lambda candidate: candidate.score,
            reverse=True,
        )
        latency_ms = (time.perf_counter() - started) * 1000.0
        if not candidates:
            return RecognitionResult(
                method=self.method_name,
                accepted=False,
                model_id=None,
                score=0.0,
                margin=0.0,
                latency_ms=round(latency_ms, 3),
                reason="no_candidates",
                candidates=[],
            )

        best = candidates[0]
        runner_up_score = candidates[1].score if len(candidates) > 1 else 0.0
        margin = best.score - runner_up_score
        accepted = bool(
            best.geometry_valid
            and (margin >= self.config.min_margin or best.score >= 0.84)
        )
        if not best.geometry_valid:
            reason = "geometry_rejected"
        elif not accepted:
            reason = "insufficient_margin"
        else:
            reason = "matched"

        return RecognitionResult(
            method=self.method_name,
            accepted=accepted,
            model_id=best.model_id if accepted else None,
            score=best.score,
            margin=round(margin, 6),
            latency_ms=round(latency_ms, 3),
            reason=reason,
            candidates=candidates,
        )


class SiftMagsacMatcher(_BaseMatcher):
    method_name = "sift_magsac"

    def __init__(
        self,
        references: dict[str, np.ndarray],
        config: MatcherConfig | None = None,
    ) -> None:
        super().__init__(references, config)
        self.extractor = cv2.SIFT_create(
            nfeatures=max(self.config.max_keypoints, 3000),
            contrastThreshold=0.01,
            edgeThreshold=15,
        )
        self.matcher = cv2.BFMatcher(cv2.NORM_L2)
        self.reference_features = {
            model_id: self._extract(image)
            for model_id, image in references.items()
        }

    def _extract(self, image: np.ndarray) -> tuple[list[Any], np.ndarray | None]:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        return self.extractor.detectAndCompute(gray, None)

    def _match_candidates(self, query: np.ndarray) -> list[CandidateResult]:
        query_keypoints, query_descriptors = self._extract(query)
        results: list[CandidateResult] = []
        for model_id, reference in self.references.items():
            reference_keypoints, reference_descriptors = self.reference_features[model_id]
            good_matches = []
            if query_descriptors is not None and reference_descriptors is not None:
                pairs = self.matcher.knnMatch(
                    query_descriptors,
                    reference_descriptors,
                    k=2,
                )
                good_matches = [
                    first
                    for pair in pairs
                    if len(pair) == 2
                    for first, second in [pair]
                    if first.distance < 0.75 * second.distance
                ]

            query_points = np.float32(
                [query_keypoints[match.queryIdx].pt for match in good_matches]
            )
            reference_points = np.float32(
                [reference_keypoints[match.trainIdx].pt for match in good_matches]
            )
            metrics, _ = verify_geometry(
                query_points,
                reference_points,
                query.shape,
                reference.shape,
                len(good_matches),
                self.config,
            )
            results.append(CandidateResult(model_id=model_id, **metrics))
        return results


class AlikedLightGlueMagsacMatcher(_BaseMatcher):
    method_name = "aliked_lightglue_magsac"

    def __init__(
        self,
        references: dict[str, np.ndarray],
        config: MatcherConfig | None = None,
        device: str = "auto",
    ) -> None:
        super().__init__(references, config)
        try:
            import torch
            from lightglue import ALIKED, LightGlue
        except Exception as error:
            raise RuntimeError(
                "ALIKED/LightGlue is unavailable. Run setup.ps1 in the math conda environment."
            ) from error

        self.torch = torch
        if device == "auto":
            device = "cuda" if torch.cuda.is_available() else "cpu"
        self.device = torch.device(device)
        self.extractor = ALIKED(
            max_num_keypoints=self.config.max_keypoints,
            detection_threshold=0.2,
        ).eval().to(self.device)
        self.matcher = LightGlue(
            features="aliked",
            depth_confidence=0.95,
            width_confidence=0.99,
        ).eval().to(self.device)
        self.reference_features = {
            model_id: self._extract(image)
            for model_id, image in references.items()
        }

    def _image_tensor(self, image: np.ndarray):
        rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        tensor = self.torch.from_numpy(np.ascontiguousarray(rgb))
        return tensor.permute(2, 0, 1).float().div(255.0).to(self.device)

    def _extract(self, image: np.ndarray):
        with self.torch.inference_mode():
            return self.extractor.extract(
                self._image_tensor(image),
                resize=self.config.max_image_size,
            )

    def _synchronize(self) -> None:
        if self.device.type == "cuda":
            self.torch.cuda.synchronize(self.device)

    def recognize(self, query: np.ndarray) -> RecognitionResult:
        self._synchronize()
        result = super().recognize(query)
        self._synchronize()
        return result

    def _match_candidates(self, query: np.ndarray) -> list[CandidateResult]:
        from lightglue.utils import rbd

        query_features = self._extract(query)
        results: list[CandidateResult] = []
        with self.torch.inference_mode():
            for model_id, reference in self.references.items():
                reference_features = self.reference_features[model_id]
                matches_output = self.matcher(
                    {"image0": query_features, "image1": reference_features}
                )
                query_unbatched, reference_unbatched, matches_unbatched = [
                    rbd(item)
                    for item in (
                        query_features,
                        reference_features,
                        matches_output,
                    )
                ]
                matches = matches_unbatched["matches"]
                if len(matches):
                    query_points = (
                        query_unbatched["keypoints"][matches[:, 0]]
                        .detach()
                        .cpu()
                        .numpy()
                    )
                    reference_points = (
                        reference_unbatched["keypoints"][matches[:, 1]]
                        .detach()
                        .cpu()
                        .numpy()
                    )
                else:
                    query_points = np.empty((0, 2), dtype=np.float32)
                    reference_points = np.empty((0, 2), dtype=np.float32)

                metrics, _ = verify_geometry(
                    query_points,
                    reference_points,
                    query.shape,
                    reference.shape,
                    len(matches),
                    self.config,
                )
                results.append(CandidateResult(model_id=model_id, **metrics))
        # CPU transfers above synchronize individual tensors, but an explicit
        # barrier keeps the end-to-end latency measurement correct if the
        # implementation changes to defer those transfers later.
        self._synchronize()
        return results
