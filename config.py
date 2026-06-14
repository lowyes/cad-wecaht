import os
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent

DATA_DIR = BASE_DIR / "data"
REF_IMAGES_DIR = DATA_DIR / "ref_images"
MODEL_CARDS_DIR = DATA_DIR / "model_cards"
MODELS_DIR = DATA_DIR / "models"
UPLOAD_CACHE_DIR = DATA_DIR / "upload_cache"
QUERY_RESULTS_DIR = DATA_DIR / "query_results"
GLM_RAW_DIR = DATA_DIR / "glm_raw"

ZHIPU_API_TOKEN = os.environ.get("ZHIPU_API_TOKEN", "")
ZHIPU_MODEL = os.environ.get("ZHIPU_MODEL", "glm-4v-flash")
ZHIPU_API_URL = os.environ.get(
    "ZHIPU_API_URL",
    "https://open.bigmodel.cn/api/paas/v4/chat/completions",
)

TOP_K = int(os.environ.get("TOP_K", "3"))

SIGNATURE_MATCH_THRESHOLD = float(os.environ.get("SIGNATURE_MATCH_THRESHOLD", "0.55"))
PAIR_JUDGE_MATCH_THRESHOLD = float(os.environ.get("PAIR_JUDGE_MATCH_THRESHOLD", "0.70"))
FINAL_MATCH_THRESHOLD = float(os.environ.get("FINAL_MATCH_THRESHOLD", "0.75"))
CANDIDATE_THRESHOLD = float(os.environ.get("CANDIDATE_THRESHOLD", "0.55"))
