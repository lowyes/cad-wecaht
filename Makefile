CONDA_ENV ?= base

.PHONY: verify-major verify-major-live-vlm

verify-major:
	conda run -n $(CONDA_ENV) python harness/verify_major.py

verify-major-live-vlm:
	conda run -n $(CONDA_ENV) python harness/verify_major.py --live-vlm
