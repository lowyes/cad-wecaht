#!/usr/bin/env python3
"""
构建特征索引脚本

读取 data/manifest.json，对每个模型的参考图提取 SIFT 特征，
保存到对应的 .npz 文件中。

运行方式：
    python scripts/build_feature_index.py
"""

import sys
import json
import numpy as np
from pathlib import Path
import cv2

# 添加项目根目录到路径
sys.path.insert(0, str(Path(__file__).parent.parent))

from services.image_preprocess import preprocess_for_sift
from services.feature_extract import extract_sift_features


def build_feature_index():
    """构建特征索引"""
    # 读取 manifest
    manifest_path = Path("data/manifest.json")
    if not manifest_path.exists():
        print("错误：data/manifest.json 不存在")
        return

    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    # 确保 features 目录存在
    features_dir = Path("data/features")
    features_dir.mkdir(parents=True, exist_ok=True)

    # 处理每个模型
    for item in manifest:
        model_id = item["model_id"]
        ref_image_path = item["ref_image"]
        feature_file_path = item["feature_file"]

        # 检查参考图是否存在
        if not Path(ref_image_path).exists():
            print(f"警告：参考图不存在 {ref_image_path}，跳过 {model_id}")
            continue

        try:
            # 预处理图像
            gray = preprocess_for_sift(ref_image_path, mode="gray")

            # 提取特征
            keypoints, descriptors = extract_sift_features(gray)

            # 序列化关键点 (只保存 x, y 坐标)
            keypoints_data = np.array([
                (kp.pt[0], kp.pt[1], kp.size, kp.angle, kp.response, kp.octave, kp.class_id)
                for kp in keypoints
            ]) if keypoints else np.array([], dtype=np.float32)

            # 保存特征
            np.savez_compressed(
                feature_file_path,
                descriptors=descriptors,
                keypoints=keypoints_data,
                keypoints_count=len(keypoints)
            )

            print(f"Built feature index for {model_id}: {len(keypoints)} keypoints, {len(descriptors)} descriptors")

        except Exception as e:
            print(f"错误：处理 {model_id} 时出错：{e}")


if __name__ == "__main__":
    build_feature_index()