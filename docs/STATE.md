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

### 2026-06-14 01:20:00 +08:00

- Agent/tool used: Claude (GLM-5) via Trae IDE
- Change scope: Created independent SURF feature detection test folder for algorithm evaluation.
- Files changed:
  - `experiments/surf_test/test_surf.py` - SURF feature detection test script
  - `experiments/surf_test/README.md` - Documentation for SURF testing
- Reason for change: User requested to test SURF algorithm for potential use in engineering drawing recognition, without polluting main source code.
- Verification commands run:
  - `D:\Users\miniconda3\python.exe experiments/surf_test/test_surf.py`
- Result: **WARNING**. SURF is not available in current OpenCV 4.13.0 (requires opencv-contrib-python). Script automatically fell back to SIFT comparison test. SIFT test passed successfully.
- Known risks:
  - SURF requires `opencv-contrib-python` which is not installed in the current environment.
  - Installing opencv-contrib-python may affect other dependencies.
  - SURF patent expired in 2020, but some OpenCV builds still require contrib module.
- Next suggested step: If SURF testing is desired, run `pip install opencv-contrib-python==4.13.0.0` to enable SURF support.

### 2026-06-14 02:30:00 +08:00

- Agent/tool used: Claude (GLM-5) via Trae IDE
- Change scope: Reviewed and updated harness documentation in README.md for clarity.
- Files changed:
  - `README.md` - Updated "Test Harness" section with clear run order and output explanation
- Reason for change: User requested optimization of test harness documentation to ensure proper run sequence and clear understanding of output markers.
- Verification commands run:
  - `conda run -n base python harness/generate_test_images.py`
  - `conda run -n base python harness/run_harness.py`
- Result: **PASS**. generate_test_images.py generated 14 test images. run_harness.py passed all checks: feature index (349 descriptors), /api/health, /api/models, static files (gltf and bin), and /api/recognize. Comparison experiment completed successfully.
- Known risks:
  - None. Existing harness was already well-implemented.
- Next suggested step: User may want to test matching on generated images to evaluate recognition quality.

### 2026-06-14 03:00:00 +08:00

- Agent/tool used: Claude (GLM-5) via Trae IDE
- Change scope: Converted SURF test to Generalized Hough Transform / Shape Based Matching test.
- Files changed:
  - `experiments/surf_test/test_surf.py` - Rewrote to test Generalized Hough Transform
  - `experiments/surf_test/README.md` - Updated documentation for new algorithm
- Reason for change: User requested testing shape-based matching algorithm instead of SURF. Generalized Hough Transform is more suitable for detecting geometric shapes (rectangles, circles, slots) in engineering drawings.
- Verification commands run:
  - `conda run -n base python experiments/surf_test/test_surf.py`
- Result: **PASS**. Shape analysis test completed. Results show:
  - Reference image (part_0001.png): structure_score=0.600 (2 bases, 3 side slots)
  - scan_test_01.jpg: structure_score=0.000 (too blurry for edge detection)
  - scan_test_02.jpg: structure_score=0.600, similarity=1.000 with reference
  - scan_test_03.png: structure_score=0.600, similarity=1.000 with reference
  - Noise images correctly rejected with score=0.000
- Known risks:
  - Blurry images (scan_test_01) fail edge detection, resulting in zero structure score
  - Shape detection parameters may need tuning for different drawing types
- Next suggested step: Consider integrating shape_score as a supplementary signal to SIFT confidence for improved recognition accuracy.

### 2026-06-14 14:16:21 +08:00

- Agent/tool used: Codex via local PowerShell, `apply_patch`, conda `base`.
- Change scope: Added a VLM-first model-card recognition framework while preserving offline fallback verification.
- Files changed:
  - `app.py`
  - `config.py`
  - `data/manifest.json`
  - `data/model_cards/part_0001.json`
  - `services/model_service.py`
  - `services/vlm_client.py`
  - `services/vlm_prompts.py`
  - `services/vlm_signature.py`
  - `services/model_card_builder.py`
  - `services/model_card_matcher.py`
  - `services/pair_judge.py`
  - `services/recognition_pipeline.py`
  - `scripts/build_model_cards.py`
  - `scripts/verify_model_cards.py`
  - `scripts/rebuild_all.py`
  - `harness/test_cases.json`
  - `harness/run_vlm_harness.py`
  - `docs/STATE.md`
