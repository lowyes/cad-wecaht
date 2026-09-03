const assert = require('assert');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const projectConfig = JSON.parse(
  fs.readFileSync(path.join(projectRoot, 'project.config.json'), 'utf8'),
);
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
assert.strictEqual(
  projectConfig.libVersion,
  '3.17.2',
  '装配体运行时必须使用已验证的微信基础库 3.17.2',
);
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
assert.strictEqual(animationReport.animations[0].name, 'gltfAnimation');
assert.strictEqual(animationReport.animations[0].durationSec, 4);
assert.strictEqual(animationReport.animations[0].tracks.translation, 58);
assert.strictEqual(animationReport.animations[0].targetNodeCount, 58);
assert.deepStrictEqual(
  animationReport.extensions,
  [],
  '微信分包模型不应依赖量化、压缩或纹理变换扩展',
);

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
assert(solidworksComponent.includes('pauseToFrame'));
assert(solidworksComponent.includes('config.clipNames'));
assert(solidworksComponent.includes("animateToProgress(0, 'complete')"));
assert(solidworksComponent.includes("animateToProgress(1, 'exploded')"));
assert(!solidworksComponent.includes("direction: 'backwards'"));
const solidworksConfig = require(path.join(
  projectRoot,
  'miniprogram',
  'assemblyPackage',
  'config',
  'assembly_0001.js',
));
assert.deepStrictEqual(solidworksConfig.clipNames, [
  'gltfAnimation',
  'gltfAnimation#0',
]);
assert.strictEqual(solidworksConfig.interactivePartNames.length, 58);
assert.strictEqual(
  new Set(solidworksConfig.interactivePartNames).size,
  solidworksConfig.interactivePartNames.length,
);
assert(solidworksComponent.includes('getInternalNodeByName'));
assert(solidworksComponent.includes("model.getComponent('gltf')"));
assert(solidworksComponent.includes('findRuntimeElement(name)'));
assert(solidworksComponent.includes('getPrimitivesByNodeName'));
assert(solidworksComponent.includes('resolvePartBinding(name, xrFrameSystem)'));
assert(solidworksComponent.includes('xrFrameSystem.CubeShape'));
assert(solidworksComponent.includes("hitElement.event.add('drag-shape'"));
assert(solidworksComponent.includes('record.explodedPosition'));
assert(solidworksComponent.includes('setPartPosition(name, mode)'));
assert(solidworksComponent.includes('startRawPartDrag(record, event)'));
assert(solidworksComponent.includes("this.scene.event.add('touchmove'"));
assert(solidworksComponent.includes('applyPartDragDelta(record, deltaX, deltaY)'));
assert(solidworksComponent.includes("this.triggerEvent('interaction-ready'"));
assert(solidworksComponent.includes("this.triggerEvent('interaction-warning'"));
assert(
  solidworksComponent.indexOf("this.triggerEvent('assets-loaded')") <
    solidworksComponent.indexOf('this.prepareInteractiveParts(xrFrameSystem)'),
  '模型显示成功不应等待零件碰撞框初始化',
);
assert(!solidworksComponent.includes('ignoreError'));

const appConfig = JSON.parse(
  fs.readFileSync(path.join(projectRoot, 'miniprogram', 'app.json'), 'utf8'),
);
assert(
  appConfig.subPackages.some(
    (subpackage) => subpackage.root === 'assemblyPackage',
  ),
  'SolidWorks 装配页应放入独立分包',
);
const solidworksViewerSource = fs.readFileSync(
  path.join(
    projectRoot,
    'miniprogram',
    'assemblyPackage',
    'pages',
    'assembly-viewer',
    'index.js',
  ),
  'utf8',
);
assert(solidworksViewerSource.includes('startLoadWatchdog'));
assert(solidworksViewerSource.includes('retryLoad'));
assert(solidworksViewerSource.includes('handleInteractionReady'));
assert(solidworksViewerSource.includes('handleInteractionWarning'));
assert(solidworksViewerSource.includes('handleSelectedPartAction'));
assert(solidworksViewerSource.includes('detail.reason'));
assert(solidworksViewerSource.includes("buildLabel: 'R5 · 3.17.2'"));
const solidworksViewerTemplate = fs.readFileSync(
  path.join(
    projectRoot,
    'miniprogram',
    'assemblyPackage',
    'pages',
    'assembly-viewer',
    'index.wxml',
  ),
  'utf8',
);
assert(solidworksViewerTemplate.includes('bind:interaction-ready'));
assert(solidworksViewerTemplate.includes('bind:interaction-warning'));
assert(solidworksViewerTemplate.includes('bindchange="handlePartPickerChange"'));
assert(solidworksViewerTemplate.includes('data-mode="exploded"'));
assert(solidworksViewerTemplate.includes('data-mode="complete"'));
assert(solidworksViewerTemplate.includes('{{buildLabel}}'));

