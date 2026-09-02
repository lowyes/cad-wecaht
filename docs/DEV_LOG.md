# Development Log

## 2026-08-04 20:10:39 +08:00 — AR 跟踪稳定性第一阶段

- Agent/tool used: Codex、Node.js、项目本地 AR 自检。
- Change scope: 为 XR-FRAME Marker 跟踪增加应用层防抖、生命周期恢复、启动故障出口和单模型降级隔离。
- Files changed:
  - `miniprogram/utils/tracking_stabilizer.js`：新增独立状态机；命中持续 250ms 后确认，丢失保留 800ms，锁定当前目标，并在当前目标真正丢失后切换至已确认的备用目标。
  - `miniprogram/pages/ar-viewer/ar-viewer.js`：接入稳定状态机；忽略未知目标；页面隐藏时释放 AR 运行状态，返回时重新挂载；增加 12 秒慢启动提示和 25 秒终止超时；渲染像素比上限从 3 降为 2。
  - `miniprogram/components/ar-marker-scene/index.js`、`index.wxml`：记录每个模型的可用状态，单个 GLB 解析失败时仅将对应目标降级为定位方块。
  - `tools/test_tracking_stabilizer.js`、`tools/verify_local_ar.js`：增加防抖、短暂丢失、重复丢失事件、目标锁定、备用目标切换、定时器释放和稳定性接线检查。
- Reason for change: 原实现直接把每次 `ar-tracker-switch` 映射到界面状态，轻微抖动或单帧遮挡会造成模型闪现、立即丢失或多目标来回切换；页面从其他小程序返回后也没有明确的相机重建策略。
- Verification commands run:
  - `node tools/test_tracking_stabilizer.js`。
  - `node tools/verify_local_ar.js`。
  - `node --check`（全部 `miniprogram/` 与 `tools/` JavaScript）。
  - PowerShell `ConvertFrom-Json`（全部小程序 JSON）。
  - 使用模拟 `Page`/`Component` 加载页面和组件，确认生命周期及逐模型状态可初始化。
  - `git diff --check`。
- Result: PASS。6 个跟踪稳定性场景全部通过；完整 Marker、GLB、迪威映射和运行时依赖自检通过；JS/JSON 语法通过；页面及组件模拟加载通过。
- Known risks: XR-FRAME 的相机姿态和实际 Marker 识别仍由微信客户端提供，桌面测试只能验证应用层状态变化，无法替代真机对模型抖动、暗光、反光和不同手机性能的验证。250ms/800ms 是保守初值，应根据真机丢失频率调整。
- Next suggested step: 在安卓低端机、安卓高端机和 iPhone 上分别测试每个目标 10 次，记录首次锁定耗时、每分钟丢失次数、错误切换次数和从迪威返回后的恢复成功率；之后再加入 Marker 相似度入库门禁。

## 2026-07-25 21:40:00 +08:00 — UI v2 深空玻璃设计系统

- Agent/tool used: WorkBuddy, Node.js。
- Change scope: 纯视觉重构，零 JS 逻辑改动。ar-viewer 页面从深蓝科技风 v1 升级为
  「深空玻璃」设计系统 v2。
- Files changed:
  - `miniprogram/pages/ar-viewer/ar-viewer.wxss`：全部重写。统一色板
    （深空底 #030610 / 青 #22D3EE / 蓝 #3B82F6 / 紫 #8B5CF6）、玻璃拟态材质、
    渐变 CTA 呼吸光晕、状态胶囊识别成功变青光、扫描框四角脉冲 + 激光线、
    启动页元素入场依次上浮（fadeUp 分级延迟）。
  - `miniprogram/pages/ar-viewer/ar-viewer.wxml`：启动页视觉重排
    （品牌 → 标题 → 扫描动画 → 数据卡 → CTA → 底部隐私小注）；新增
    brand-badge、intro-footnote、scan-laser 装饰元素；状态卡加状态类绑定；
    按钮加 hover-class 按压反馈。JS 事件绑定全部保持不变。
  - `miniprogram/app.wxss` / `app.json`：全局底色同步为 #030610。
  - 新增 `docs/ui-preview.html`：四屏浏览器预览（启动/加载/扫描/识别成功）。
- Reason for change: 提升参赛作品视觉完成度，为真机演示和比赛答辩做准备。
- Verification commands run:
  - `node tools/verify_local_ar.js`（103 项 PASS，0 FAIL）。