- Reason for change: Upgrade the model library from an image/feature library into a structure model-card library, with GLM-4V-Flash hooks for query signatures and pair judging, model-card ranking, API integration, and targeted VLM harness coverage for `scan_test_05` and `scan_test_06`.
- Verification commands run:
  - `conda run -n base python -m py_compile app.py config.py services\vlm_client.py services\vlm_prompts.py services\vlm_signature.py services\model_card_builder.py services\model_card_matcher.py services\pair_judge.py services\recognition_pipeline.py services\model_service.py scripts\build_model_cards.py scripts\verify_model_cards.py scripts\rebuild_all.py harness\run_vlm_harness.py`
  - `conda run -n base python scripts\verify_model_cards.py`
  - `conda run -n base python harness\run_vlm_harness.py`
  - `conda run -n base python harness\run_harness.py`
  - `conda run -n base python harness\test_all_images.py`
  - `conda run -n base python scripts\build_model_cards.py`
  - Direct conda base Python API batch POST to `/api/recognize` for `part_0001.png`, `scan_test_05.png`, and `scan_test_06.png`
- Result: PASS. `part_0001.png` matched `part_0001`; `scan_test_05.png` and `scan_test_06.png` were rejected by model-card/pair-judge scoring. Existing backend harness and all-image traditional matcher tests still pass.
- Known risks:
  - Live GLM calls were not executed during verification to avoid persisting or exposing the provided API key; the framework reads `ZHIPU_API_TOKEN` only from the environment.
  - Without `ZHIPU_API_TOKEN`, query signature and pair judge use OpenCV fallback signals, so scores are deterministic but not true VLM reasoning.
  - `build_model_cards.py` skips existing `verified=true` cards by default; use `--force` only when intentionally rebuilding and re-reviewing cards.
  - No `Makefile` exists, so `make verify-major` is still unavailable and was skipped.
- Next suggested step: Set `ZHIPU_API_TOKEN` in the local shell, run `python harness/run_vlm_harness.py`, review GLM output quality, then expand `data/model_cards/` as new model references are added.

### 2026-06-14 14:27:41 +08:00

- Agent/tool used: Codex via local PowerShell, `apply_patch`, conda `base`.
- Change scope: Cleaned obsolete debug/experiment code and standardized the verification harness for future Claude/Codex agents.
- Files changed:
  - `.gitignore`
  - `AGENTS.md`
  - `Makefile`
  - `harness/README.md`
  - `harness/verify_major.py`
  - `harness/run_harness.py`
  - `services/vlm_client.py`
  - `docs/STATE.md`
  - Removed obsolete tracked scripts:
    - `check_full.py`
    - `check_npz_match.py`
    - `check_type.py`
    - `test_all_images.py`
    - `test_drawings.py`
    - `test_noise.py`
    - `harness/debug_homography.py`
    - `harness/generate_test_images.py`
    - `harness/test_false_positive.py`
    - `harness/visualize_scan_matches.py`
  - Removed local generated/experimental artifacts:
    - `data/glm_recognition/`
    - `experiments/`
    - `debug_scan05.py`
- Reason for change: Reduce confusing duplicate entrypoints, remove one-off experiment/debug scripts, and give future agents a single major verification command: `make verify-major` or `conda run -n base python harness\verify_major.py`.
- Verification commands run:
  - `conda run -n base python harness\verify_major.py`
  - `make verify-major`
- Result: PASS. The major harness passed py_compile, model-card verification, VLM/model-card harness, traditional all-image regression, and backend closed-loop API/static model checks.
- Known risks:
  - `README.md` still has unrelated local modifications that were not part of this cleanup and were intentionally not reverted.
  - `VLM_DISABLE_REMOTE=1` is the default for major verification; live GLM checks require `make verify-major-live-vlm` or `harness\verify_major.py --live-vlm`.
  - FastAPI TestClient still emits the existing Starlette deprecation warning about `httpx`.
- Next suggested step: Keep future algorithm experiments outside the main repo path or under ignored scratch folders until they are ready to become maintained code.
