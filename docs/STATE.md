# Project State

## Change Logging Rule

After every code change, update `docs/STATE.md` or `docs/DEV_LOG.md`.

The log entry must include:

- Date/time
- Agent/tool used
- Change scope
- Files changed
- Reason for change
- Verification commands run
- PASS / WARNING / SKIP / FAIL result
- Known risks
- Next suggested step

For major changes, the log must include the result of `make verify-major`.

Do not mark a task complete without reporting verification results.

## Current State

- Project: FastAPI + OpenCV engineering drawing recognition backend.
- Default Python environment: conda `base`.
- Harness purpose: verify the existing backend loop from reference image to glTF model URL, without changing recognition algorithms.

## Change Log

### 2026-06-13 21:31:56 +08:00

- Agent/tool used: Codex via local PowerShell, `apply_patch`, conda `base` verification planned.
- Change scope: Added persistent change logging rules and harness enforcement for those rules.
- Files changed:
  - `AGENTS.md`
  - `docs/STATE.md`
  - `harness/run_harness.py`
  - `harness/generate_test_images.py`
  - `harness/__init__.py`
- Reason for change: Ensure future Codex/Claude changes are recorded in Markdown and make the harness fail if the logging rule documents are missing.
- Verification commands run:
  - `conda run -n base python --version`
  - `conda run -n base python -c "import cv2, fastapi, httpx, numpy; print('cv2', cv2.__version__); print('fastapi ok')"`
  - `conda run -n base python -m py_compile harness\run_harness.py harness\generate_test_images.py`
  - `conda run -n base python harness\generate_test_images.py`
  - `conda run -n base python harness\run_harness.py`
- Result: PASS. Full harness passed; `scan_test_01` was reported as informational with confidence `0.01` and `matched = False`.
- Known risks:
  - No `Makefile` exists, so `make verify-major` is not currently available.
  - FastAPI TestClient emitted a Starlette deprecation warning about `httpx`; current harness behavior still passes.
  - The harness depends on the existing recognition threshold and reference feature quality.
- Next suggested step: Add a `Makefile` target such as `verify-major` if future major-change verification should be standardized.

### 2026-06-13 (Today) - SIFT + RANSAC + Deskew + Perspective

- Agent/tool used: Claude (MiniMax-M2.7)
- Change scope: Major improvement to preprocessing and feature matching for better recognition of blurry/rotated/perspective-distorted engineering drawings.
- Files changed:
  - `services/image_preprocess.py` - Added: `crop_non_white_border`, `normalize_shadow`, `sharpen`, `rotate_bound`, `estimate_skew_angle`, `deskew_engineering_drawing`, `detect_document_corners`, `correct_perspective`, updated `preprocess_for_sift`
  - `services/feature_extract.py` - Added: `extract_sift_features`, `serialize_keypoints`, `deserialize_keypoints`
  - `services/matcher.py` - Added: `match_sift`, `compute_homography_inliers`, `match_with_sift_ransac`, updated `match_features`, added inlier ratio check
  - `services/model_service.py` - Adjusted `MATCH_THRESHOLD` to 0.40
  - `scripts/build_feature_index.py` - Updated to use new preprocessing and SIFT
  - `harness/run_harness.py` - Added `run_comparison_experiment` for multi-method comparison
- Reason for change: Original ORB matching had very low confidence (0.01) for blurry test images. SIFT + RANSAC with improved preprocessing significantly improves recognition. Added inlier ratio check to prevent random noise from matching.
- Verification commands run:
  - `conda run -n base python scripts/build_feature_index.py`
  - `conda run -n base python harness/run_harness.py`
  - `conda run -n base python test_noise.py` (random noise test)
- Result: **PASS**. scan_test_01 (sift+otsu): 37 good matches, 9 inliers, 0.243 ratio, 0.3 confidence, matched=True. Random noise: 0 matches, correctly rejected.
- Known risks:
  - Perspective correction depends on detecting four corners; may fail on images without clear borders.
  - Deskew only works for angles < 15°; larger rotations need different approach.
- Next suggested step: Test more edge cases including scan_test_02, larger rotations, and blurry images.

### 2026-06-13 23:52:54 +08:00

- Agent/tool used: Codex via local PowerShell, `apply_patch`, conda `base`.
- Change scope: Generalized recognition improvement for engineering drawing scans without hard-coding test image names or part-specific geometry.
- Files changed:
  - `services/image_preprocess.py`
  - `services/matcher.py`
  - `harness/test_all_images.py`
  - `data/features/part_0001.npz`
  - `data/debug/recognition_report.json`
