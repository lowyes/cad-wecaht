# CAD 本地 AR 识图

这是一个纯微信小程序前端的二维目标图识别与 AR 三维模型展示项目。

## 当前功能

- 使用 XR-FRAME Marker 在手机本地识别二维目标图。
- 连续跟踪目标图并叠加对应的 GLB 三维模型。
- 支持单指旋转、双指缩放以及按钮控制。
- 识别成功后可跳转到迪威三维模型小程序。
- 不上传照片，不调用图像识别后端，也不依赖 GLM/VLM。

## 运行

使用微信开发者工具直接导入项目根目录即可。打开后默认进入
`pages/ar-viewer/ar-viewer`，不需要启动任何后端服务。

本地目标图位于 `miniprogram/assets/markers/`，对应 GLB 位于
`miniprogram/assets/models/`。

## 自检

```powershell
node tools/verify_local_ar.js
```

## 可视化数据集管理

老师可以双击项目根目录中的 `启动AR数据集管理器.bat`，在浏览器界面中添加、
编辑或删除目标图、GLB 模型和迪威 fcode。每次修改前会自动备份当前目标库，
备份保存在项目根目录的 `dataset_backups/`，不会进入小程序包。

添加完成并通过“一键完整校验”后，仍需使用微信开发者工具重新编译和发布小程序。
