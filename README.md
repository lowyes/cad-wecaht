# 工程制图辅助学习小程序 - 后端

基于 FastAPI + OpenCV 的工程制图图像识别服务，支持通过图片匹配 3D 模型。

## 项目简介

本项目是一个工程制图辅助学习系统的后端服务，主要功能：

1. 接收用户上传的工程制图图片
2. 使用 OpenCV ORB 特征提取算法分析图像
3. 与本地模型库中的参考图进行特征匹配
4. 返回匹配的 3D 模型（glTF 格式）信息

## 目录结构

```
backend/
├── app.py                      # FastAPI 主程序
├── requirements.txt            # Python 依赖
├── README.md                   # 项目说明
├── data/
│   ├── manifest.json           # 模型清单配置
│   ├── ref_images/             # 参考图片（标准库）
│   │   └── part_0001.png       # 清晰标准工程图，用于建特征库
│   ├── test_images/            # 测试图片（用户上传）
│   │   └── scan_test_01.jpg    # 模糊扫描图，用于测试识别
│   ├── features/               # 特征文件（自动生成）
│   │   └── part_0001.npz       # 测试零件特征
│   └── models/                 # 3D 模型文件
│       └── part_0001/
│           ├── test2.gltf      # 模型文件
│           └── data.bin        # 模型二进制数据
├── services/                   # 服务模块
│   ├── __init__.py
│   ├── image_preprocess.py     # 图像预处理
│   ├── feature_extract.py      # 特征提取
│   ├── matcher.py              # 图像匹配
│   └── model_service.py        # 模型服务
└── scripts/
    └── build_feature_index.py  # 特征索引构建脚本
```

### 关键区别

- **`ref_images/part_0001.png`** — 标准库图，类似答案库，用于提前提取特征
- **`test_images/scan_test_01.jpg`** — 用户上传的扫描图，类似考试题，用于测试识别
- **`models/part_0001/`** — 3D 模型文件，`test2.gltf` 和 `data.bin` 必须在同一目录

## 快速开始

### 1. 安装依赖

```bash
pip install -r requirements.txt
```

### 2. 准备数据文件

确保以下文件已放置到正确位置：

- **参考图片**：`data/ref_images/part_0001.png`
  - 这是测试零件的参考工程制图图片

- **3D 模型文件**：
  - `data/models/part_0001/test2.gltf`
  - `data/models/part_0001/data.bin`
  - 这两个文件必须放在同一目录下

### 3. 生成特征索引

```bash
python scripts/build_feature_index.py
```

运行成功后会输出：
```
Built feature index for part_0001
```

这会在 `data/features/` 目录下生成 `part_0001.npz` 特征文件。

### 4. 启动后端服务

```bash
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

### 5. 测试接口

启动后可以访问以下地址测试：

- **健康检查**：http://127.0.0.1:8000/api/health
- **模型列表**：http://127.0.0.1:8000/api/models
- **API 文档**：http://127.0.0.1:8000/docs

### 6. 测试图像识别

将你的模糊扫描图放到 `data/test_images/` 目录下，然后使用 curl 测试：

```bash
# 用测试图片测试识别
curl -X POST -F "file=@data/test_images/scan_test_01.jpg" http://127.0.0.1:8000/api/recognize

# 用标准参考图测试（应该匹配成功）
curl -X POST -F "file=@data/ref_images/part_0001.png" http://127.0.0.1:8000/api/recognize
```

如果返回 `"matched": true`，说明识别成功，可以返回对应的 3D 模型地址。

## 接口说明

### 1. 健康检查

```http
GET /api/health
```

返回：
```json
{
  "success": true,
  "message": "backend is running"
}
```

### 2. 模型列表

```http
GET /api/models
```

返回：
```json
{
  "success": true,
  "count": 1,
  "models": [
    {
      "model_id": "part_0001",
      "name": "测试零件",
      "category": "基础零件",
      "gltf_url": "http://127.0.0.1:8000/static/models/part_0001/test2.gltf"
    }
  ]
}
```

### 3. 图像识别

```http
POST /api/recognize
Content-Type: multipart/form-data
```

请求参数：
- `file`：工程制图图片文件

返回（匹配成功）：
```json
{
  "success": true,
  "matched": true,
  "top1": {
    "model_id": "part_0001",
    "name": "测试零件",
    "category": "基础零件",
    "confidence": 0.86,
    "model_format": "gltf",
    "gltf_url": "http://127.0.0.1:8000/static/models/part_0001/test2.gltf",
    "bin_file": "http://127.0.0.1:8000/static/models/part_0001/data.bin"
  },
  "candidates": [
    {
      "model_id": "part_0001",
      "name": "测试零件",
      "confidence": 0.86
    }
  ]
}
```

返回（匹配失败）：
```json
{
  "success": true,
  "matched": false,
  "top1": null,
  "candidates": [
    {
      "model_id": "part_0001",
      "name": "测试零件",
      "confidence": 0.32
    }
  ],
  "message": "未找到高置信度匹配结果"
}
```

## 小程序端调用指南

### 加载模型列表

```javascript
// 获取可用模型列表
const res = await wx.request({
  url: 'http://127.0.0.1:8000/api/models',
  method: 'GET'
});
```

### 识别图片并加载模型

```javascript
// 1. 上传图片进行识别
const res = await wx.uploadFile({
  url: 'http://127.0.0.1:8000/api/recognize',
  filePath: imagePath,
  name: 'file'
});

