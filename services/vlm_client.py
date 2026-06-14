from __future__ import annotations

import base64
import json
import mimetypes
import os
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from config import ZHIPU_API_TOKEN, ZHIPU_API_URL, ZHIPU_MODEL


def image_to_data_url(image_path: str) -> str:
    mime_type, _ = mimetypes.guess_type(image_path)
    if not mime_type:
        mime_type = "image/png"
    encoded = base64.b64encode(Path(image_path).read_bytes()).decode("utf-8")
    return f"data:{mime_type};base64,{encoded}"


def parse_json_from_text(text: str) -> dict[str, Any] | None:
    text = text.strip()
    if "```json" in text:
        start = text.find("```json") + len("```json")
        end = text.find("```", start)
        if end != -1:
            text = text[start:end].strip()
    elif "```" in text:
        start = text.find("```") + len("```")
        end = text.find("```", start)
        if end != -1:
            text = text[start:end].strip()
    else:
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1 and end > start:
            text = text[start : end + 1]

    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        return None


def call_glm_with_image(image_path: str, prompt: str) -> dict[str, Any] | None:
    return _call_glm([
        {"type": "image_url", "image_url": {"url": image_to_data_url(image_path)}},
        {"type": "text", "text": prompt},
    ])


def call_glm_with_two_images(query_image_path: str, ref_image_path: str, prompt: str) -> dict[str, Any] | None:
    return _call_glm([
        {"type": "image_url", "image_url": {"url": image_to_data_url(query_image_path)}},
        {"type": "image_url", "image_url": {"url": image_to_data_url(ref_image_path)}},
        {"type": "text", "text": prompt},
    ])


def _call_glm(content: list[dict[str, Any]], max_retries: int = 2) -> dict[str, Any] | None:
    if os.environ.get("VLM_DISABLE_REMOTE") == "1":
        return None

    if not ZHIPU_API_TOKEN:
        return None

    payload = {
        "model": ZHIPU_MODEL,
        "messages": [{"role": "user", "content": content}],
        "stream": False,
        "temperature": 0.1,
    }
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        ZHIPU_API_URL,
        data=body,
        headers={
            "Authorization": f"Bearer {ZHIPU_API_TOKEN}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    for attempt in range(max_retries):
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                result = json.loads(response.read().decode("utf-8"))
            choices = result.get("choices") or []
            if not choices:
                return None
            text = choices[0].get("message", {}).get("content", "")
            return parse_json_from_text(text)
        except urllib.error.HTTPError as exc:
            if exc.code == 429 and attempt < max_retries - 1:
                time.sleep((attempt + 1) * 30)
                continue
            return None
        except Exception:
            return None
    return None