- Result: PASS。已知限制不变：XR-FRAME 相机识别需真机验证；
  cover-view 加载页的渐变/动画在真机会降级为纯色，属预期。
- Codex 复核修正：
  - 微信开发者工具实际编译时启动页近乎全黑，原因是 WXSS 使用了兼容性不稳定的
    `inset` 简写；已全部改为明确的 `top/right/bottom/left` 定位。
  - 扫描提示曾被视觉稿覆盖回“四角定位码”，已恢复为
    “请将完整的原始工程图放入取景框”，与当前无定位码目标库保持一致。
- Next suggested step: 开发者工具编译确认样式无警告 → 手机扫码实测 →
  按真机观感微调间距与字号。

## 2026-07-25 18:03:36 +08:00 — Pure local AR cleanup

- Agent/tool used: Codex, PowerShell, Node.js, 微信开发者工具。
- Change scope: 将项目从“后端图片识别 + GLM/VLM + 多套旧页面”收敛为纯前端本地
  XR-FRAME Marker 识别与 AR 模型展示。
- Files changed:
  - 保留并优化 `miniprogram/pages/ar-viewer/`、
    `miniprogram/components/ar-marker-scene/`、3 张目标图与 3 个 GLB。
  - 在 `miniprogram/config/model_fcode_map.js` 集中维护 AR 目标和迪威映射；
    新增 `miniprogram/config/diwei.js` 和 `tools/verify_local_ar.js`。
  - 更新 `miniprogram/app.*`、`project.config.json`、`README.md`、`.gitignore`。
  - 移除 `backend/`、旧上传识图 API、裁剪/识别结果/模型列表页面、旧独立
    Three.js 查看器、云函数示例、npm/Rollup 构建依赖和后端启动脚本。
- Reason for change: 旧服务会引入网络等待、GLM 调用成本和维护负担，而当前业务只需要
  预生成目标图、手机本地识别、连续跟踪和 GLB 叠加。
- Safety backup:
  - `D:\developer_work\Demo_project_backups\pre_ar_cleanup_20260725_175232.zip`
  - SHA-256:
    `9AE66B37AAD125E1D81493C190F0EB41BB7146DA757160EF0889F8798EF0234C`
- Verification commands run:
  - `node tools/verify_local_ar.js`
  - `node --check`（全部小程序 JS 与自检脚本）
  - PowerShell `ConvertFrom-Json`（项目使用的全部 JSON 配置）
  - `git diff --check`

  - 微信开发者工具重新编译并检查当前页面及问题面板。
- Result: PASS with one device-only limitation.
  - 应用只注册 `pages/ar-viewer/ar-viewer`。
  - 小程序运行目录共 21 个文件、85,242 bytes（约 0.081 MB）。
  - 旧 `BASE_URL`、`/api/recognize`、`wx.uploadFile`、GLM/VLM 和
    `three-platformize` 运行时引用为 0。
  - 3 张目标图均已改为用户提供的原始电子工程图（不含人工定位码），分辨率分别为
    1080×774、936×1066、838×1244；3 个模型均为有效 glTF 2.0 GLB；
    3 个零件均有迪威 fcode。
  - 微信开发者工具显示当前页为 `pages/ar-viewer/ar-viewer`，问题数为 0。
- Known risks:
  - XR-FRAME Marker 相机识别无法在桌面模拟器中完成，最终识别、跟踪稳定性和迪威跳转
    仍需在手机预览验证。
  - 微信开发者工具 CLI 预览因本机 CLI 服务端口未启用而超时；已停止遗留 CLI 进程，
    不影响开发者工具中的手动编译。
- Retest correction:
  - 二次编译发现微信懒加载没有打包新建的独立 `config/ar_targets.js`，运行时报
    `module is not defined`。
  - 已将 AR 目标清单合并到开发者工具已稳定加载的
    `config/model_fcode_map.js`，并重新执行自检与开发者工具编译。
  - 桌面 XR-FRAME 对动态循环创建 `xr-asset-load` 出现内部模型解析错误，因此 GLB
    资源声明恢复为已经过手机验证的静态三项；跟踪器仍从统一目标清单批量生成。
  - 0002/0003 原 GLB 强制依赖 `KHR_draco_mesh_compression`，而 XR-FRAME 未提供
    Decoder；已解码为普通 glTF 2.0 GLB，并移除三个模型中无实际灯光数据的
    `KHR_lights_punctual` 声明。三个转换结果均通过 glTF-Transform validate。
  - 组件 WXSS 的 `xr-scene` 标签选择器已改为 `.scene` 类选择器，消除组件样式警告。
  - 最终微信开发者工具预览成功：代码分析成功、上传成功，预览包约 97 KB，
    二维码已生成。桌面模拟器仅保留 XR-FRAME 明确说明的
    `ar-system is only supported in wx-mini-program` 限制，需手机验证相机跟踪。
  - AR 不再在页面打开时立即挂载：新增独立欢迎启动页，展示扫描动画、目标数量、
    零后端请求、GLB 模型与隐私提示；用户点击“开启 AR 扫描”后才创建 XR 场景。
    加载阶段增加三阶段进度、慢启动提示与重新启动入口，避免无说明黑屏。
