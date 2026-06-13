import cv2
import numpy as np


def deserialize_keypoints(data: np.ndarray) -> list:
    """
    从序列化数据恢复 KeyPoint 对象

    Args:
        data: Nx7 数组，每行 [pt_x, pt_y, size, angle, response, octave, class_id]

    Returns:
        KeyPoint 列表
    """
    if data is None or len(data) == 0:
        return []

    keypoints = []
    for row in data:
        kp = cv2.KeyPoint(
            x=float(row[0]),
            y=float(row[1]),
            size=float(row[2]),
            angle=float(row[3]),
            response=float(row[4]),
            octave=int(row[5]),
            class_id=int(row[6])
        )
        keypoints.append(kp)
    return keypoints


def extract_sift_features(image: np.ndarray) -> tuple:
    """
    使用 SIFT 提取图像特征（对模糊、旋转、缩放更鲁棒）

    Args:
        image: 灰度图或二值图

    Returns:
        (keypoints, descriptors) 元组
    """
    sift = cv2.SIFT_create(
        nfeatures=2000,
        contrastThreshold=0.04,
        edgeThreshold=10
    )

    keypoints, descriptors = sift.detectAndCompute(image, None)

    if descriptors is None:
        return keypoints, np.array([], dtype=np.float32).reshape(0, 128)

    return keypoints, descriptors


def extract_orb_features(gray_image: np.ndarray) -> tuple:
    """
    使用 ORB 提取图像特征（兼容旧接口）

    Args:
        gray_image: 灰度图

    Returns:
        (keypoints, descriptors) 元组
    """
    orb = cv2.ORB_create(nfeatures=2000)
    keypoints, descriptors = orb.detectAndCompute(gray_image, None)

    if descriptors is None:
        descriptors = np.array([], dtype=np.float32).reshape(0, 32)

    return keypoints, descriptors