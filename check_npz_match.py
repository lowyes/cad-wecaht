import numpy as np
import cv2
from services.image_preprocess import preprocess_image
from services.feature_extract import extract_sift_features

# 从 npz 加载
data = np.load('data/features/part_0001.npz')
ref_desc = data['descriptors']
print('npz type:', ref_desc.dtype, 'shape:', ref_desc.shape)

# 提取查询特征
q_gray = preprocess_image('data/test_images/scan_test_01.jpg')
_, q_desc = extract_sift_features(q_gray)
print('query type:', q_desc.dtype, 'shape:', q_desc.shape)

# 匹配
bf = cv2.BFMatcher(cv2.NORM_L2)
try:
    matches = bf.knnMatch(q_desc, ref_desc, k=2)
    print('SUCCESS! matches:', len(matches))
except Exception as e:
    print('FAILED:', e)
    # 尝试强制类型转换
    matches = bf.knnMatch(q_desc.astype(np.float32), ref_desc.astype(np.float32), k=2)
    print('After cast, matches:', len(matches))
