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
    loadTimedOut: false,
    loadingText: '正在创建 XR-FRAME 场景…',
    activeMode: 'complete',
    activeAction: 'complete',
    stateLabel: '正在加载装配体',
    stateHint: '准备 SolidWorks 减速器与爆炸动画',
    assemblyLabel: config.label,
    buildLabel: 'R8 · 3.17.2',
    animatedNodeCount: config.animatedNodeCount,
    interactivePartCount: 0,
    partOptions: config.interactivePartNames,
    selectedPartIndex: 0,
    selectedPartName: config.interactivePartNames[0] || '',
    partBusy: false,
    durationSeconds: config.durationMs / 1000,
  },

  onLoad(options = {}) {
    this.pageDisposed = false;
    if (options.assemblyId && options.assemblyId !== config.id) {
      wx.showToast({ title: '该装配体尚未配置爆炸图', icon: 'none' });
      this.invalidAssemblyTimer = setTimeout(() => wx.navigateBack(), 800);
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
    this.startLoadWatchdog();
  },

  onUnload() {
    this.pageDisposed = true;
    this.pendingAction = null;
    this.pendingActionName = null;
    clearTimeout(this.loadWatchdog);
    clearTimeout(this.revealTimer);
    clearTimeout(this.invalidAssemblyTimer);
    this.loadWatchdog = null;
    this.revealTimer = null;
    this.invalidAssemblyTimer = null;
  },

  startLoadWatchdog() {
    clearTimeout(this.loadWatchdog);
    this.loadWatchdog = setTimeout(() => {
      if (this.pageDisposed || this.data.ready) return;
      this.setData({
        loadTimedOut: true,
        progress: 0,
        loadingText: '模型加载超时，请点击下方按钮重新加载',
      });
    }, 18000);
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
    const percent = Math.max(0, Math.min(100, raw <= 1 ? raw * 100 : raw));
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
    clearTimeout(this.loadWatchdog);
    this.loadWatchdog = null;
    clearTimeout(this.revealTimer);
    this.revealTimer = setTimeout(() => {
      this.revealTimer = null;
      if (this.pageDisposed) return;
      const nextData = {
        loading: false,
        ready: true,
        progress: 100,
        stateLabel: '完整视图',
      };
      if (!this.interactionInitialized) {
        nextData.stateHint = '模型已就绪，正在准备零件点击与拖动…';
      }
      this.setData(nextData);
    }, 280);
  },

  handleInteractionReady({ detail = {} }) {
    this.interactionInitialized = true;
    const interactivePartCount = Number(detail.interactivePartCount) || 0;
    const partOptions = Array.isArray(detail.interactivePartNames)
      ? detail.interactivePartNames
      : [];
    this.setData({
      interactivePartCount,
      partOptions,
      selectedPartIndex: 0,
      selectedPartName: partOptions[0] || '',
      stateHint: interactivePartCount
        ? `${interactivePartCount} 个零件可点击定位与独立拖动`
        : detail.reason || '爆炸动画可用，当前模型没有可拖动零件',
    });
  },

  handleInteractionWarning({ detail = {} }) {
    this.interactionInitialized = true;
    this.setData({
      interactivePartCount: Number(detail.interactivePartCount) || 0,
      stateHint: '爆炸动画可用，零件独立拖动暂不可用',
    });
    console.warn('[assembly-viewer] interaction warning:', detail.message);
  },

  handleModelError({ detail = {} }) {
    clearTimeout(this.loadWatchdog);
    clearTimeout(this.revealTimer);
    this.loadWatchdog = null;
    this.revealTimer = null;
    this.setData({
      loading: false,
      ready: false,
      busy: false,
      stateLabel: '模型加载失败',
      stateHint: detail.message || '请重新进入页面后再试',
      loadTimedOut: true,
    });
    wx.showToast({ title: detail.message || '模型加载失败', icon: 'none' });
  },

  retryLoad() {
    wx.redirectTo({
      url: `/assemblyPackage/pages/assembly-viewer/index?assemblyId=${config.id}`,
    });
  },

  handleModeTap(event) {
    if (!this.data.ready || this.data.busy || this.data.partBusy) return;
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
    let accepted = false;
    try {
      accepted = scene[action.method]() !== false;
    } catch (error) {
      console.warn(`[assembly-viewer] ${actionName} failed:`, error);
    }
    if (!accepted) {
      this.pendingAction = null;
      this.pendingActionName = null;
      this.setData({
        busy: false,
        stateLabel: '操作暂不可用',
        stateHint: '模型正在准备交互，请稍后重试',
      });
    }
  },

  handleAnimationStart() {
    if (this.data.partBusy) this.setData({ partBusy: false });
  },

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

  handlePartSelected({ detail = {} }) {
    const actionLabels = {
      selected: '已选中零件',
      dragging: '正在拖动零件',
      dragged: '零件已移动',
      'moving-out': '正在移至拆卸位',
      'moving-back': '正在返回装配位',
      exploded: '零件已到拆卸位',
      complete: '零件已回装配位',
    };
    const nextData = {
      stateLabel: actionLabels[detail.action] || '零件交互',
      stateHint: detail.name || '请选择一个零件',
      partBusy: ['moving-out', 'moving-back', 'dragging'].includes(detail.action),
    };
    const selectedPartIndex = this.data.partOptions.indexOf(detail.name);
    if (selectedPartIndex >= 0) {
      nextData.selectedPartIndex = selectedPartIndex;
      nextData.selectedPartName = detail.name;
    }
    this.setData(nextData);
  },

  handlePartPickerChange({ detail = {} }) {
    const selectedPartIndex = Number(detail.value) || 0;
    const selectedPartName = this.data.partOptions[selectedPartIndex] || '';
    this.setData({
      selectedPartIndex,
      selectedPartName,
      stateLabel: '已指定零件',
      stateHint: selectedPartName || '请选择一个零件',
    });
  },

  handleSelectedPartAction(event) {
    if (
      !this.data.ready ||
      !this.data.interactivePartCount ||
      this.data.busy ||
      this.data.partBusy
    ) {
      return;
    }
    const mode = event.currentTarget.dataset.mode;
    const scene = this.selectComponent('#assemblyScene');
    if (!scene || !this.data.selectedPartName || typeof scene.setPartPosition !== 'function') {
      wx.showToast({ title: '该零件交互尚未就绪', icon: 'none' });
      return;
    }
    this.setData({ partBusy: true });
    try {
      if (scene.setPartPosition(this.data.selectedPartName, mode) !== false) return;
    } catch (error) {
      console.warn('[assembly-viewer] part action failed:', error);
    }
    this.setData({ partBusy: false });
    wx.showToast({ title: '该零件交互尚未就绪', icon: 'none' });
  },

  goBack() {
    wx.navigateBack({
      fail: () => wx.reLaunch({ url: '/pages/ar-viewer/ar-viewer' }),
    });
  },
});
