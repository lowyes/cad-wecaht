# part_0001 旋转识别测试集

这些图片由当前活动参考图 `part_0001_ar_target_candidate.png` 进行确定性二维旋转生成，
角度为 `-45°、-30°、-15°、15°、30°、45°`。

用途：在真机上依次展示或打印这些图片，测试**同一张正式参考图**对旋转目标的识别能力。

这些文件不属于运行时 Marker 数据库，不能直接追加为多个 `xr-ar-tracker`。XR-FRAME 的
Marker 会返回目标旋转后的姿态；把同一目标的旋转副本重复入库可能造成 tracker 竞争、
重复模型和锚点方向不一致。官方示例 FAQ 也提示，不同 tracker 会互相干扰，数量大于
6 个时识别效果会明显减弱。

测试方法：

1. 保持小程序配置仍指向 `part_0001_ar_target_candidate.png`。
2. 在另一块屏幕全屏显示一张旋转测试图，或按原比例打印。
3. 每个角度进行 10 次冷启动扫描，记录成功次数和首次识别耗时。
4. 识别后轻微移动手机，记录 30 秒内目标丢失次数。
5. 不要把 Windows 任务栏、图片查看器边框等内容截入正式参考图。

重新生成：

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\generate_marker_rotation_tests.ps1 `
  -InputPath .\miniprogram\assets\markers\part_0001_ar_target_candidate.png `
  -OutputDirectory .\experiments\ar_target_quality\rotation_tests
```
