import cv2
import numpy as np


def crop_non_white_border(gray: np.ndarray, margin: int = 10) -> np.ndarray:
    """
    裁掉测试图外部大白边和阴影区域。
    对模糊拍照图很重要。
    """
    mask = gray < 245
    coords = cv2.findNonZero(mask.astype(np.uint8))

    if coords is None:
        return gray

    x, y, w, h = cv2.boundingRect(coords)

    x1 = max(0, x - margin)
    y1 = max(0, y - margin)
    x2 = min(gray.shape[1], x + w + margin)
    y2 = min(gray.shape[0], y + h + margin)

    return gray[y1:y2, x1:x2]


def rotate_bound(gray: np.ndarray, angle: float) -> np.ndarray:
    """
    旋转图像，同时保持完整内容不被裁切。
    """
    h, w = gray.shape[:2]
    center = (w / 2, h / 2)

    matrix = cv2.getRotationMatrix2D(center, angle, 1.0)

    cos = abs(matrix[0, 0])
    sin = abs(matrix[0, 1])

    new_w = int((h * sin) + (w * cos))
    new_h = int((h * cos) + (w * sin))

    matrix[0, 2] += (new_w / 2) - center[0]
    matrix[1, 2] += (new_h / 2) - center[1]

    rotated = cv2.warpAffine(
        gray,
        matrix,
        (new_w, new_h),
        flags=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=255
    )

    return rotated


def estimate_skew_angle(gray: np.ndarray) -> float:
    """
    使用 HoughLinesP 估计工程图的整体倾斜角。
    主要利用图中的水平线和竖直线。
    """
    edges = cv2.Canny(gray, 50, 150)

    lines = cv2.HoughLinesP(
        edges,
        rho=1,
        theta=np.pi / 180,
        threshold=80,
        minLineLength=max(30, min(gray.shape[:2]) // 8),
        maxLineGap=10
    )

    if lines is None:
        return 0.0

    angles = []

    for line in lines:
        x1, y1, x2, y2 = line[0]

        dx = x2 - x1
        dy = y2 - y1

        if dx == 0 and dy == 0:
            continue

        angle = np.degrees(np.arctan2(dy, dx))

        # 归一化到 [-90, 90]
        if angle < -90:
            angle += 180
        if angle > 90:
            angle -= 180

        # 只取接近水平线的角度
        # 工程图里水平线最多，通常最稳
        if -30 <= angle <= 30:
            angles.append(angle)

    if not angles:
        return 0.0

    # 用中位数，比平均数抗干扰
    return float(np.median(angles))


def deskew_engineering_drawing(gray: np.ndarray, max_angle: float = 15.0) -> np.ndarray:
    """
    自动矫正轻微倾斜的工程图。
    """
    angle = estimate_skew_angle(gray)

    # 避免误判导致大幅旋转
    if abs(angle) < 0.5:
        return gray

    if abs(angle) > max_angle:
        return gray

    # 如果图像顺时针倾斜 angle，需要旋转 -angle 矫正
    # Hough line angles describe the current dominant line tilt in image
    # coordinates. Rotating by the same signed angle brings horizontal
    # engineering drawing lines back toward 0 degrees.
    corrected = rotate_bound(gray, angle)

    return corrected


def detect_document_corners(gray: np.ndarray) -> np.ndarray | None:
    """
    检测工程图纸张的四个角点。
    使用轮廓检测找到最大的四边形。

    Returns:
        四个角点的坐标数组 [[x1,y1], [x2,y2], [x3,y3], [x4,y4]] 或 None
    """
    # 二值化
    _, binary = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY_INV)

    # 形态学操作，连接断开的边缘
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)

    # 查找轮廓
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    if not contours:
        return None

    # 找到最大的轮廓
    largest_contour = max(contours, key=cv2.contourArea)

    # 轮廓面积必须足够大
    area = cv2.contourArea(largest_contour)
    img_area = gray.shape[0] * gray.shape[1]
    if area < img_area * 0.3:  # 至少占图像面积的30%
        return None

    # 多边形逼近
    epsilon = 0.02 * cv2.arcLength(largest_contour, True)
    approx = cv2.approxPolyDP(largest_contour, epsilon, True)

    # 只保留四边形
    if len(approx) != 4:
        return None

    # 获取四个角点
    corners = approx.reshape(4, 2)

    # 按顺序排列角点：左上、右上、右下、左下
    # 按 y 坐标排序
    sorted_by_y = corners[corners[:, 1].argsort()]

    # 上半部分两个点按 x 排序
    top_two = sorted_by_y[:2]
    top_two = top_two[top_two[:, 0].argsort()]

    # 下半部分两个点按 x 排序
    bottom_two = sorted_by_y[2:]
    bottom_two = bottom_two[bottom_two[:, 0].argsort()]

    # 组合成有序角点
    ordered_corners = np.array([
        top_two[0],      # 左上
        top_two[1],      # 右上
        bottom_two[1],   # 右下
        bottom_two[0],   # 左下
    ], dtype=np.float32)

    return ordered_corners


