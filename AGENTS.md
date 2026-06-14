# Agent Instructions

This backend is a FastAPI + OpenCV engineering drawing recognition service.

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

## Project Notes

- The default Python runtime is conda `base`.
- Prefer `conda run -n base python ...` when running verification from automation.
- For major changes, run `make verify-major` when `make` is available, or `conda run -n base python harness\verify_major.py`.
- The major harness defaults to offline VLM fallback mode by setting `VLM_DISABLE_REMOTE=1`; use `--live-vlm` only when the user explicitly asks to spend API calls.
- The harness validates both the model-card/VLM-first path and the existing closed loop: reference image, feature index, API recognition, and glTF/static model URLs.
- Do not change the recognition algorithm unless the task explicitly asks for that.
- Never write API keys into source files, docs, logs, screenshots, model cards, or commits; use environment variables only.