const result = JSON.parse(res.data);

// 2. 如果匹配成功，加载 3D 模型
if (result.matched && result.top1) {
  const gltfUrl = result.top1.gltf_url;
  // 使用小程序 3D 渲染库加载 gltf 模型
}
```

## 技术说明

### 特征提取

使用 OpenCV ORB（Oriented FAST and Rotated BRIEF）算法：
- 提取 1500 个特征点
- 8 层金字塔
- 1.2 缩放因子

### 匹配算法

1. 对用户上传图片提取 ORB 特征
2. 使用 BFMatcher（汉明距离）进行特征匹配
3. 应用 Lowe's ratio test（阈值 0.75）过滤误匹配
4. 根据 good matches 数量计算置信度

### 置信度计算

```python
confidence = min(len(good_matches) / len(query_descriptors) * 3.0, 1.0)
```

当前单模型匹配阈值：0.45（后续扩充模型库后可提高到 0.70）

## 扩展指南

### 添加新模型

1. 准备参考图片，放入 `data/ref_images/` 目录
2. 准备 glTF 模型文件，放入 `data/models/<model_id>/` 目录
3. 在 `data/manifest.json` 中添加新模型信息
4. 运行 `python scripts/build_feature_index.py` 生成特征文件
5. 重启后端服务

### manifest.json 格式

```json
{
  "model_id": "part_0002",
  "name": "新零件名称",
  "category": "分类",
  "ref_image": "data/ref_images/part_0002.png",
  "feature_file": "data/features/part_0002.npz",
  "model_format": "gltf",
  "gltf_url": "/static/models/part_0002/model.gltf",
  "bin_file": "/static/models/part_0002/data.bin"
}
```

## 常见问题

### Q: 启动时报错"特征文件不存在"

A: 请先运行 `python scripts/build_feature_index.py` 生成特征文件。

### Q: 识别准确率不高

A: 可以尝试：
- 使用更清晰的参考图片
- 调整 `services/matcher.py` 中的 Lowe's ratio test 阈值
- 增加参考图片数量

### Q: 如何添加更多模型？

A: 参考"扩展指南"部分，添加新的模型数据并更新 manifest.json。

## 测试 Harness

### 生成测试图片

```bash
python harness/generate_test_images.py
```

从标准参考图自动生成模糊、旋转、低质量、变暗、裁剪等测试图片，输出到 `data/test_images/generated/`。

### 运行完整后端自检

```bash
python harness/run_harness.py
```

无需手动启动 uvicorn，harness 会通过 FastAPI TestClient 直接测试接口。

### Harness 检查内容

* 模型库文件是否完整
* glTF 是否正确引用 data.bin
* manifest 配置是否正确
* OpenCV 是否能读取参考图
* 特征索引是否能生成
* `/api/health` 是否正常
* `/api/models` 是否返回 part_0001
* 静态 3D 模型文件是否可访问
* `/api/recognize` 是否能识别标准参考图

### 运行顺序（完整流程）

```bash
pip install -r requirements.txt
python scripts/build_feature_index.py
python harness/generate_test_images.py
python harness/run_harness.py
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

## 技术栈

- Python 3.10+
- FastAPI
- OpenCV (opencv-python-headless)
- NumPy
- Uvicorn

## License

MIT
