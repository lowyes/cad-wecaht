'use strict';

const assert = require('assert');
const path = require('path');

const pagePath = path.resolve(
  __dirname,
  '..',
  'miniprogram',
  'assemblyPackage',
  'pages',
  'assembly-viewer',
  'index.js',
);

let definition = null;
const originalPage = global.Page;
const originalWx = global.wx;
const originalWarn = console.warn;
const toasts = [];
const warnings = [];
console.warn = (...values) => warnings.push(values);
global.Page = (value) => {
  definition = value;
};
global.wx = {
  showToast(value) { toasts.push(value); },
};
delete require.cache[require.resolve(pagePath)];
require(pagePath);
global.Page = originalPage;

function createPage(scene) {
  return {
    ...definition,
    data: {
      ...definition.data,
      ready: true,
      interactivePartCount: 1,
      partOptions: ['模拟零件'],
      selectedPartName: '模拟零件',
    },
    setData(patch) {
      Object.assign(this.data, patch);
    },
    selectComponent() {
      return scene;
    },
  };
}

let page = null;
const synchronousScene = {
  setPartPosition(name, mode) {
    page.handlePartSelected({ detail: { name, action: 'moving-out' } });
    page.handlePartSelected({ detail: { name, action: mode } });
    return true;
  },
};
page = createPage(synchronousScene);
page.handleSelectedPartAction({ currentTarget: { dataset: { mode: 'exploded' } } });
assert.strictEqual(
  page.data.partBusy,
  false,
  '同步完成事件不得被调用方再次覆盖成忙碌状态',
);
assert.strictEqual(page.data.stateLabel, '零件已到拆卸位');

page = createPage({ setPartPosition() { return false; } });
page.handleSelectedPartAction({ currentTarget: { dataset: { mode: 'complete' } } });
assert.strictEqual(page.data.partBusy, false, '组件拒绝操作后必须解除忙碌状态');
assert(toasts.some((item) => item.title === '该零件交互尚未就绪'));

let globalActionCalls = 0;
page = createPage({
  playExplode() {
    globalActionCalls += 1;
    return true;
  },
});
page.data.partBusy = true;
page.handleModeTap({ currentTarget: { dataset: { action: 'explode' } } });
assert.strictEqual(globalActionCalls, 0, '单件动画期间不得启动整体动画');

page = createPage({ playExplode() { throw new Error('mock global failure'); } });
page.handleModeTap({ currentTarget: { dataset: { action: 'explode' } } });
assert.strictEqual(page.data.busy, false, '整体动画异常后必须解除忙碌状态');
assert.strictEqual(page.pendingAction, null, '整体动画异常后必须清理待处理动作');

page.handleAssetsProgress({ detail: { progress: 200 } });
assert.strictEqual(page.data.progress, 92, '异常资源进度必须限制到 100% 再映射');
assert(page.data.loadingText.endsWith('100%'));

page = createPage({ setPartPosition() { throw new Error('mock failure'); } });
page.handleSelectedPartAction({ currentTarget: { dataset: { mode: 'complete' } } });
assert.strictEqual(page.data.partBusy, false, '单件操作异常后必须解除忙碌状态');
assert.strictEqual(warnings.length, 2, '两条模拟异常都应留下诊断日志');

global.wx = originalWx;
console.warn = originalWarn;
console.log('PASS 页面忙碌状态、同步完成、拒绝、异常与动画互斥均正确');