def correct_perspective(gray: np.ndarray, target_width: int = None, target_height: int = None) -> np.ndarray:
    """
    透视矫正：将梯形变形的工程图拉正成矩形。

    Args:
        gray: 输入灰度图
        target_width: 目标宽度（可选，自动计算）
        target_height: 目标高度（可选，自动计算）

    Returns:
        矫正后的图像
    """
    corners = detect_document_corners(gray)

    if corners is None:
        return gray

    # 计算目标尺寸
    if target_width is None or target_height is None:
        # 使用角点间的距离计算
        width_top = np.linalg.norm(corners[1] - corners[0])
        width_bottom = np.linalg.norm(corners[2] - corners[3])
        height_left = np.linalg.norm(corners[3] - corners[0])
        height_right = np.linalg.norm(corners[2] - corners[1])

        target_width = int(max(width_top, width_bottom))
        target_height = int(max(height_left, height_right))

    # 目标角点（矩形）
    dst_corners = np.array([
        [0, 0],
        [target_width - 1, 0],
        [target_width - 1, target_height - 1],
        [0, target_height - 1],
    ], dtype=np.float32)

    # 计算透视变换矩阵
    M = cv2.getPerspectiveTransform(corners, dst_corners)

    # 应用透视变换
    corrected = cv2.warpPerspective(
        gray,
        M,
        (target_width, target_height),
        flags=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=255
    )

    return corrected


def normalize_shadow(gray: np.ndarray) -> np.ndarray:
    """
    减弱拍照阴影和背景不均。
    """
    background = cv2.medianBlur(gray, 31)
    normalized = cv2.divide(gray, background, scale=255)
    return normalized


def sharpen(gray: np.ndarray) -> np.ndarray:
    """
    轻微锐化，增强工程图细线。
    """
    blur = cv2.GaussianBlur(gray, (0, 0), 1.0)
    sharp = cv2.addWeighted(gray, 1.5, blur, -0.5, 0)
    return sharp


def preprocess_for_sift(image_path: str, mode: str = "gray", save_debug: bool = False,
                        enable_deskew: bool = True, enable_perspective: bool = False) -> np.ndarray:
    """
    工程图预处理：裁边 -> 倾斜矫正 -> 透视矫正 -> 去阴影 -> CLAHE -> 锐化 -> 输出指定模式

    Args:
        image_path: 图片路径
        mode: 输出模式
            - "gray": 预处理后的灰度图
            - "otsu": Otsu二值化
            - "adaptive": 自适应二值化
            - "edge": Canny边缘
        save_debug: 是否保存调试图片到 data/debug/
        enable_deskew: 是否启用倾斜矫正（默认 True）
        enable_perspective: 是否启用透视矫正（默认 False，手机斜拍时启用）

    Returns:
        处理后的图像
    """
    img = cv2.imread(image_path)
    if img is None:
        raise ValueError(f"Cannot read image: {image_path}")

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # 1. 裁掉外部白边和阴影
    gray = crop_non_white_border(gray)

    # 保存矫正前的图片（用于调试）
    before_correction = gray.copy() if save_debug else None

    # 2. 轻微倾斜矫正（可选）
    if enable_deskew:
        gray = deskew_engineering_drawing(gray)

    # 3. 透视矫正（可选，处理手机斜拍的梯形变形）
    if enable_perspective:
        gray = correct_perspective(gray)

    # 4. 矫正后再次裁白边
    gray = crop_non_white_border(gray)

    # 保存调试图片
    if save_debug:
        from pathlib import Path
        debug_dir = Path("data/debug")
        debug_dir.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(debug_dir / "preprocess_before_correction.jpg"), before_correction)
        cv2.imwrite(str(debug_dir / "preprocess_after_correction.jpg"), gray)

    # 5. 控制尺寸
    h, w = gray.shape[:2]
    target_side = 1200
    scale = target_side / max(h, w)
    if scale > 1:
        gray = cv2.resize(
            gray,
            (int(w * scale), int(h * scale)),
            interpolation=cv2.INTER_CUBIC
        )
    elif scale < 1:
        gray = cv2.resize(
            gray,
            (int(w * scale), int(h * scale)),
            interpolation=cv2.INTER_AREA
        )

    # 5. 去阴影
    gray = normalize_shadow(gray)

    # 6. 局部对比度增强
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    gray = clahe.apply(gray)

    # 7. 轻微锐化，不要重度模糊
    gray = sharpen(gray)

    # 8. 输出指定模式

    if mode == "gray":
        return gray

    if mode == "otsu":
        _, binary = cv2.threshold(
            gray,
            0,
            255,
            cv2.THRESH_BINARY + cv2.THRESH_OTSU
        )
        return binary

    if mode == "adaptive":
        binary = cv2.adaptiveThreshold(
            gray,
            255,
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY,
            31,
            10
        )
        return binary

    if mode == "edge":
        return cv2.Canny(gray, 50, 150)

    return gray


def preprocess_image(image_path: str) -> np.ndarray:
    """
    兼容旧接口：返回预处理后的灰度图
    """
    return preprocess_for_sift(image_path, mode="gray")