let componentDefinition = null;
const originalComponent = global.Component;
global.Component = (definition) => {
  componentDefinition = definition;
};
delete require.cache[require.resolve(
  path.join(
    projectRoot,
    'miniprogram',
    'assemblyPackage',
    'components',
    'solidworks-explosion-scene',
    'index.js',
  ),
)];
require(path.join(
  projectRoot,
  'miniprogram',
  'assemblyPackage',
  'components',
  'solidworks-explosion-scene',
  'index.js',
));
global.Component = originalComponent;

const sampledProgress = [];
const componentInstance = {
  ...componentDefinition.methods,
  ready: true,
  disposed: false,
  animator: {
    stop() {},
    play() {},
    pauseToFrame(name, progress) {
      if (name === 'gltfAnimation') sampledProgress.push(progress);
    },
  },
  triggerEvent() {},
};

// 部分真机 XR-FRAME 版本不暴露 getInternalNodeByName；此时必须能直接
// 从 getPrimitivesByNodeName 返回的渲染元素取得 Transform。
const primitiveTransform = { position: { x: 1, y: 2, z: 3 } };
const primitiveElement = {
  getComponent(componentClass) {
    return componentClass === 'Transform' ? primitiveTransform : null;
  },
};
componentInstance.gltfComponent = {
  getPrimitivesByNodeName(name) {
    return name === '测试零件' ? [{ el: primitiveElement }] : [];
  },
};
const primitiveBinding = componentInstance.resolvePartBinding('测试零件', {
  Transform: 'Transform',
});
assert(primitiveBinding, '缺少内部节点 API 时应从 Primitive 回退解析零件');
assert.strictEqual(primitiveBinding.element, primitiveElement);
assert.strictEqual(primitiveBinding.hitElement, primitiveElement);
assert.strictEqual(primitiveBinding.transform, primitiveTransform);

const normalizedEntry = {
  el: primitiveElement,
  hasMesh: true,
  meshes: [{ el: primitiveElement }],
};
componentInstance.gltfComponent = {
  _nodeMap: new Map([['29 挡油环-2', normalizedEntry]]),
  getInternalNodeByName(name) {
    const entry = this._nodeMap.get(name);
    return entry && entry.el;
  },
  getPrimitivesByNodeName(name) {
    const entry = this._nodeMap.get(name);
    return entry ? entry.meshes : [];
  },
};
const normalizedBinding = componentInstance.resolvePartBinding('29  挡油环-2', {
  Transform: 'Transform',
});
assert(normalizedBinding, '运行时折叠节点空格后仍应解析成功');
assert.strictEqual(normalizedBinding.transform, primitiveTransform);
assert(componentInstance.runtimeNodeDiagnostic().includes('runtime-map=1'));

// Android 真机远程调试可能暴露空 _nodeMap，但 GLTF 影子节点已经挂在
// _subRoots 中。此时必须直接按 Element.name 遍历，且不能调用会抛错的
// getInternalNodeByName()。
let unsafeLookupCalls = 0;
const treeTransform = { position: { x: 4, y: 5, z: 6 } };
const treeElement = {
  name: '28 滚动轴承60204-2',
  _children: [],
  getComponent(componentClass) {
    return componentClass === 'Transform' ? treeTransform : null;
  },
};
componentInstance.gltfComponent = {
  _nodeMap: new Map(),
  _subRoots: [treeElement],
  getInternalNodeByName() {
    unsafeLookupCalls += 1;
    throw new TypeError("Cannot read properties of undefined (reading 'el')");
  },
  getPrimitivesByNodeName() {
    return [];
  },
};
const treeBinding = componentInstance.resolvePartBinding('28 滚动轴承60204-2', {
  Transform: 'Transform',
});
assert(treeBinding, '空节点表时应从 GLTF 子树遍历解析零件');
assert.strictEqual(treeBinding.element, treeElement);
assert.strictEqual(treeBinding.transform, treeTransform);
assert.strictEqual(unsafeLookupCalls, 0, '节点表无匹配项时不得调用不安全内部 API');

