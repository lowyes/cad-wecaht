#!/usr/bin/env python3
"""
工程制图辅助学习小程序 - 后端服务

基于 FastAPI + OpenCV 的图像识别服务，支持：
- 健康检查
- 模型列表查询
- 工程制图图像识别与 3D 模型匹配
"""

import os
import tempfile
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from services.model_service import load_manifest, build_file_url, get_models, MATCH_THRESHOLD
from services.matcher import match_query_to_models


# 生命周期管理
@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用启动时检查必要文件"""
    # 检查 manifest 是否存在
    manifest_path = Path("data/manifest.json")
    if not manifest_path.exists():
        print("警告：data/manifest.json 不存在，请检查数据文件")

    # 检查特征文件是否存在
    manifest = load_manifest()
    for item in manifest:
        feature_file = Path(item["feature_file"])
        if not feature_file.exists():
            print(f"警告：特征文件不存在 {feature_file}")
            print("请运行：python scripts/build_feature_index.py")

    yield


# 创建 FastAPI 应用
app = FastAPI(
    title="工程制图辅助学习小程序 - 后端",
    description="基于 OpenCV 的工程制图图像识别服务",
    version="1.0.0",
    lifespan=lifespan
)

# 配置 CORS（允许小程序开发阶段跨域访问）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 开发阶段允许所有来源
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 挂载静态文件目录
# 确保 data/models 目录存在
models_dir = Path("data/models")
models_dir.mkdir(parents=True, exist_ok=True)

app.mount("/static/models", StaticFiles(directory="data/models"), name="models")


@app.get("/api/health")
async def health_check():
    """健康检查接口"""
    return {
        "success": True,
        "message": "backend is running"
    }


@app.get("/api/models")
async def list_models(request: Request):
    """获取模型列表"""
    try:
        models = get_models(request)
        return {
            "success": True,
            "count": len(models),
            "models": models
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取模型列表失败：{str(e)}")


@app.post("/api/recognize")
async def recognize_image(request: Request, file: UploadFile = File(...)):
    """
    图像识别接口

    接收用户上传的工程制图图片，与模型库进行匹配。
    """
    # 检查文件类型
    allowed_types = ["image/jpeg", "image/png", "image/bmp", "image/webp"]
    if file.content_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的文件类型：{file.content_type}，请上传图片文件"
        )

    # 保存到临时文件
    temp_file = None
    try:
        # 创建临时文件
        suffix = Path(file.filename).suffix if file.filename else ".png"
        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
        content = await file.read()
        temp_file.write(content)
        temp_file.close()

        # 加载模型清单
        manifest = load_manifest()

        # 检查特征文件是否存在
        missing_features = []
        for item in manifest:
            if not Path(item["feature_file"]).exists():
                missing_features.append(item["model_id"])

        if missing_features:
            return JSONResponse(
                status_code=500,
                content={
                    "success": False,
                    "message": f"特征文件不存在，请先运行：python scripts/build_feature_index.py",
                    "missing_models": missing_features
                }
            )

        # 执行匹配
        results = match_query_to_models(temp_file.name, manifest)

        # 获取 top1 结果（matched 字段由 match_query_to_models 的多模式投票逻辑决定）
        top1 = results[0] if results else None
        matched = top1 and top1.get("matched", False)

        # 构建返回结果
        response = {
            "success": True,
            "matched": matched,
            "candidates": results
        }

        if matched:
            # 找到匹配的模型信息
            matched_model = next(
                (item for item in manifest if item["model_id"] == top1["model_id"]),
                None
            )
            if matched_model:
                response["top1"] = {
                    "model_id": top1["model_id"],
                    "name": top1["name"],
                    "category": matched_model["category"],
                    "confidence": top1["confidence"],
                    "model_format": matched_model["model_format"],
                    "gltf_url": build_file_url(request, matched_model["gltf_url"]),
                    "bin_file": build_file_url(request, matched_model["bin_file"])
                }
            else:
                response["top1"] = None
        else:
            response["top1"] = None
            response["message"] = "未找到高置信度匹配结果"

        return response

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"识别过程出错：{str(e)}")

    finally:
        # 清理临时文件
        if temp_file and os.path.exists(temp_file.name):
            try:
                os.unlink(temp_file.name)
            except Exception:
                pass


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
