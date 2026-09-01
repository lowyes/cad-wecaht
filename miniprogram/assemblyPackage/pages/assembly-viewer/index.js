const config = require('../../config/assembly_0001');

const ACTIONS = {
  install: {
    method: 'playInstall',
    pendingLabel: '正在安装',
    doneLabel: '装配完整',
    mode: 'complete',
    hint: 'SolidWorks 爆炸轨道已反向播放至装配位',
  },
  explode: {
    method: 'playExplode',
    pendingLabel: '正在拆卸',
    doneLabel: '爆炸视图',
    mode: 'exploded',
    hint: '58 个零件节点已按 SolidWorks 预设轨道展开',
  },
  section: {
    method: 'playSection',
    pendingLabel: '正在切换分层',
    doneLabel: '中段分层',
    mode: 'section',
    hint: '已停在爆炸动画中段，便于观察内部关系',
  },
  complete: {
    method: 'showComplete',
    pendingLabel: '正在恢复',
    doneLabel: '完整视图',
    mode: 'complete',
    hint: '装配体已回到 SolidWorks 初始状态',
  },
};

Page({
  data: {
    viewWidth: 375,
    viewHeight: 667,
    renderWidth: 375,
    renderHeight: 667,
    loading: true,
    ready: false,
    busy: false,
    progress: 8,
    loadingText: '正在创建 XR-FRAME 场景…',
    activeMode: 'complete',
    activeAction: 'complete',
    stateLabel: '正在加载装配体',
    stateHint: '准备 SolidWorks 减速器与爆炸动画',
    assemblyLabel: config.label,
    animatedNodeCount: config.animatedNodeCount,
    durationSeconds: config.durationMs / 1000,
  },

  onLoad(options = {}) {
    if (options.assemblyId && options.assemblyId !== config.id) {
      wx.showToast({ title: '该装配体尚未配置爆炸图', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const viewWidth = Math.max(1, Math.round(Number(info.windowWidth) || 375));
    const viewHeight = Math.max(1, Math.round(Number(info.windowHeight) || 667));
    const pixelRatio = Math.max(1, Number(info.pixelRatio) || 1);
    this.setData({
      viewWidth,
      viewHeight,
      renderWidth: Math.round(viewWidth * pixelRatio),
      renderHeight: Math.round(viewHeight * pixelRatio),
    });
  },

  onUnload() {
    this.pendingAction = null;
  },

  handleSceneReady() {
    this.setData({
      progress: Math.max(this.data.progress, 22),
      loadingText: '场景已建立，正在加载约 1.7MB 装配资源…',
    });
  },

  handleAssetsProgress({ detail = {} }) {
    const raw = Number(detail.progress);
    if (!Number.isFinite(raw)) return;
    const percent = raw <= 1 ? raw * 100 : raw;
    this.setData({
      progress: Math.max(this.data.progress, Math.round(22 + percent * 0.7)),
      loadingText: `正在加载装配资源 ${Math.min(Math.round(percent), 100)}%`,
    });
  },

  handleModelReady({ detail = {} }) {
    this.setData({
      loadingText: `已解析动画“${detail.clipName || config.clipName}”`,
      progress: 97,
    });
  },

  handleAssetsLoaded() {
    setTimeout(() => {
      this.setData({
        loading: false,
        ready: true,
        progress: 100,
        stateLabel: '完整视图',
        stateHint: '点击“拆卸”播放 SolidWorks 原始爆炸动画',
      });
    }, 280);
  },

  handleModelError({ detail = {} }) {
    this.setData({
      loading: false,
      ready: false,
      busy: false,
      stateLabel: '模型加载失败',
      stateHint: detail.message || '请重新进入页面后再试',
    });
    wx.showToast({ title: detail.message || '模型加载失败', icon: 'none' });
  },

  handleModeTap(event) {
    if (!this.data.ready || this.data.busy) return;
    const actionName = event.currentTarget.dataset.action;
    const action = ACTIONS[actionName];
    const scene = this.selectComponent('#assemblyScene');
    if (!action || !scene || typeof scene[action.method] !== 'function') return;
    this.pendingAction = action;
    this.pendingActionName = actionName;
    this.setData({
      busy: true,
      stateLabel: action.pendingLabel,
      stateHint: '动画处理中，请稍候…',
    });
    if (scene[action.method]() === false) {
      this.pendingAction = null;
      this.pendingActionName = null;
      this.setData({ busy: false });
    }
  },

  handleAnimationStart() {},

  handleAnimationEnd({ detail = {} }) {
    const action = this.pendingAction;
    const actionName = this.pendingActionName;
    this.pendingAction = null;
    this.pendingActionName = null;
    if (!action) return;
    this.setData({
      busy: false,
      activeMode: detail.mode || action.mode,
      activeAction: actionName,
      stateLabel: action.doneLabel,
      stateHint: action.hint,
    });
  },

  goBack() {
    wx.navigateBack({
      fail: () => wx.reLaunch({ url: '/pages/ar-viewer/ar-viewer' }),
    });
  },
});
