import json
from pathlib import Path

from fastapi import Request


MANIFEST_PATH = Path("data/manifest.json")
MODEL_CARDS_DIR = Path("data/model_cards")
MATCH_THRESHOLD = 0.50


def load_manifest() -> list:
    if not MANIFEST_PATH.exists():
        raise FileNotFoundError(f"model manifest not found: {MANIFEST_PATH}")
    with MANIFEST_PATH.open("r", encoding="utf-8") as file:
        return json.load(file)


def get_model_by_id(model_id: str, manifest: list | None = None) -> dict | None:
    manifest = manifest if manifest is not None else load_manifest()
    return next((item for item in manifest if item.get("model_id") == model_id), None)


def load_model_card(model_id: str) -> dict | None:
    path = MODEL_CARDS_DIR / f"{model_id}.json"
    if not path.exists():
        return None
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def load_model_cards(verified_only: bool = True) -> list[dict]:
    cards = []
    for item in load_manifest():
        card_path = Path(item.get("model_card") or MODEL_CARDS_DIR / f"{item['model_id']}.json")
        if not card_path.exists():
            continue
        with card_path.open("r", encoding="utf-8") as file:
            card = json.load(file)
        if verified_only and card.get("verified") is not True:
            continue
        cards.append(card)
    return cards


def build_file_url(request: Request, relative_url: str | None) -> str | None:
    if not relative_url:
        return None
    base_url = str(request.base_url).rstrip("/")
    return f"{base_url}{relative_url}"


def get_models(request: Request) -> list:
    models = []
    for item in load_manifest():
        models.append({
            "model_id": item["model_id"],
            "name": item["name"],
            "category": item["category"],
            "model_card": item.get("model_card", f"data/model_cards/{item['model_id']}.json"),
            "gltf_url": build_file_url(request, item.get("gltf_url")),
        })
    return models