- Next suggested step: 手机扫码测试 0001/0002/0003；确认稳定后提交并推送新的纯 AR
  版本，再开始批量扩展目标图与模型清单。

## 2026-08-04：固定工程图深度匹配独立实验

- 在 `experiments/drawing_matcher/` 新建隔离测试模块，未接入或修改当前小程序
  XR-FRAME Marker 主链路。
- 实现两套可对照流水线：
  - `SIFT + Lowe ratio + OpenCV USAC_MAGSAC`。
  - `ALIKED + LightGlue + OpenCV USAC_MAGSAC`。
- 两套方案统一使用内点数、内点比例、空间覆盖率、重投影误差和 Top-1 领先差进行
  最终接受或拒识。
- LightGlue 固定到官方提交
  `eb42fee2d71449efb0aa5c10549752b5d75384d8`；Kornia 固定为 0.7.4，
  Kornia-RS 固定为 0.1.14，均安装到实验目录 `.deps/`。
- `math` 环境验证通过：PyTorch 2.5.1+cu121、CUDA 可用、RTX 3050 Laptop GPU、
  OpenCV 5.0.0。
- 测试矩阵包含24个增强正样本和5个拒识样本，其中2个拒识样本来自项目已有的
  未入库工程图。
- 同进程对照结果：
  - SIFT + MAGSAC++：29/29，平均 185.3 ms，P95 251.3 ms。
  - ALIKED + LightGlue + MAGSAC++：29/29，平均 243.5 ms，P95 314.5 ms。
- 结论：当前3张清晰参考图下，深度方案没有速度或准确率优势；建议先保留 SIFT
  作为快速层，收集真实手机困难样本后再决定是否将深度方案作为低置信度复核层。
- Verification commands run:
  - `powershell -ExecutionPolicy Bypass -File experiments/drawing_matcher/setup.ps1`
  - `python run_benchmark.py --method both --device cuda`
  - `python -m py_compile matcher.py test_cases.py run_benchmark.py`
- 已知限制：当前正样本主要来自确定性图像增强，不等价于真实手机拍摄；模型首次使用
  需下载约 48 MB 权重。

## 2026-07-25：离线数据集管理器

- 新增 Windows 双击启动的本地可视化管理器，支持目标清单、新增、编辑、删除、
  PNG/GLB 校验、迪威 fcode 和一键完整自检。
- 每次数据变更前自动备份目标图、模型与配置；服务仅监听 `127.0.0.1`，
  不上传工程图或模型。
- 已使用临时 `part_9999` 完成新增、编辑、完整校验、删除的端到端测试；
  测试目标已移除，目标库恢复为 3 项。

## 2026-08-05：本地 AR 真机稳定性优化

- 保持 XR-FRAME Marker 主架构、3张正式目标图和3个 GLB 不变。
- 跟踪稳定器调整：首次确认 250→200 ms，短暂丢失宽限 800→1000 ms；新增
  2.5秒快速重捕获窗口，窗口内重新出现仅需 100 ms 确认。
- 启动资源进度按至少5%变化更新，旋转/缩放手势按32 ms合并更新，减少高频
  `setData` 对 JS 与渲染层的压力。
- 增加纯本地 `[AR performance]` 与 `[AR tracking]` 控制台日志，记录场景、资源、
  相机、首次跟踪和稳定切换的相对时间，不上传任何数据。
- 增加独立运行态标志，页面隐藏或卸载后忽略迟到的 XR 事件，避免旧场景竞态地重新
  创建跟踪状态。
- 新增 `tools/analyze_ar_targets.py` 和 `docs/AR_OPTIMIZATION_REPORT.md`，用于复测目标图
  线条占比、内容覆盖、SIFT 特征数量和空间分布。
