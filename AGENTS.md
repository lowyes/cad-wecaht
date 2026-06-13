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
- The harness validates the existing closed loop only: reference image, feature index, API recognition, and glTF/static model URLs.
- Do not change the recognition algorithm unless the task explicitly asks for that.
