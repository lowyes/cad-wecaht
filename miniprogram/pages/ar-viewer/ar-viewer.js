const diweiConfig = require('../../config/diwei');
const {
  AR_TARGETS,
  getFcodeByModelId,
  getTargetByModelId,
} = require('../../config/model_fcode_map');
const {
  createTrackingStabilizer,
} = require('../../utils/tracking_stabilizer');
const SUPPORTED_MODEL_IDS = AR_TARGETS.map((target) => target.modelId);
const SUPPORTED_MODEL_ID_SET = new Set(SUPPORTED_MODEL_IDS);
const MAX_RENDER_PIXEL_RATIO = 2;
const TRACK_ACQUIRE_DELAY_MS = 200;
const TRACK_LOSS_GRACE_MS = 1000;
const TRACK_REACQUIRE_DELAY_MS = 100;
const TRACK_REACQUIRE_WINDOW_MS = 2500;
const ASSET_PROGRESS_STEP = 5;
const TRANSFORM_UPDATE_INTERVAL_MS = 32;
const STARTUP_SLOW_MS = 12000;
const STARTUP_FAILURE_MS = 25000;

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
    recognizedTargetType: '',
    recognizedTargetLabel: '',
    recognizedAssemblyId: '',
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
    const pixelRatio = Math.min(
      windowInfo.pixelRatio || 2,
      MAX_RENDER_PIXEL_RATIO,
    );

    this.setData({
      viewWidth,
      viewHeight,
      renderWidth: Math.round(viewWidth * pixelRatio),
      renderHeight: Math.round(viewHeight * pixelRatio),
    });

    if (options.autostart === '1') {
      this.autostartTimer = setTimeout(() => {
        this.autostartTimer = null;
        this.startAR();
      }, 80);
    }
  },

  startAR() {
    if (this.runtimeActive || this.data.arStarted) return;

    this.runtimeActive = true;
    this.initializeTrackingStabilizer();
    this.clearStartupTimers();
    this.lastReportedAssetProgress = -1;
    this.performanceTrace = {
      startedAt: Date.now(),
      stages: {},
    };
    this.recordPerformanceStage('start');

    this.setData({
      arStarted: true,
      isLoading: true,
      hasError: false,
      errorMessage: '',
      arReady: false,
      modelReady: false,
      recognizedModelId: '',
      recognizedTargetType: '',
      recognizedTargetLabel: '',
      recognizedAssemblyId: '',
      launchProgress: 8,
      startupSlow: false,
      loadingText: '正在建立本地 AR 场景…',
      statusText: '正在初始化 AR，请保持手机稳定',
    });

    this.startupTimer = setTimeout(() => {
      if (!this.data.arReady) {
        this.setData({
          startupSlow: true,
          loadingText: '相机连接时间较长，请确认已允许相机权限',
          statusText: '仍在等待相机，请检查权限或重新启动 AR',
        });
      }
    }, STARTUP_SLOW_MS);

    this.startupFailureTimer = setTimeout(() => {
      if (!this.data.arReady) {
        this.showError('AR 启动超时，请检查相机权限后重新启动');
      }
    }, STARTUP_FAILURE_MS);
  },

  onShow() {
    if (!this.shouldResumeAR) return;

    this.shouldResumeAR = false;
    const resume = () => this.startAR();
    if (wx.nextTick) {
      wx.nextTick(resume);
    } else {
      setTimeout(resume, 0);
    }
  },

  onHide() {
    clearTimeout(this.autostartTimer);
    this.autostartTimer = null;
    if (!this.data.arStarted) return;

    this.shouldResumeAR = true;
    this.disposeRuntimeState();
    this.setData({
      arStarted: false,
      arReady: false,
      isLoading: false,
      recognizedModelId: '',
      recognizedTargetType: '',
      recognizedTargetLabel: '',
      recognizedAssemblyId: '',
      statusText: '返回后将重新连接相机',
    });
  },

  onUnload() {
    this.shouldResumeAR = false;
    this.disposeRuntimeState();
  },

  handleSceneReady() {
    if (!this.runtimeActive) return;
    if (this.trackingStabilizer) {
      this.trackingStabilizer.reset({ emit: false });
    }
    this.setData({
      launchProgress: Math.max(this.data.launchProgress, 28),
      statusText: '场景已启动，正在开启摄像头',
      loadingText: '正在开启相机与本地识图…',
    });
    this.recordPerformanceStage('scene-ready');
  },

  handleARReady() {
    if (!this.runtimeActive) return;
    this.clearStartupTimers();
    this.setData({
      arReady: true,
      hasError: false,
      errorMessage: '',
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
    this.recordPerformanceStage('ar-ready');
  },

  handleAssetsProgress({ detail } = {}) {
    if (!this.runtimeActive) return;
    const payload = detail && (detail.value || detail);
    const progress = payload && payload.progress;
    if (typeof progress === 'number') {
      const normalizedProgress = progress <= 1 ? progress * 100 : progress;
      const resourceProgress = Math.min(Math.round(normalizedProgress), 100);
      if (
        resourceProgress !== 100 &&
        resourceProgress < this.lastReportedAssetProgress + ASSET_PROGRESS_STEP
      ) {
        return;
      }
      this.lastReportedAssetProgress = resourceProgress;
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
    if (!this.runtimeActive) return;
    this.setData({
      modelReady: true,
      modelWarning: '',
      launchProgress: Math.max(this.data.launchProgress, 94),
      loadingText: this.data.arReady ? 'AR 视野已就绪' : '模型就绪，正在连接相机',
    });
    this.recordPerformanceStage('assets-loaded');
  },

  handleModelLoaded() {
    if (!this.runtimeActive) return;
    this.setData({
      modelReady: true,
    });
  },

  handleTrackerChange({ detail = {} } = {}) {
    if (!this.runtimeActive) return;
    const modelId = detail.modelId;
    if (!SUPPORTED_MODEL_ID_SET.has(modelId)) {
      console.warn('[AR tracker] ignored unknown model:', modelId);
      return;
    }

    if (!this.trackingStabilizer) this.initializeTrackingStabilizer();
    if (detail.active) {
      this.recordPerformanceStage(`tracker-active:${modelId}`);
    }
    this.trackingStabilizer.update(modelId, detail.active);
  },

  handleTrackerState({ detail = {} } = {}) {
    if (!this.runtimeActive) return;
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

  handleModelError({ detail = {} } = {}) {
    if (!this.runtimeActive) return;
    const modelId = detail.modelId || '';
    const globalFailure = detail.globalFailure !== false;
    const message = detail.message || '三维模型加载失败，识图功能仍可使用';
    this.setData({
      modelReady: globalFailure ? false : this.data.modelReady,
      modelWarning: modelId ? `${modelId}：${message}` : message,
      isLoading: false,
      statusText: modelId
        ? `${modelId} 模型暂以定位方块显示，识图仍可用`
        : '本地识图可用，三维模型暂以定位方块显示',
    });
  },

  initializeTrackingStabilizer() {
    if (this.trackingStabilizer) this.trackingStabilizer.dispose();
    this.trackingStabilizer = createTrackingStabilizer({
      acquireDelayMs: TRACK_ACQUIRE_DELAY_MS,
      lossGraceMs: TRACK_LOSS_GRACE_MS,
      reacquireDelayMs: TRACK_REACQUIRE_DELAY_MS,
      reacquireWindowMs: TRACK_REACQUIRE_WINDOW_MS,
      onChange: (modelId, meta) => this.applyStableTarget(modelId, meta),
    });
  },

  applyStableTarget(modelId, meta = {}) {
    if (this.data.recognizedModelId === modelId) return;
    const target = getTargetByModelId(modelId);
    const isAssembly = target && target.targetType === 'assembly';
    this.setData({
      recognizedModelId: modelId,
      recognizedTargetType: target ? target.targetType : '',
      recognizedTargetLabel: target ? target.label : '',
      recognizedAssemblyId: isAssembly ? target.assemblyId : '',
      statusText: modelId
        ? isAssembly
          ? `识别成功：${target.label}，可查看爆炸图`
          : `识别成功：${target ? target.label : modelId}`
        : '目标丢失，请重新对准完整工程图',
    });
    this.recordPerformanceStage(
      modelId ? `stable-target:${modelId}` : 'stable-target-lost',
      { reason: meta.reason || '' },
    );
    console.info('[AR tracking]', {
      modelId,
      active: Boolean(modelId),
      reason: meta.reason || '',
      elapsedMs: this.performanceTrace
        ? Date.now() - this.performanceTrace.startedAt
        : null,
    });
  },

  recordPerformanceStage(stage, detail = {}) {
    const trace = this.performanceTrace;
    if (!trace || trace.stages[stage] !== undefined) return;
    const elapsedMs = Date.now() - trace.startedAt;
    trace.stages[stage] = elapsedMs;
    console.info('[AR performance]', {
      stage,
      elapsedMs,
      ...detail,
    });
  },

  clearStartupTimers() {
    clearTimeout(this.startupTimer);
    clearTimeout(this.startupFailureTimer);
    this.startupTimer = null;
    this.startupFailureTimer = null;
  },

  disposeRuntimeState() {
    this.runtimeActive = false;
    clearTimeout(this.autostartTimer);
    this.autostartTimer = null;
    this.clearStartupTimers();
    clearTimeout(this.launchDismissTimer);
    this.launchDismissTimer = null;
    clearTimeout(this.transformUpdateTimer);
    this.transformUpdateTimer = null;
    this.pendingModelTransform = null;
    this.lastReportedAssetProgress = -1;
    this.performanceTrace = null;
    this.gestureState = null;
    if (this.trackingStabilizer) {
      this.trackingStabilizer.dispose();
      this.trackingStabilizer = null;
    }
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

  openRecognizedAssembly() {
    const assemblyId = this.data.recognizedAssemblyId;
    if (!assemblyId) {
      wx.showToast({ title: '请先识别装配图', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: `/assemblyPackage/pages/assembly-viewer/index?assemblyId=${encodeURIComponent(assemblyId)}`,
    });
  },

  handleGestureStart(event) {
    this.flushModelTransform();
    const touches = event.touches || [];
    if (touches.length === 1) {
      this.gestureState = {
        mode: 'rotate',
        x: touches[0].clientX,
        y: touches[0].clientY,
        rotationX: this.data.modelRotationX,
        rotationY: this.data.modelRotationY,
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
      gesture.rotationX = (gesture.rotationX + dy * 0.6) % 360;
      gesture.rotationY = (gesture.rotationY + dx * 0.6) % 360;
      this.queueModelTransform({
        modelRotationX: gesture.rotationX,
        modelRotationY: gesture.rotationY,
      });
      return;
    }

    if (gesture.mode === 'scale' && touches.length === 2) {
      const distance = this.getTouchDistance(touches);
      if (!gesture.distance) return;
      this.queueModelTransform({
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
      this.flushModelTransform();
      this.gestureState = null;
      return;
    }

    this.flushModelTransform();
    this.handleGestureStart(event);
  },

  queueModelTransform(transform) {
    this.pendingModelTransform = {
      ...(this.pendingModelTransform || {}),
      ...transform,
    };
    if (this.transformUpdateTimer) return;
    this.transformUpdateTimer = setTimeout(() => {
      this.transformUpdateTimer = null;
      this.flushModelTransform();
    }, TRANSFORM_UPDATE_INTERVAL_MS);
  },

  flushModelTransform() {
    clearTimeout(this.transformUpdateTimer);
    this.transformUpdateTimer = null;
    const transform = this.pendingModelTransform;
    this.pendingModelTransform = null;
    if (transform && this.data.arStarted) this.setData(transform);
  },

  getTouchDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  },

  showError(message) {
    this.clearStartupTimers();
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
