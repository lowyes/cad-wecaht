import json
from pathlib import Path
from fastapi import Request


# 常量
MANIFEST_PATH = Path("data/manifest.json")
MATCH_THRESHOLD = 0.50  # 单模型匹配阈值


def load_manifest() -> list:
    """
    加载模型清单

    Returns:
        模型信息列表
    """
    if not MANIFEST_PATH.exists():
        raise FileNotFoundError(f"模型清单文件不存在: {MANIFEST_PATH}")

    with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def build_file_url(request: Request, relative_url: str) -> str:
    """
    将相对 URL 转换为完整可访问 URL

    Args:
        request: FastAPI 请求对象
        relative_url: 相对 URL，如 /static/models/part_0001/test2.gltf

    Returns:
        完整 URL，如 http://127.0.0.1:8000/static/models/part_0001/test2.gltf
    """
    base_url = str(request.base_url).rstrip("/")
    return f"{base_url}{relative_url}"


def get_models(request: Request) -> list:
    """
    获取所有模型信息（带完整 URL）

    Args:
        request: FastAPI 请求对象

    Returns:
        模型信息列表
    """
    manifest = load_manifest()
    models = []

    for item in manifest:
        models.append({
            "model_id": item["model_id"],
            "name": item["name"],
            "category": item["category"],
            "gltf_url": build_file_url(request, item["gltf_url"])
        })

    return models
