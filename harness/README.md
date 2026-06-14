# Harness Guide For Future Agents

Use this folder to verify changes before marking a task complete.

## Standard Commands

Run the full major-change suite:

```powershell
conda run -n base python harness\verify_major.py
```

If `make` is available:

```powershell
make verify-major
```

This default suite disables live VLM calls by setting `VLM_DISABLE_REMOTE=1`, so it is safe for Claude/Codex automation and does not spend API quota.

To intentionally test GLM-4V-Flash, set `ZHIPU_API_TOKEN` only in the shell environment and run:

```powershell
conda run -n base python harness\verify_major.py --live-vlm
```

Never write API tokens into source files, docs, logs, screenshots, or commits.

## What The Major Suite Runs

1. Python syntax checks for API, VLM, matcher, and harness modules.
2. `scripts/verify_model_cards.py`
3. `harness/run_vlm_harness.py`
4. `harness/test_all_images.py`
5. `harness/run_harness.py`

## When To Use Smaller Harnesses

- Model-card or VLM pipeline only: `conda run -n base python harness\run_vlm_harness.py`
- Traditional OpenCV/SIFT regression set: `conda run -n base python harness\test_all_images.py`
- Backend closed loop/API/static model files: `conda run -n base python harness\run_harness.py`

## Completion Rule

After any code change, update `docs/STATE.md` with the verification command and PASS/WARNING/SKIP/FAIL result. For major changes, include the result of `make verify-major` or `conda run -n base python harness\verify_major.py`.