- 静态分析结果：part_0002/0003 特征充足；part_0001 仅247个 SIFT 特征且线条占比
  约3.1%，需优先进行真机远距离、弱光和运动模糊测试。为避免改变锚点，正式目标图
  暂未自动裁剪或增强。
- 在 `experiments/ar_target_quality/` 生成 part_0001 独立候选图，特征点提升到1467、
  黑线占比提升到5.8%；因与旧原图的传统几何兼容验证未通过，未接入正式 Marker，
  仅供候选图成对入库/打印的真机 A/B 测试。
- 用户确认进行候选测试后，将候选图以新文件复制到小程序资源目录，并临时设为
  part_0001 活动 Marker；旧原图通过 `originalMarkerSrc` 保留，未覆盖或删除。
- Verification commands run:
  - `node --check miniprogram/pages/ar-viewer/ar-viewer.js`
  - `node --check miniprogram/utils/tracking_stabilizer.js`
  - `node tools/test_tracking_stabilizer.js`（8项 PASS）
  - `node tools/test_ar_viewer_runtime.js`（4项 PASS）
  - `python -m py_compile tools/analyze_ar_targets.py`
  - `python tools/analyze_ar_targets.py`
- 已知限制：XR-FRAME 相机识别、锚点抖动与真实重捕获耗时仍必须通过微信真机预览
  验证；桌面自动化只能验证状态机和资源完整性。

## 2026-09-01：零件 AR 与装配爆炸图分流 Demo

- 业务流程明确分为两类本地目标：
  - `part` 零件图：保持原 XR-FRAME Marker 跟踪，并在图上叠加对应 GLB。
  - `assembly` 装配图：只做本地识别，不在相机画面叠加模型；识别成功后显示
    “查看爆炸图”入口。
- 新增确定性生成的 `assembly_demo_0001` 装配工程图，不使用四角定位码；图中包含
  主视图、俯视图、零件序号、明细表和标题栏，以提供足够的自然局部特征。
- 为该装配图单独生成底座、支座、定位销三个独立 GLB，不再复用
  `part_0001/0002/0003` 模拟装配关系。
- 爆炸图页面支持安装、拆卸、剖面、完整四种状态以及拖动旋转、捏合缩放。
- 资源生成脚本：`tools/generate_assembly_demo_assets.js`；运行目标与原 AR 链路均保持
  纯前端、无上传、无后端。
- Verification commands run:
  - `node tools/test_assembly_demo.js`
  - `node tools/verify_local_ar.js`
  - `node tools/test_tracking_stabilizer.js`
  - `node tools/test_ar_viewer_runtime.js`

## 2026-09-01：GLB 动画轨道自动检查器

- 在离线“AR 数据集管理器”中增加装配动画检查面板，可直接拖入
  SolidWorks / Blender 导出的 GLB。
- 解析 glTF 2.0 `animations` / `channels` / `samplers` / `accessors`，输出
  每个片段的时长、位移/旋转/缩放/形变轨道数和受影响节点。
- 按动画名自动判定拆卸与安装轨道；仅有一条变换动画时，生成
  `reverse-explode` 安装建议，并支持复制或下载 JSON 配置。
- 检查仅访问本机 `127.0.0.1`，不改写也不上传 GLB。
- 同时修复数据集管理器对 `assembly` 目标无 `modelSrc` 时的兼容，避免
  装配目标导致清单接口失败。
- Verification commands run:
  - `node tools/test_glb_animation_inspector.js`
  - `node tools/verify_local_ar.js`
  - 本地 HTTP 回归：4 个目标可正常列出，无动画 GLB 正确报告 0 条轨道。
  - 浏览器 UI 实测：导入 GLB 后生成报告，无水平溢出且无控制台错误。

## 2026-09-01：装配爆炸图清晰度修复

- 根据真机 `pixelRatio` 计算 XR-FRAME 物理渲染尺寸，将 `renderWidth` /
  `renderHeight` 传给装配场景组件，避免默认低分辨率画布被全屏放大。
- 装配场景加入 XR-FRAME `fxaa` 后处理，对模型轮廓进行抗锯齿。
- 控制台输出实际视口、像素密度和渲染尺寸，便于真机诊断。
- Verification commands run:
  - `node --check miniprogram/pages/assembly-demo/assembly-demo.js`
  - `node tools/test_assembly_demo.js`
  - `node tools/verify_local_ar.js`

