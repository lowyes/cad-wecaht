/**
 * 独立爆炸图数据。它不参与 AR 叠加，只在识别到对应装配图后进入查看页。
 * 三个 GLB 是为 assembly_demo_0001 单独生成的真实分件模型。
 */
const ASSEMBLY_ID = 'assembly_demo_0001';

const ASSEMBLY_PARTS = [
  {
    id: 'base',
    label: '底座',
    assetId: 'assembly-demo-base',
    modelSrc: '/assets/assemblies/assembly_demo_0001/base.glb',
    scale: 1,
    rotation: [0, 0, 0],
  },
  {
    id: 'support',
    label: '支座',
    assetId: 'assembly-demo-support',
    modelSrc: '/assets/assemblies/assembly_demo_0001/support.glb',
    scale: 1,
    rotation: [0, 0, 0],
  },
  {
    id: 'pin',
    label: '定位销',
    assetId: 'assembly-demo-pin',
    modelSrc: '/assets/assemblies/assembly_demo_0001/pin.glb',
    scale: 1,
    rotation: [0, 0, 0],
  },
];

const ASSEMBLY_LAYOUTS = {
  complete: {
    base: [0, -0.7, 0],
    support: [0, -0.19, 0],
    pin: [0, 0.53, 0],
  },
  exploded: {
    base: [-1.25, -0.78, -0.12],
    support: [0, -0.05, 0.08],
    pin: [1.25, 0.86, 0.22],
  },
  section: {
    base: [-0.9, -0.7, 0],
    support: [0, -0.19, 0],
    pin: [0.9, 0.53, 0],
  },
};

const ASSEMBLY_META = {
  id: ASSEMBLY_ID,
  label: '三零件装配示意图',
  drawingSrc: '/assets/markers/assembly_demo_0001_target.png',
  previewSrc: '/assets/assembly-previews/assembly_demo_0001.png',
};

module.exports = {
  ASSEMBLY_ID,
  ASSEMBLY_LAYOUTS,
  ASSEMBLY_META,
  ASSEMBLY_PARTS,
};
