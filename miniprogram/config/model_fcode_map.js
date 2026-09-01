/**
 * 本地 AR 目标、GLB 模型与迪威 fcode 配置。
 *
 * 本文件由“AR 数据集管理器”维护，也可由开发人员手动编辑。
 * targetType=part：识别后在目标图上显示本地 GLB。
 * targetType=assembly：只识别装配图，不在 AR 中叠加模型，随后跳转爆炸图页面。
 */

const MODEL_FCODE_MAP = {
  'part_0001': "nmyexuvyxzjzrkdh",
  'part_0002': "zb2by690tbik3gri",
  'part_0003': "q2ytdw4as9aqnjej",
};

const AR_TARGETS = [
  {
    modelId: "part_0001",
    label: "零件 0001",
    targetType: "part",
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
    label: "零件 0002",
    targetType: "part",
    markerSrc: "/assets/markers/part_0002_ar_target.png",
    modelSrc: "/assets/models/part_0002/model_plain.glb",
    modelAssetId: "part-0002-model",
    hasModel: true,
    placeholderColor: "0.12 0.72 0.58 1",
  },
  {
    modelId: "part_0003",
    label: "零件 0003",
    targetType: "part",
    markerSrc: "/assets/markers/part_0003_ar_target.png",
    modelSrc: "/assets/models/part_0003/model_plain.glb",
    modelAssetId: "part-0003-model",
    hasModel: true,
    placeholderColor: "0.62 0.38 0.92 1",
  },
  {
    modelId: "assembly_demo_0001",
    label: "减速器装配体（演示目标图）",
    targetType: "assembly",
    assemblyId: "assembly_demo_0001",
    markerSrc: "/assets/markers/assembly_demo_0001_target.png",
    hasModel: false,
  },
];

function getFcodeByModelId(modelId) {
  if (!modelId) return null;
  return MODEL_FCODE_MAP[modelId] || null;
}

function getTargetByModelId(modelId) {
  if (!modelId) return null;
  return AR_TARGETS.find((target) => target.modelId === modelId) || null;
}

module.exports = {
  AR_TARGETS,
  MODEL_FCODE_MAP,
  getFcodeByModelId,
  getTargetByModelId,
};