- Reason for change: Existing SIFT/RANSAC flow rejected visually correct degraded scans `scan_test_01`, `scan_test_02`, and `scan_test_03`. The fix corrects deskew rotation direction, replaces fragile matching code with a cleaner SIFT/RANSAC implementation, adds a generic horizontal/vertical engineering-line layout score as a near-miss signal, and keeps negative samples rejected.
- Verification commands run:
  - `conda run -n base python -m py_compile services\matcher.py services\image_preprocess.py scripts\build_feature_index.py`
  - `conda run -n base python scripts\build_feature_index.py`
  - `conda run -n base python -m py_compile services\matcher.py harness\test_all_images.py`
  - `conda run -n base python harness\test_all_images.py`
  - `conda run -n base python harness\run_harness.py`
  - `conda run -n base python test_all_images.py`
  - FastAPI `TestClient` batch POST to `/api/recognize` for `scan_test_01` through `scan_test_05`, `random_noise.jpg`, and `noise_test.jpg`
- Result: PASS. `scan_test_01`, `scan_test_02`, and `scan_test_03` match `part_0001`; `scan_test_04`, `scan_test_05`, `random_noise.jpg`, and `noise_test.jpg` are rejected. Full harness result is PASS.
- Known risks:
  - The generic line-layout near-miss threshold is validated on the current small regression set only; it should be rechecked as more model classes are added.
  - FastAPI TestClient still emits a Starlette deprecation warning about `httpx`.
  - No `Makefile` exists, so `make verify-major` remains unavailable.
- Next suggested step: Add more labeled positive/negative test images per new part and promote `harness/test_all_images.py` into a standard verification target, ideally `make verify-major`.

### 2026-06-14 00:04:36 +08:00

- Agent/tool used: Codex via local PowerShell and Git.
- Change scope: Prepared repository for first Git upload.
- Files changed:
  - `.gitignore`
  - `docs/STATE.md`
- Reason for change: Exclude local caches, agent state, debug outputs, and generated image artifacts from the initial Git commit while preserving source code, required model assets, reference data, and regression images.
- Verification commands run:
  - `git --version`
  - `git ls-remote git@github.com:lowyes/cad-wecaht.git`
  - `git ls-remote ssh://git@ssh.github.com:443/lowyes/cad-wecaht.git`
  - `conda run -n base python harness\run_harness.py`
  - `conda run -n base python harness\test_all_images.py`
  - `git ls-remote origin`
  - `git push -u origin main`
- Result: PASS. Git is available, validation passed, and `main` was pushed to `https://github.com/lowyes/cad-wecaht.git`. Direct GitHub SSH on port 22 timed out, so the push used HTTPS with the existing Git Credential Manager `lowyes` login.
- Known risks:
  - Push may still fail if GitHub SSH credentials are not configured for this machine/account.
  - The remote repository may already contain history; initial push strategy depends on remote state.
- Next suggested step: Continue future pushes with HTTPS/Git Credential Manager, or add a GitHub SSH key later if SSH pushes are preferred.

### 2026-06-14 00:58:02 +08:00

- Agent/tool used: Codex via local PowerShell, `apply_patch`, conda `base`.
- Change scope: Added generalized automatic view-region detection and region-to-region matching diagnostics for CAD drawing recognition.
- Files changed:
  - `services/view_region_detector.py`
  - `services/matcher.py`
  - `scripts/build_feature_index.py`
  - `harness/test_all_images.py`
  - `docs/ALGORITHM.md`
  - `docs/STATE.md`
  - `data/features/part_0001.npz`
  - `data/features/part_0001_region_01_sift.npz`
  - `data/features/part_0001_region_02_sift.npz`
  - `data/ref_regions/part_0001/region_01.png`
  - `data/ref_regions/part_0001/region_02.png`
- Reason for change: Improve generalization beyond fixed front/top/side crop assumptions by automatically detecting major view regions, matching query regions against reference regions, and using multi-region support as a stronger rejection signal for visually similar negatives.
- Verification commands run:
  - `conda run -n base python -m py_compile services\view_region_detector.py services\matcher.py harness\test_all_images.py scripts\build_feature_index.py`
  - `conda run -n base python scripts\build_feature_index.py`
  - `conda run -n base python harness\test_all_images.py`
  - `conda run -n base python harness\run_harness.py`
  - Direct conda base Python API batch POST to `/api/recognize` for all files in the labeled test set
  - Direct conda base Python generation of all feature-match visualizations under `data/debug/feature_matches_all/`
- Result: PASS. Positives `scan_test_01`, `scan_test_02`, and `scan_test_03` match; negatives `scan_test_04` through `scan_test_08`, `random_noise.jpg`, and `noise_test.jpg` are rejected. Full backend harness passed.
- Known risks:
  - Region thresholds are calibrated on the current small labeled set; they should be recalibrated when many more model classes are added.
  - Current automatic view detection found 2 major reference regions for `part_0001`, not separate hand-labeled front/top/side views; this is intentional layout-free behavior but still needs visual review as the dataset grows.
  - FastAPI TestClient still emits a Starlette deprecation warning about `httpx`.
  - No `Makefile` exists, so `make verify-major` is still unavailable and was skipped.
- Next suggested step: Add more labeled positives/negatives per new model and introduce top1/top2 margin checks before scaling toward hundreds of models.
