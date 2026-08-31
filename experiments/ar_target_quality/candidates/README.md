# AR 目标图候选目录

这里统一保存尚未完成真机验收的 Marker 候选图，不会被小程序自动加载。

| 零件 | 候选文件 | 状态 |
| --- | --- | --- |
| part_0001 | `part_0001_ar_target_candidate.png` | 当前已有一份副本在运行资源目录中启用 |
| part_0002 | `part_0002_ar_target_cropped_candidate.png` | 待真机 A/B 测试 |
| part_0003 | `part_0003_ar_target_cropped_candidate.png` | 待真机 A/B 测试 |

目录约定：

- `experiments/ar_target_quality/candidates/`：候选参考图的统一归档位置。
- `experiments/ar_target_quality/rotation_tests/`：旋转、透视等测试输入，不可当作正式参考图批量入库。
- `miniprogram/assets/markers/`：小程序实际加载的正式/当前活动 Marker，只放运行必需文件。

候选图通过真机测试后，再复制到 `miniprogram/assets/markers/` 并修改
`miniprogram/config/model_fcode_map.js`。替换前必须保留原图并运行 `node tools/verify_local_ar.js`。