## 2026-09-01：接入 SolidWorks 真实减速器爆炸视图

- 接收并解析 SolidWorks 导出的多文件 glTF 资源包：71 个节点、59 个原始网格、
  46 个材质，以及动画片段 `爆炸视图1`。
- 原始爆炸动画总长 4 秒，包含 58 条位移轨道，覆盖 58 个具名装配节点；小程序中
  “拆卸”正向播放该轨道，“安装”反向播放该轨道。
- 新增 `tools/prepare_solidworks_gltf.js`：移除 XR-FRAME 无法直接使用的 DDS 法线贴图
  绑定、SolidWorks 查看器私有扩展和失去引用的纹理项，不改写源文件。
- 使用 gltfpack 保留节点名和动画，将约 44 MB 的多文件导出资源整理为
  `assemblyPackage/assets/assembly_0001.glb`（1,850,904 bytes）；优化后为
  35 个网格、63,681 个唯一三角面。
- 新增独立分包 `assemblyPackage`，分包总大小 1,868,676 bytes，避免真实装配体占用
  小程序主包；AR 识别装配图后的按钮现跳转到该真实爆炸视图页面。
- 真实模型只有一条爆炸动画，没有独立剖切轨道，因此第三个按钮明确显示为“分层”，
  通过停在动画 52% 位置观察内部结构，不冒充真实剖面。
- 新增 `tools/generate_solidworks_assembly_target.py`，直接读取优化后的真实 GLB，
  确定性生成正视、俯视、右视、等轴测和主要零部件表，不使用 AI 猜测结构，也不
  虚构制造尺寸。输出为 2200×1600 PNG，无四角定位码。
- 新生成的 `assembly_0001_solidworks_target_candidate.png` 已作为装配识别候选图启用；
  原 `assembly_demo_0001_target.png` 通过 `originalMarkerSrc` 保留，可随时回退。
- 候选图虽然依据真实 GLB 几何生成，但仍不等同于 SolidWorks 出图模板中的正式制造
  图纸；上线前必须打印或全屏显示同一张 PNG 完成微信真机识别测试。
- Verification commands run:
  - `node tools/test_assembly_demo.js`
  - `node tools/test_glb_animation_inspector.js`
  - `node tools/verify_local_ar.js`
  - `git diff --check`

### 真机加载超时修复

- 首版 1.70 MB 模型使用 `KHR_mesh_quantization` 和 `KHR_texture_transform`；静态 glTF
  检查能通过，但真机 XR-FRAME 一直停留在加载态，判断为运行时扩展兼容问题。
- 重新从清理后的 SolidWorks glTF 生成无扩展 GLB：使用浮点顶点、不使用 Draco、
  Meshopt、量化或纹理变换扩展，保留同一条 4 秒、58 节点爆炸动画。
- 新 GLB 为 1,850,904 bytes、35 个网格、63,681 个唯一三角面；整个分包仍低于
  2 MB。
- 移除会吞掉解析错误的 `ignoreError` 选项；增加 18 秒加载看门狗和“重新加载装配体”
  按钮，后续即使资源异常也不会永久停在加载动画。

### 爆炸按钮无动作修复

- SolidWorks 源动画名称为中文 `爆炸视图1`，但 XR-FRAME 官方 glTF 动画控制示例使用
  运行时片段键 `gltfAnimation`；片段键不匹配时 `Animator.play()` 不抛出可见错误，
  页面按钮会进入播放状态但模型保持不动。
- `prepare_solidworks_gltf.js` 现保留原名称到动画 `extras.sourceAnimationName`，同时将
  第一条动画的运行时名称固定为 `gltfAnimation`；页面显示仍使用“爆炸视图1”。
- 重新生成无扩展 GLB，并校验 `gltfAnimation` 仍为 4 秒、58 条位移轨道。

### 安装与拆卸方向修复

- 部分微信真机运行时没有按 `Animator.play({ direction: 'backwards' })` 反向执行 glTF，
  导致“安装”和“拆卸”看起来都在播放原始正向爆炸轨道。
- 改为确定性的进度驱动：拆卸将轨道从当前进度插值到 1，安装将当前进度插值回 0；
  每 32 ms 使用 `pauseToFrame()` 写入进度，不再依赖运行时倒放实现。
- 动画时间按剩余距离计算，并加入 ease-in-out 缓动；“分层”同样平滑移动到 52%。

