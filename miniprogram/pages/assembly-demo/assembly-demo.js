const {
  ASSEMBLY_ID,
  ASSEMBLY_META,
} = require('../../config/assembly_demo');

const ACTIONS = {
  install: {
    method: 'playInstall',
    pendingLabel: '正在安装',
    doneLabel: '装配完整',
    mode: 'complete',
    hint: '零件已按装配顺序逐件归位',
  },
  explode: {
    method: 'playExplode',
    pendingLabel: '正在拆卸',
    doneLabel: '爆炸视图',
    mode: 'exploded',
    hint: '三个零件已沿预设路线依次展开',
  },
  section: {
    method: 'playSection',
    pendingLabel: '正在切换剖面',
    doneLabel: '剖面视图',
    mode: 'section',
    hint: '零件已横向分层，便于观察内部关系',
  },
  complete: {
    method: 'showComplete',
    pendingLabel: '正在恢复',
    doneLabel: '完整视图',
    mode: 'complete',
    hint: '装配体已恢复至初始完整状态',
  },
};

Page({
  data: {
    viewWidth: 375,
    viewHeight: 667,
    renderWidth: 375,
    renderHeight: 667,
    pixelRatio: 1,
    loading: true,
    ready: false,
    busy: false,
    progress: 8,
    loadedParts: 0,
    loadingText: '正在创建 XR-FRAME 场景…',
    activeMode: 'complete',
    activeAction: 'complete',
    stateLabel: '正在加载模型',
    stateHint: '准备底座、支座与定位销三个分件',
    assemblyLabel: ASSEMBLY_META.label,
  },

  onLoad(options = {}) {
    if (options.assemblyId && options.assemblyId !== ASSEMBLY_ID) {
      wx.showToast({ title: '该装配体尚未配置爆炸图', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const viewWidth = Math.max(1, Math.round(Number(info.windowWidth) || 375));
    const viewHeight = Math.max(1, Math.round(Number(info.windowHeight) || 667));
    const pixelRatio = Math.max(1, Number(info.pixelRatio) || 1);
    const renderWidth = Math.max(1, Math.round(viewWidth * pixelRatio));
    const renderHeight = Math.max(1, Math.round(viewHeight * pixelRatio));
    this.setData({
      viewWidth,
      viewHeight,
      renderWidth,
      renderHeight,
      pixelRatio,
    });
    console.log('[assembly-demo] render resolution', {
      viewWidth,
      viewHeight,
      pixelRatio,
      renderWidth,
      renderHeight,
    });
  },

  onUnload() {
    this.pendingAction = null;
  },

  handleSceneReady() {
    this.setData({
      progress: Math.max(this.data.progress, 24),
      loadingText: '场景已建立，正在加载三个零件…',
    });
  },

  handleAssetsProgress({ detail = {} }) {
    const raw = Number(detail.progress);
    if (!Number.isFinite(raw)) return;
    const percent = raw <= 1 ? raw * 100 : raw;
    this.setData({
      progress: Math.max(this.data.progress, Math.round(25 + percent * 0.65)),
      loadingText: `正在加载装配资源 ${Math.min(Math.round(percent), 100)}%`,
    });
  },

  handleAssetsLoaded() {
    this.setData({
      progress: 96,
      loadingText: '模型就绪，正在完成场景布置…',
    });
    setTimeout(() => {
      this.setData({
        loading: false,
        ready: true,
        progress: 100,
        stateLabel: '完整视图',
        stateHint: '点击下方“拆卸”查看爆炸动画',
      });
    }, 420);
  },

  handlePartLoaded() {
    this.setData({ loadedParts: this.data.loadedParts + 1 });
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
      stateHint: '动画播放中，请稍候…',
    });
    scene[action.method]();
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
