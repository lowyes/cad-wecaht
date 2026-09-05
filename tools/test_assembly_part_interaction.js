'use strict';

const assert = require('assert');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const componentPath = path.join(
  projectRoot,
  'miniprogram',
  'assemblyPackage',
  'components',
  'solidworks-explosion-scene',
  'index.js',
);

function createEventHub() {
  const listeners = new Map();
  return {
    add(name, handler) {
      const handlers = listeners.get(name) || [];
      handlers.push(handler);
      listeners.set(name, handlers);
    },
    addOnce(name, handler) {
      const wrapper = (event) => {
        this.remove(name, wrapper);
        handler(event);
      };
      this.add(name, wrapper);
    },
    remove(name, handler) {
      const handlers = listeners.get(name) || [];
      listeners.set(name, handlers.filter((item) => item !== handler));
    },
    trigger(name, event = {}) {
      for (const handler of [...(listeners.get(name) || [])]) handler(event);
    },
    count(name) {
      return (listeners.get(name) || []).length;
    },
  };
}

function componentClass(type) {
  function MockComponent() {}
  MockComponent.TYPE = type;
  return MockComponent;
}

async function main() {
  let definition = null;
  const originalComponent = global.Component;
  global.Component = (value) => {
    definition = value;
  };
  delete require.cache[require.resolve(componentPath)];
  require(componentPath);
  global.Component = originalComponent;

  assert(definition && definition.methods, '未能加载爆炸图组件');

  const Transform = componentClass('transform');
  const Mesh = componentClass('mesh');
  const CubeShape = componentClass('cube-shape');
  const ShapeInteract = componentClass('shape-interact');
  const CameraOrbitControl = componentClass('camera-orbit-control');
  const Camera = componentClass('camera');
  const xrFrameSystem = {
    Transform,
    Mesh,
    CubeShape,
    ShapeInteract,
    CameraOrbitControl,
    Camera,
  };

  const installedComponents = new Map();
  installedComponents.set('mesh', { type: 'mesh' });
  const hitEvents = createEventHub();
  const hitElement = {
    event: hitEvents,
    getComponent(component) {
      const type = typeof component === 'string' ? component : component.TYPE;
      return installedComponents.get(type) || null;
    },
    addComponent(ComponentClass, data) {
      const value = { type: ComponentClass.TYPE, data: { ...data } };
      installedComponents.set(ComponentClass.TYPE, value);
      return value;
    },
  };

  const transform = {
    position: { x: 0, y: 0, z: 0 },
    worldPosition: { x: 0, y: 0, z: 0 },
    worldScale: { x: 1, y: 1, z: 1 },
  };
  const partElement = {
    getComponent(component) {
      const type = typeof component === 'string' ? component : component.TYPE;
      return type === 'transform' ? transform : null;
    },
  };
  hitElement._parent = partElement;

  const sceneEvents = createEventHub();
  const orbitState = { locked: false };
  const cameraOrbit = {
    disable() { orbitState.locked = true; },
    enable() { orbitState.locked = false; },
  };
  const cameraTransform = {
    worldPosition: { x: 0, y: 0, z: 3 },
    // 模拟 XR-FRAME 真机横轴反向、纵轴正常的相机基向量；组件配置应
    // 只校正横向，避免把原本正确的上下拖动也反转。
    worldRight: { x: -1, y: 0, z: 0 },
    worldUp: { x: 0, y: 1, z: 0 },
  };
  const cameraElement = {
    getComponent(component) {
      const type = typeof component === 'string' ? component : component.TYPE;
      if (type === 'camera-orbit-control') return cameraOrbit;
      if (type === 'transform') return cameraTransform;
      if (type === 'camera') return { fov: 60 };
      return null;
    },
  };

  const emitted = [];
  const instance = {
    ...definition.methods,
    ready: true,
    disposed: false,
    animating: false,
    interactionFailureReason: '',
    scene: {
      width: 375,
      height: 667,
      event: sceneEvents,
      getElementById(id) {
        return id === 'camera' ? cameraElement : null;
      },
    },
    animator: {
      pauseToFrame(name, progress) {
        if (name === 'gltfAnimation') transform.position.x = progress * 2;
      },
    },
    triggerEvent(name, detail) {
      emitted.push({ name, detail });
    },
    async waitForPoseUpdate() {},
  };

  const record = {
    name: '模拟零件',
    element: partElement,
    transform,
    hitElement,
    basePosition: null,
    explodedPosition: null,
    isExploded: false,
    dragged: false,
    eventsBound: false,
    animationToken: 0,
  };
  instance.resolvePartRecords = async () => [record];

  const readyCount = await instance.prepareInteractiveParts(xrFrameSystem);
  assert.strictEqual(readyCount, 1, '模拟零件应完成交互初始化');
  assert(installedComponents.has('shape-interact'), '必须安装 ShapeInteract');
  assert(installedComponents.has('cube-shape'), '必须安装 CubeShape');
  assert.strictEqual(record.basePosition[0], 0, '应记录装配位');
  assert.strictEqual(record.explodedPosition[0], 2, '应记录拆卸位');
  assert.strictEqual(hitEvents.count('touch-shape'), 1, '应绑定点击事件');
  assert.strictEqual(hitEvents.count('drag-shape'), 1, '应绑定拖动事件');
  assert.strictEqual(hitEvents.count('untouch-shape'), 1, '应绑定抬起事件');

  const secondaryComponents = new Map([['mesh', { type: 'mesh' }]]);
  const secondaryEvents = createEventHub();
  const secondaryHitElement = {
    event: secondaryEvents,
    getComponent(component) {
      const type = typeof component === 'string' ? component : component.TYPE;
      return secondaryComponents.get(type) || null;
    },
    addComponent(ComponentClass, data) {
      const value = { type: ComponentClass.TYPE, data: { ...data } };
      secondaryComponents.set(ComponentClass.TYPE, value);
      return value;
    },
  };
  record.hitElements = [hitElement, secondaryHitElement];
  assert.strictEqual(
    instance.installPartInteraction(record, xrFrameSystem),
    null,
    '多 Primitive 零件的每个表面都应安装交互',
  );
  assert(secondaryComponents.has('shape-interact'));
  assert(secondaryComponents.has('cube-shape'));
  assert.strictEqual(secondaryEvents.count('touch-shape'), 1);
  assert.strictEqual(record.eventBindings.length, 2);

  const rollbackComponents = new Map([['mesh', { type: 'mesh' }]]);
  const rollbackEvents = createEventHub();
  const rollbackHitElement = {
    event: rollbackEvents,
    getComponent(component) {
      const type = typeof component === 'string' ? component : component.TYPE;
      return rollbackComponents.get(type) || null;
    },
    addComponent(ComponentClass, data) {
      const value = { type: ComponentClass.TYPE, data: { ...data } };
      rollbackComponents.set(ComponentClass.TYPE, value);
      return value;
    },
  };
  const rollbackRecord = {
    ...record,
    name: '部分失败零件',
    hitElements: [rollbackHitElement, {}],
    eventBindings: [],
    eventsBound: false,
  };
  const partialFailure = instance.installPartInteraction(
    rollbackRecord,
    xrFrameSystem,
  );
  assert.strictEqual(partialFailure.stage, 'event');
  assert.strictEqual(
    rollbackEvents.count('touch-shape'),
    0,
    '多表面初始化中途失败时必须回滚已经绑定的监听',
  );

  const emitPhysicsEvent = (name, event) => {
    assert(
      installedComponents.has('shape-interact') &&
        installedComponents.has('cube-shape'),
      '物理射线只应命中同时具备 ShapeInteract 和 Shape 的元素',
    );
    hitEvents.trigger(name, event);
  };

  emitPhysicsEvent('touch-shape', { x: 100, y: 120 });
  assert.strictEqual(orbitState.locked, true, '拖动零件时应锁定相机');
  assert.strictEqual(sceneEvents.count('touchmove'), 1, '应接管原始触摸移动');
  sceneEvents.trigger('touchmove', {
    changedTouches: [{ x: 132, y: 104 }],
  });
  assert(transform.position.x > 0, '横向拖动应改变零件 X 坐标');
  assert(transform.position.y > 0, '向上拖动应改变零件 Y 坐标');
  const afterRawMove = { ...transform.position };
  emitPhysicsEvent('drag-shape', { x: 132, y: 104, deltaX: 32, deltaY: -16 });
  assert.deepStrictEqual(
    transform.position,
    afterRawMove,
    '同一触点的 raw touchmove 与 drag-shape 不得重复应用位移',
  );
  sceneEvents.trigger('touchend', {
    changedTouches: [{ x: 132, y: 104 }],
  });
  assert.strictEqual(orbitState.locked, false, '拖动结束后应恢复相机');
  assert.strictEqual(instance.activePart, null, '拖动结束后应释放活动零件');

  emitPhysicsEvent('touch-shape', { x: 80, y: 90 });
  assert.strictEqual(sceneEvents.count('touchmove'), 1);
  instance.cancelAllPartAnimations();
  assert.strictEqual(sceneEvents.count('touchmove'), 0, '取消动画应释放原始拖动监听');
  assert.strictEqual(sceneEvents.count('touchend'), 0, '取消动画应释放触摸结束监听');
  assert.strictEqual(orbitState.locked, false, '取消拖动应恢复相机');
  assert.strictEqual(instance.activePart, null, '取消拖动应释放活动零件');

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
    record.dragged = false;
    emitPhysicsEvent('touch-shape', { x: 150, y: 150 });
    emitPhysicsEvent('untouch-shape', { x: 150, y: 150 });
    assert.strictEqual(record.isExploded, true, '轻点零件应切换到拆卸位');
    assert(Math.abs(transform.position.x - 2) < 1e-6, '零件应到达拆卸位');

    assert.strictEqual(
      instance.setPartPosition('模拟零件', 'complete'),
      true,
      '指定零件回装操作应成功',
    );
    assert(Math.abs(transform.position.x) < 1e-6, '零件应返回装配位');
    assert.strictEqual(
      instance.setPartPosition('模拟零件', 'invalid-mode'),
      false,
      '未知的单件操作模式必须被拒绝',
    );
    assert.strictEqual(
      instance.setPartPosition('模拟零件', 'complete'),
      true,
      '已在目标位时也应立即返回成功',
    );
  } finally {
    Date.now = originalNow;
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }

  assert(
    emitted.some(
      ({ name, detail }) => name === 'part-selected' && detail.action === 'dragged',
    ),
    '应发出零件已拖动状态',
  );
  assert(
    emitted.some(
      ({ name, detail }) => name === 'part-selected' && detail.action === 'exploded',
    ),
    '应发出零件已拆卸状态',
  );

  instance.releasePartEventBindings();
  assert.strictEqual(hitEvents.count('touch-shape'), 0, '释放时应解绑点击监听');
  assert.strictEqual(hitEvents.count('drag-shape'), 0, '释放时应解绑拖动监听');
  assert.strictEqual(hitEvents.count('untouch-shape'), 0, '释放时应解绑抬起监听');
  assert.strictEqual(secondaryEvents.count('touch-shape'), 0, '应解绑次级表面点击监听');

  console.log('PASS 模拟射线点击、拖动、单件拆卸和单件回装全部成功');
  console.log('  装配位:', record.basePosition.join(', '));
  console.log('  拆卸位:', record.explodedPosition.join(', '));
  console.log('  交互组件: ShapeInteract + CubeShape');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
