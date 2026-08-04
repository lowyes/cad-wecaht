const diweiConfig = require('../../config/diwei');
const {
  AR_TARGETS,
  getFcodeByModelId,
} = require('../../config/model_fcode_map');
const SUPPORTED_MODEL_IDS = AR_TARGETS.map((target) => target.modelId);

Page({
  data: {
    arStarted: false,
    isLoading: false,
    loadingText: '正在启动本地AR…',
    hasError: false,
    errorMessage: '',
    arReady: false,
    modelReady: false,
    modelWarning: '',
    recognizedModelId: '',
    viewWidth: 375,
    viewHeight: 667,
    renderWidth: 750,
    renderHeight: 1334,
    modelScale: 8,
    modelRotationX: -90,
    modelRotationY: 0,
    supportedModelsText: SUPPORTED_MODEL_IDS.join(' / '),
    supportedTargetCount: SUPPORTED_MODEL_IDS.length,
    launchProgress: 8,
    startupSlow: false,
    statusText: '正在初始化AR，请保持手机稳定',
  },

  onLoad(options = {}) {
    const windowInfo = wx.getWindowInfo
      ? wx.getWindowInfo()
      : wx.getSystemInfoSync();
    const viewWidth = windowInfo.windowWidth;
    const viewHeight = windowInfo.windowHeight;
    const pixelRatio = Math.min(windowInfo.pixelRatio || 2, 3);

    this.setData({
      viewWidth,
      viewHeight,
      renderWidth: Math.round(viewWidth * pixelRatio),
      renderHeight: Math.round(viewHeight * pixelRatio),
    });

    if (options.autostart === '1') {
      setTimeout(() => this.startAR(), 80);
    }
  },

  startAR() {
    if (this.data.arStarted) return;

    this.setData({
      arStarted: true,
      isLoading: true,
      hasError: false,
      errorMessage: '',
      arReady: false,
      modelReady: false,
      recognizedModelId: '',
      launchProgress: 8,
      startupSlow: false,
      loadingText: '正在建立本地 AR 场景…',
      statusText: '正在初始化 AR，请保持手机稳定',
    });

    clearTimeout(this.startupTimer);
    this.startupTimer = setTimeout(() => {
      if (this.data.isLoading) {
        this.setData({
          startupSlow: true,
          loadingText: '相机连接时间较长，请确认已允许相机权限',
          statusText: '仍在等待相机，请检查权限或重新启动 AR',
        });
      }
    }, 12000);
  },

  onUnload() {
    clearTimeout(this.startupTimer);
    clearTimeout(this.launchDismissTimer);
    this.activeTargets = null;
  },

  handleSceneReady() {
    this.activeTargets = new Set();
    this.setData({
      launchProgress: Math.max(this.data.launchProgress, 28),
      statusText: '场景已启动，正在开启摄像头',
      loadingText: '正在开启相机与本地识图…',
    });
  },

  handleARReady() {
    clearTimeout(this.startupTimer);
    this.setData({
      arReady: true,
      launchProgress: 100,
      loadingText: 'AR 视野已就绪',
      statusText: '请将摄像头对准完整的二维工程图',
    });
    this.launchDismissTimer = setTimeout(() => {
      this.setData({
        isLoading: false,
        startupSlow: false,
      });
    }, 380);
  },

  handleAssetsProgress({ detail }) {
    const payload = detail && (detail.value || detail);
    const progress = payload && payload.progress;
    if (typeof progress === 'number') {
      const normalizedProgress = progress <= 1 ? progress * 100 : progress;
      const resourceProgress = Math.min(Math.round(normalizedProgress), 100);
      this.setData({
        launchProgress: Math.max(
          this.data.launchProgress,
          Math.round(35 + resourceProgress * 0.55),
        ),
        loadingText: `正在加载本地 AR 资源 ${resourceProgress}%`,
      });
    }
  },

  handleAssetsLoaded() {
    this.setData({
      modelReady: true,
      modelWarning: '',
      launchProgress: Math.max(this.data.launchProgress, 94),
      loadingText: this.data.arReady ? 'AR 视野已就绪' : '模型就绪，正在连接相机',
    });
  },

  handleModelLoaded() {
    this.setData({
      modelReady: true,
      modelWarning: '',
    });
  },

  handleTrackerChange({ detail }) {
    const modelId = detail.modelId;
    const recognized = detail.active;

    if (!this.activeTargets) this.activeTargets = new Set();
    if (recognized) {
      this.activeTargets.add(modelId);
    } else {
      this.activeTargets.delete(modelId);
    }

    const activeModelId = recognized
      ? modelId
      : Array.from(this.activeTargets)[0] || '';

    this.setData({
      recognizedModelId: activeModelId,
      statusText: activeModelId
        ? `识别成功：${activeModelId}`
        : '目标丢失，请重新对准完整工程图',
    });
  },

  handleTrackerState({ detail }) {
    if (detail.errorMessage) {
      this.setData({
        statusText: `识图跟踪器异常：${detail.errorMessage}`,
      });
      return;
    }

    if (detail.state === 2 && !this.data.recognizedModelId) {
      this.setData({
        statusText: '识图跟踪器已就绪，请对准完整的原始工程图',
      });
    }
  },

  handleModelError({ detail }) {
    this.setData({
      modelReady: false,
      modelWarning: detail.message || '三维模型加载失败，识图功能仍可使用',
      isLoading: false,
      statusText: '本地识图可用，三维模型暂以定位方块显示',
    });
  },

  scaleUp() {
    this.setData({
      modelScale: Math.min(this.data.modelScale + 2, 30),
    });
  },

  scaleDown() {
    this.setData({
      modelScale: Math.max(this.data.modelScale - 2, 1),
    });
  },

  rotateModel() {
    this.setData({
      modelRotationY: (this.data.modelRotationY + 45) % 360,
    });
  },

  resetModel() {
    this.setData({
      modelScale: 8,
      modelRotationX: -90,
      modelRotationY: 0,
    });
  },

  goToDiweiMiniProgram() {
    const modelId = this.data.recognizedModelId;
    if (!modelId) {
      wx.showToast({ title: '请先识别工程图', icon: 'none' });
      return;
    }

    const fcode = getFcodeByModelId(modelId);
    if (!fcode) {
      wx.showToast({ title: '该零件未配置迪威链接', icon: 'none' });
      return;
    }

    const path = `${diweiConfig.MODEL_PATH}?c=${encodeURIComponent(fcode)}`;
    wx.navigateToMiniProgram({
      appId: diweiConfig.APP_ID,
      path,
      envVersion: 'release',
      success() {
        console.log('[AR navigateToMiniProgram] 跳转成功:', modelId, path);
      },
      fail(error) {
        console.error('[AR navigateToMiniProgram] 跳转失败:', error);
        wx.showToast({ title: '跳转失败，请检查小程序权限', icon: 'none' });
      },
    });
  },

  handleGestureStart(event) {
    const touches = event.touches || [];
    if (touches.length === 1) {
      this.gestureState = {
        mode: 'rotate',
        x: touches[0].clientX,
        y: touches[0].clientY,
      };
      return;
    }

    if (touches.length === 2) {
      this.gestureState = {
        mode: 'scale',
        distance: this.getTouchDistance(touches),
        scale: this.data.modelScale,
      };
    }
  },

  handleGestureMove(event) {
    const touches = event.touches || [];
    const gesture = this.gestureState;
    if (!gesture) return;

    if (gesture.mode === 'rotate' && touches.length === 1) {
      const dx = touches[0].clientX - gesture.x;
      const dy = touches[0].clientY - gesture.y;
      gesture.x = touches[0].clientX;
      gesture.y = touches[0].clientY;
      this.setData({
        modelRotationX: (this.data.modelRotationX + dy * 0.6) % 360,
        modelRotationY: (this.data.modelRotationY + dx * 0.6) % 360,
      });
      return;
    }

    if (gesture.mode === 'scale' && touches.length === 2) {
      const distance = this.getTouchDistance(touches);
      if (!gesture.distance) return;
      this.setData({
        modelScale: Math.min(
          Math.max(gesture.scale * (distance / gesture.distance), 1),
          30,
        ),
      });
    }
  },

  handleGestureEnd(event) {
    const touches = event.touches || [];
    if (touches.length === 0) {
      this.gestureState = null;
      return;
    }

    this.handleGestureStart(event);
  },

  getTouchDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  },

  showError(message) {
    this.setData({
      isLoading: false,
      hasError: true,
      errorMessage: message,
      statusText: message,
    });
  },

  restartAR() {
    wx.reLaunch({ url: '/pages/ar-viewer/ar-viewer?autostart=1' });
  },
});