### 零件级点击定位与拖动

- 使用 XR-FRAME 官方 `GLTF.getInternalNodeByName()` 获取 SolidWorks 动画涉及的 58 个
  内部零件节点，不再要求把装配体人工拆成 58 个 GLB。
- 初始化时分别采集动画 0% 的装配位和 100% 的拆卸位；轻点任意零件会在两处之间
  独立缓动，其他零件保持不动。
- 为各零件的内部 Mesh 节点动态添加自动适配的 `CubeShape`，支持 `touch-shape`、
  `drag-shape` 和 `untouch-shape`；按住拖动时只修改所选零件的局部 Transform。
- 拖动零件期间暂时禁用相机 OrbitControl，松手后恢复；点击空白区域仍可旋转视角，
  双指仍可缩放。

### 模型加载与零件交互解耦

- 修复零件碰撞框初始化异常被统一误报为“模型加载失败”的问题：GLB 与动画解析完成后
  立即进入可用状态，零件交互改为随后异步初始化。
- 每个零件只为首个 Mesh 创建一个自动适配的 `CubeShape`，并且每处理 5 个零件让出
  一帧，降低 58 个碰撞框集中创建导致的真机卡顿和超时风险。
- 内部节点解析、碰撞框创建和事件绑定均按零件隔离错误；单个零件失败只会跳过该零件，
  不再影响模型显示和安装、拆卸、分层、完整四种动画操作。
- 新增 `interaction-ready` / `interaction-warning` 状态事件，页面可独立显示实际支持拖动
  的零件数量；交互不可用时仍保留完整爆炸动画能力。
- Verification commands run:
  - `node tools/test_assembly_demo.js`
  - `node tools/test_glb_animation_inspector.js`
  - `node tools/verify_local_ar.js`
  - `git diff --check`

### 指定零件单独拆装

- 爆炸图控制区新增“指定零件”选择器，列表来自 GLB 中实际解析成功且已建立碰撞框的
  节点，不展示不可交互的空节点。
- 选择零件后可执行“单件拆卸”或“单件安装”：仅该零件沿 SolidWorks 动画记录的
  装配位与拆卸位移动，其余零件保持当前位置。
- 直接点击三维模型中的零件时，页面选择器会同步到对应节点；既可以在模型上点选，
  也可以用名称准确定位螺栓、轴承、齿轮、端盖等零件。
- 单件动画与全部安装/拆卸共用同一套节点状态，执行全局操作前会安全取消正在运行的
  单件动画。
- Verification commands run:
  - `node tools/test_assembly_demo.js`
  - `node tools/test_glb_animation_inspector.js`
  - `node tools/verify_local_ar.js`
  - `git diff --check`

### SolidWorks 零件碰撞框节点修复

- 离线检查确认真实 GLB 的 58 个动画目标节点全部在节点自身引用 Mesh，且没有 Mesh
  子节点；此前只遍历后代会漏掉全部零件节点。
- 改用 XR-FRAME `GLTF.getPrimitivesByNodeName()` 官方接口，按 glTF Node 名称取得
  实例化后的 Primitive，并在 Primitive 所属 Element 上创建 `CubeShape` 与拖动事件。
- 保留根元素 Mesh 检查和递归搜索作为旧基础库兼容回退。

### 真机零件拖动事件兜底

- XR-FRAME 碰撞框仍负责确定被选中的具体零件；选中后同时监听场景原始
  `touchmove` / `touchend`，避免部分真机只有 `touch-shape`、没有持续派发
  `drag-shape` 时出现“能点中但拖不动”。
- 原始手势接管期间忽略合成 `drag-shape`，防止同一位移被重复应用；松手、切换全局
  动画和页面销毁时都会移除临时监听。

### 真机零件节点解析兼容

- 不再强制依赖部分 XR-FRAME 运行时缺失的 `GLTF.getInternalNodeByName()`。
- 优先使用内部节点；接口缺失或查找失败时，从
  `GLTF.getPrimitivesByNodeName()` 返回的真实渲染元素取得 Transform 和碰撞目标。
- 缓存解析到的 Primitive Element，碰撞体绑定阶段不再重复查询节点。
- 增加运行时 `_nodeMap` 兼容回退，并忽略连续空格、全半角等名称差异；Transform
  同时支持类引用与字符串组件名获取。若仍失败，页面会显示运行时节点数和样例名，
  便于直接定位设备基础库差异。
