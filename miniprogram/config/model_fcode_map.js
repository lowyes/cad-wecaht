/**
 * 本地 AR 目标、GLB 模型与迪威 fcode 配置。
 *
 * 本文件由“AR 数据集管理器”维护，也可由开发人员手动编辑。
 * 当前目标数量：3
 */

const MODEL_FCODE_MAP = {
  'part_0001': "nmyexuvyxzjzrkdh",
  'part_0002': "zb2by690tbik3gri",
  'part_0003': "q2ytdw4as9aqnjej",
};

const AR_TARGETS = [
  {
    modelId: "part_0001",
    markerSrc: "/assets/markers/part_0001_ar_target_candidate.png",
    originalMarkerSrc: "/assets/markers/part_0001_ar_target.png",
    markerVariant: "candidate-v1",
    modelSrc: "/assets/models/part_0001/model_plain.glb",
    modelAssetId: "part-0001-model",
    hasModel: true,
    placeholderColor: "0.95 0.36 0.055 1",
  },
  {
    modelId: "part_0002",
    markerSrc: "/assets/markers/part_0002_ar_target.png",
    modelSrc: "/assets/models/part_0002/model_plain.glb",
    modelAssetId: "part-0002-model",
    hasModel: true,
    placeholderColor: "0.12 0.72 0.58 1",
  },
  {
    modelId: "part_0003",
    markerSrc: "/assets/markers/part_0003_ar_target.png",
    modelSrc: "/assets/models/part_0003/model_plain.glb",
    modelAssetId: "part-0003-model",
    hasModel: true,
    placeholderColor: "0.62 0.38 0.92 1",
  },
];

function getFcodeByModelId(modelId) {
  if (!modelId) return null;
  return MODEL_FCODE_MAP[modelId] || null;
}

module.exports = {
  AR_TARGETS,
  MODEL_FCODE_MAP,
  getFcodeByModelId,
};
