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

## 2026-07-25：离线数据集管理器

- 新增 Windows 双击启动的本地可视化管理器，支持目标清单、新增、编辑、删除、
  PNG/GLB 校验、迪威 fcode 和一键完整自检。
- 每次数据变更前自动备份目标图、模型与配置；服务仅监听 `127.0.0.1`，
  不上传工程图或模型。
- 已使用临时 `part_9999` 完成新增、编辑、完整校验、删除的端到端测试；
  测试目标已移除，目标库恢复为 3 项。
