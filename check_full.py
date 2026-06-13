import numpy as np
import cv2
from services.image_preprocess import preprocess_image
from services.feature_extract import extract_sift_features

# 测试查询图
q_gray = preprocess_image('data/test_images/scan_test_01.jpg')
_, q_desc = extract_sift_features(q_gray)
print('query type:', q_desc.dtype, 'shape:', q_desc.shape)

# 测试参考图
r_gray = preprocess_image('data/ref_images/part_0001.png')
_, r_desc = extract_sift_features(r_gray)
print('ref type:', r_desc.dtype, 'shape:', r_desc.shape)

# 测试匹配
bf = cv2.BFMatcher(cv2.NORM_L2)
matches = bf.knnMatch(q_desc.astype(np.float32), r_desc.astype(np.float32), k=2)
print('matches:', len(matches))
