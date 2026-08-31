# 固定工程图匹配实验模块

该目录用于独立评估固定工程图匹配算法，不会被微信小程序加载，也不会修改当前
XR-FRAME Marker 识别链路。

## 对比方案

1. `ALIKED + LightGlue + USAC_MAGSAC`：现代深度局部特征匹配方案。
2. `SIFT + Lowe ratio + USAC_MAGSAC`：纯 OpenCV 工程基线。

两种方案最终都使用内点数量、内点比例、空间覆盖率、重投影误差和 Top-1 领先差进行
拒识，不会仅凭匹配点数量直接返回结果。

## 环境

本机已验证 `conda` 的 `math` 环境可用：PyTorch 2.5.1、CUDA 12.1、OpenCV 5.0.0。
LightGlue 被单独安装到本目录 `.deps/`，不会写入主项目依赖。

```powershell
cd D:\developer_work\Demo_project\experiments\drawing_matcher
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

## 运行

完整对比：

```powershell
conda run -n math python run_benchmark.py --method both --device auto
```

只运行纯 OpenCV 基线：

```powershell
conda run -n math python run_benchmark.py --method sift
```

只运行 ALIKED/LightGlue：

```powershell
conda run -n math python run_benchmark.py --method aliked --device cuda
```

默认测试集由3张现有 Marker 自动生成原图、旋转、透视、模糊、暗光、裁剪和模拟手机
照片，并增加空白、随机噪声、未入库线稿以及项目中两张未入库工程图作为拒识样本。JSON 报告输出到
`reports/latest.json`。

本机实测结果和当前建议见 [RESULTS.md](RESULTS.md)。

## 边界

- 这是离线实验，不是小程序运行时代码。
- 自动增强数据只能用于初筛，最终结论必须加入真实手机拍摄样本。
- 阈值只根据当前3张参考图开始设置，增加新图后必须重新跑完整矩阵。
- 首次运行深度方案会下载约 2.7 MB 的 ALIKED 权重和约 45 MB 的 LightGlue 权重；
  后续从 PyTorch 本地缓存加载。
