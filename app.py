#!/usr/bin/env python3
from __future__ import annotations

import os
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from services.model_service import build_file_url, get_models, load_manifest, load_model_cards
from services.recognition_pipeline import recognize_engineering_drawing


@asynccontextmanager
async def lifespan(app: FastAPI):
    manifest_path = Path("data/manifest.json")
    if not manifest_path.exists():
        print("warning: data/manifest.json not found")
    else:
        for item in load_manifest():
            model_card = Path(item.get("model_card", f"data/model_cards/{item['model_id']}.json"))
            if not model_card.exists():
                print(f"warning: model card not found: {model_card}")
    yield


app = FastAPI(
    title="Engineering Drawing Recognition Backend",
    description="FastAPI backend for engineering drawing to 3D model recognition.",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

models_dir = Path("data/models")
models_dir.mkdir(parents=True, exist_ok=True)
app.mount("/static/models", StaticFiles(directory="data/models"), name="models")


@app.get("/api/health")
async def health_check():
    return {
        "success": True,
        "message": "backend is running",
        "recognition_mode": "model_card_vlm_first",
        "verified_model_cards": len(load_model_cards(verified_only=True)),
    }


@app.get("/api/models")
async def list_models(request: Request):
    try:
        models = get_models(request)
        return {"success": True, "count": len(models), "models": models}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"failed to load models: {exc}") from exc


@app.post("/api/recognize")
async def recognize_image(request: Request, file: UploadFile = File(...)):
    allowed_types = {"image/jpeg", "image/png", "image/bmp", "image/webp"}
    if file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail=f"unsupported image type: {file.content_type}")

    temp_file = None
    try:
        suffix = Path(file.filename).suffix if file.filename else ".png"
        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
        temp_file.write(await file.read())
        temp_file.close()

        result = recognize_engineering_drawing(temp_file.name)
        if result.get("success") is not True:
            return JSONResponse(status_code=500, content=result)

        response = _public_response(request, result)
        return response
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"recognition failed: {exc}") from exc
    finally:
        if temp_file and os.path.exists(temp_file.name):
            try:
                os.unlink(temp_file.name)
            except Exception:
                pass


def _public_response(request: Request, result: dict[str, Any]) -> dict[str, Any]:
    candidates = [_with_public_urls(request, candidate) for candidate in result.get("candidates", [])]
    top1 = _with_public_urls(request, result["top1"]) if result.get("top1") else None
    return {
        "success": True,
        "matched": bool(result.get("matched")),
        "top1": top1,
        "candidates": candidates,
        "query_signature": result.get("query_signature", {}),
        "message": result.get("message"),
    }


def _with_public_urls(request: Request, candidate: dict[str, Any] | None) -> dict[str, Any] | None:
    if candidate is None:
        return None
    public = dict(candidate)
    public["gltf_url"] = build_file_url(request, candidate.get("gltf_url"))
    public["bin_file"] = build_file_url(request, candidate.get("bin_file"))
    return public


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