const originalNow = Date.now;
const originalSetTimeout = global.setTimeout;
const originalClearTimeout = global.clearTimeout;
let fakeNow = 0;
Date.now = () => fakeNow;
global.setTimeout = (callback, delay = 0) => {
  fakeNow += Math.max(1, Number(delay) || 1);
  callback();
  return fakeNow;
};
global.clearTimeout = () => {};
try {
  componentInstance.initializeAnimationClips();
  sampledProgress.length = 0;
  assert.strictEqual(componentInstance.playExplode(), true);
  assert(Math.abs(sampledProgress.at(-1) - 1) < 1e-9);
  assert(sampledProgress.every((value, index) => index === 0 || value >= sampledProgress[index - 1]));
  sampledProgress.length = 0;
  assert.strictEqual(componentInstance.playInstall(), true);
  assert(Math.abs(sampledProgress.at(-1)) < 1e-9);
  assert(sampledProgress.every((value, index) => index === 0 || value <= sampledProgress[index - 1]));

  const partRecord = {
    name: '测试零件',
    transform: { position: { x: 0, y: 0, z: 0 } },
    basePosition: [0, 0, 0],
    explodedPosition: [0.2, 0.1, -0.05],
    isExploded: false,
    dragged: false,
    animationToken: 0,
  };
  componentInstance.togglePartPosition(partRecord);
  assert.strictEqual(partRecord.isExploded, true);
  assert(Math.abs(partRecord.transform.position.x - 0.2) < 1e-9);
  componentInstance.togglePartPosition(partRecord);
  assert.strictEqual(partRecord.isExploded, false);
  assert(Math.abs(partRecord.transform.position.x) < 1e-9);
  componentInstance.partRecords = [partRecord];
  assert.strictEqual(
    componentInstance.setPartPosition('测试零件', 'exploded'),
    true,
  );
  assert(Math.abs(partRecord.transform.position.x - 0.2) < 1e-9);
  assert.strictEqual(
    componentInstance.setPartPosition('测试零件', 'complete'),
    true,
  );
  assert(Math.abs(partRecord.transform.position.x) < 1e-9);

  const orbitState = { disabled: false };
  componentInstance.cameraOrbit = {
    disable() { orbitState.disabled = true; },
    enable() { orbitState.disabled = false; },
  };
  componentInstance.handlePartTouch(partRecord);
  assert.strictEqual(orbitState.disabled, true);
  componentInstance.handlePartDrag(partRecord, { deltaX: 10, deltaY: -5 });
  assert(partRecord.transform.position.x > 0);
  assert(partRecord.transform.position.y > 0);
  componentInstance.handlePartUntouch(partRecord);
  assert.strictEqual(orbitState.disabled, false);

  const sceneHandlers = new Map();
  componentInstance.scene = {
    event: {
      add(name, handler) { sceneHandlers.set(name, handler); },
      addOnce(name, handler) { sceneHandlers.set(name, handler); },
      remove(name, handler) {
        if (sceneHandlers.get(name) === handler) sceneHandlers.delete(name);
      },
    },
  };
  partRecord.transform.position.x = 0;
  partRecord.transform.position.y = 0;
  partRecord.dragged = false;
  componentInstance.handlePartTouch(partRecord, { x: 10, y: 20 });
  assert.strictEqual(componentInstance.rawPartDragActive, true);
  assert.strictEqual(typeof sceneHandlers.get('touchmove'), 'function');
  sceneHandlers.get('touchmove')({
    touches: [{ pageX: 25, pageY: 12 }],
  });
  assert(partRecord.transform.position.x > 0, '原始 touchmove 应横向移动零件');
  assert(partRecord.transform.position.y > 0, '原始 touchmove 应纵向移动零件');
  sceneHandlers.get('touchend')({ changedTouches: [{ pageX: 25, pageY: 12 }] });
  assert.strictEqual(componentInstance.rawPartDragActive, false);
  assert.strictEqual(sceneHandlers.has('touchmove'), false);
} finally {
  Date.now = originalNow;
  global.setTimeout = originalSetTimeout;
  global.clearTimeout = originalClearTimeout;
}
const arViewerSource = fs.readFileSync(
  path.join(projectRoot, 'miniprogram', 'pages', 'ar-viewer', 'ar-viewer.js'),
  'utf8',
);
assert(arViewerSource.includes('/assemblyPackage/pages/assembly-viewer/index'));

console.log('PASS 装配图目标、SolidWorks GLB、58轨爆炸动画、分包与高清渲染均有效');
