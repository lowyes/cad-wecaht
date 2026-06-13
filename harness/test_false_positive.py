"""测试：一张完全不相关的随机图会不会被误匹配"""
import sys, os
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parents[1]))

import cv2
import numpy as np
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]

# 1. 生成一张完全不相关的随机图
img = np.ones((600, 800, 3), dtype=np.uint8) * 240
rng = np.random.default_rng(99)
for _ in range(30):
    pt1 = (int(rng.integers(0, 800)), int(rng.integers(0, 600)))
    pt2 = (int(rng.integers(0, 800)), int(rng.integers(0, 600)))
    color = tuple(int(c) for c in rng.integers(0, 100, 3))
    cv2.line(img, pt1, pt2, color, int(rng.integers(1, 4)))
for _ in range(10):
    center = (int(rng.integers(0, 800)), int(rng.integers(0, 600)))
    radius = int(rng.integers(10, 80))
    color = tuple(int(c) for c in rng.integers(0, 100, 3))
    cv2.circle(img, center, radius, color, int(rng.integers(1, 3)))

random_path = PROJECT_ROOT / "data" / "test_images" / "random_noise.jpg"
cv2.imwrite(str(random_path), img)
print(f"[INFO] 生成随机图: {random_path}")

# 2. 用 TestClient 测试识别
os.chdir(PROJECT_ROOT)
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app import app
from fastapi.testclient import TestClient
import contextlib, io

client = TestClient(app)

with random_path.open("rb") as f:
    with contextlib.redirect_stdout(io.StringIO()):
        resp = client.post("/api/recognize", files={"file": ("random_noise.jpg", f, "image/jpeg")})

body = resp.json()
print(f"[INFO] status_code = {resp.status_code}")
print(f"[INFO] success = {body.get('success')}")
print(f"[INFO] matched = {body.get('matched')}")
print(f"[INFO] top1 = {body.get('top1')}")
candidates = body.get("candidates", [])
for c in candidates:
    print(f"[INFO] candidate: model_id={c.get('model_id')} confidence={c.get('confidence')}")

if body.get("matched") is True:
    print()
    print("[FAIL] 随机图被误匹配了！说明系统存在误识别风险。")
    print("       建议：提高 MATCH_THRESHOLD 或增加更多模型来降低误匹配概率。")
    sys.exit(1)
else:
    print()
    print("[PASS] 随机图未被误匹配，系统对无关图片的抗干扰能力正常。")
    sys.exit(0)
