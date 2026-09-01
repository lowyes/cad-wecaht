const assert = require('assert');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const {
  ASSEMBLY_ID,
  ASSEMBLY_LAYOUTS,
  ASSEMBLY_PARTS,
} = require(path.join(projectRoot, 'miniprogram', 'config', 'assembly_demo'));
const {
  easeInOutCubic,
  interpolateVector,
  vectorToAttribute,
} = require(path.join(projectRoot, 'miniprogram', 'utils', 'assembly_animation'));
const {
  inspectGlbAnimation,
} = require('./dataset-manager/glb-animation-inspector');

assert.strictEqual(ASSEMBLY_ID, 'assembly_demo_0001');
assert.deepStrictEqual(
  ASSEMBLY_PARTS.map((part) => part.id),
  ['base', 'support', 'pin'],
  '装配体应包含底座、支座和定位销三个独立分件',
);
assert.deepStrictEqual(
  Object.keys(ASSEMBLY_LAYOUTS).sort(),
  ['complete', 'exploded', 'section'],
);

for (const part of ASSEMBLY_PARTS) {
  const modelPath = path.join(
    projectRoot,
    'miniprogram',
    part.modelSrc.replace(/^\//, ''),
  );
  assert(fs.existsSync(modelPath), `${part.id} 模型不存在`);
  for (const layout of Object.values(ASSEMBLY_LAYOUTS)) {
    assert(Array.isArray(layout[part.id]), `${part.id} 缺少布局坐标`);
    assert.strictEqual(layout[part.id].length, 3, `${part.id} 坐标必须为三维`);
  }
}

assert.strictEqual(easeInOutCubic(0), 0);
assert.strictEqual(easeInOutCubic(1), 1);
assert.deepStrictEqual(interpolateVector([0, 0, 0], [2, 4, 6], 0), [0, 0, 0]);
assert.deepStrictEqual(interpolateVector([0, 0, 0], [2, 4, 6], 1), [2, 4, 6]);
assert.strictEqual(vectorToAttribute([1, 2.34567, -0.5]), '1 2.3457 -0.5');

const sceneSource = fs.readFileSync(
  path.join(
    projectRoot,
    'miniprogram',
    'components',
    'assembly-explosion-scene',
    'index.js',
  ),
  'utf8',
);
assert(sceneSource.includes('playExplode'));
assert(sceneSource.includes('playInstall'));
assert(sceneSource.includes('playSection'));
assert(sceneSource.includes('showComplete'));

const sceneTemplate = fs.readFileSync(
  path.join(
    projectRoot,
    'miniprogram',
    'components',
    'assembly-explosion-scene',
    'index.wxml',
  ),
  'utf8',
);
assert(sceneTemplate.includes('type="fxaa"'), '装配场景应启用 FXAA 抗锯齿');
assert(
  sceneTemplate.includes('post-process="assembly-fxaa"'),
  '装配相机应绑定 FXAA 后处理',
);

const pageSource = fs.readFileSync(
  path.join(projectRoot, 'miniprogram', 'pages', 'assembly-demo', 'assembly-demo.js'),
  'utf8',
);
const pageTemplate = fs.readFileSync(
  path.join(projectRoot, 'miniprogram', 'pages', 'assembly-demo', 'assembly-demo.wxml'),
  'utf8',
);
assert(pageSource.includes('info.pixelRatio'), '装配页应读取真机像素密度');
assert(pageSource.includes('renderWidth'), '装配页应计算物理渲染宽度');
assert(pageTemplate.includes('width="{{renderWidth}}"'), '组件应接收物理渲染宽度');
assert(pageTemplate.includes('height="{{renderHeight}}"'), '组件应接收物理渲染高度');

const markerPath = path.join(
  projectRoot,
  'miniprogram',
  'assets',
  'markers',
  'assembly_demo_0001_target.png',
);
assert(fs.existsSync(markerPath), '装配工程目标图不存在');

const solidworksModelPath = path.join(
  projectRoot,
  'miniprogram',
  'assemblyPackage',
  'assets',
  'assembly_0001.glb',
);
assert(fs.existsSync(solidworksModelPath), 'SolidWorks 装配体 GLB 不存在');
const solidworksModel = fs.readFileSync(solidworksModelPath);
assert(
  solidworksModel.length < 2 * 1024 * 1024,
  'SolidWorks GLB 应控制在 2MB 分包限制内',
);
const animationReport = inspectGlbAnimation(solidworksModel, {
  fileName: 'assembly_0001.glb',
});
assert.strictEqual(animationReport.valid, true, 'SolidWorks GLB 应通过兼容性检查');
assert.strictEqual(animationReport.counts.animations, 1, '应保留一条爆炸动画');
assert.strictEqual(animationReport.animations[0].name, '爆炸视图1');
assert.strictEqual(animationReport.animations[0].durationSec, 4);
assert.strictEqual(animationReport.animations[0].tracks.translation, 58);
assert.strictEqual(animationReport.animations[0].targetNodeCount, 58);

const solidworksComponent = fs.readFileSync(
  path.join(
    projectRoot,
    'miniprogram',
    'assemblyPackage',
    'components',
    'solidworks-explosion-scene',
    'index.js',
  ),
  'utf8',
);
assert(solidworksComponent.includes("playAnimation('backwards'"));
assert(solidworksComponent.includes("playAnimation('forwards'"));
assert(solidworksComponent.includes('pauseToFrame'));

const appConfig = JSON.parse(
  fs.readFileSync(path.join(projectRoot, 'miniprogram', 'app.json'), 'utf8'),
);
assert(
  appConfig.subPackages.some(
    (subpackage) => subpackage.root === 'assemblyPackage',
  ),
  'SolidWorks 装配页应放入独立分包',
);
const arViewerSource = fs.readFileSync(
  path.join(projectRoot, 'miniprogram', 'pages', 'ar-viewer', 'ar-viewer.js'),
  'utf8',
);
assert(arViewerSource.includes('/assemblyPackage/pages/assembly-viewer/index'));

console.log('PASS 装配图目标、SolidWorks GLB、58轨爆炸动画、分包与高清渲染均有效');
