import cv2
import numpy as np
import sys
sys.path.insert(0, '.')
from services.matcher import match_with_sift_ransac
from services.model_service import load_manifest

# 创建随机噪点图片
noise_img = np.random.randint(0, 256, (500, 500), dtype=np.uint8)
cv2.imwrite('data/test_images/noise_test.jpg', noise_img)

manifest = load_manifest()
result = match_with_sift_ransac('data/test_images/noise_test.jpg', manifest, preprocess_mode='otsu')

m = result['models'][0]
print(f"Noise test - good={m['good_matches']}, inliers={m['inliers']}, ratio={m.get('inlier_ratio',0):.3f}, conf={m['confidence']}, matched={m['matched']}")
