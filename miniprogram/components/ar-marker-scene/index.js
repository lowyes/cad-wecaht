const { AR_TARGETS } = require('../../config/model_fcode_map');

Component({
  properties: {
    modelScale: {
      type: Number,
      value: 8,
    },
    modelRotationX: {
      type: Number,
      value: -90,
    },
    modelRotationY: {
      type: Number,
      value: 0,
    },
  },

  data: {
    arReady: false,
    modelReady: false,
    targets: AR_TARGETS.map((target) => ({
      ...target,
      modelUsable: target.hasModel,
    })),
  },

  methods: {
    handleSceneReady({ detail }) {
      this.scene = detail.value;
      this.triggerEvent('scene-ready');
    },

    handleARReady() {
      this.setData({ arReady: true });
      this.triggerEvent('ar-ready');
    },

    handleAssetsProgress({ detail }) {
      const payload = detail && (detail.value || detail);
      this.triggerEvent('assets-progress', {
        progress: payload && payload.progress,
      });
    },

    handleAssetsLoaded() {
      this.setData({ modelReady: true });
      this.triggerEvent('assets-loaded');
    },

    handleGltfLoaded(event) {
      this.triggerEvent('model-loaded', {
        modelId: event.currentTarget.dataset.modelId,
      });
    },

    handleAssetsError(event) {
      this.setData({ modelReady: false });
      console.error('[ar-marker-scene] asset load failed:', event);
      this.triggerEvent('model-error', {
        globalFailure: true,
        message: '三维模型资源加载失败，已切换为定位方块',
      });
    },

    handleGltfError(event) {
      const modelId = event.currentTarget.dataset.modelId;
      const targetIndex = this.data.targets.findIndex(
        (target) => target.modelId === modelId,
      );
      if (targetIndex >= 0) {
        this.setData({
          [`targets[${targetIndex}].modelUsable`]: false,
        });
      }
      console.error('[ar-marker-scene] glTF parse failed:', event);
      this.triggerEvent('model-error', {
        modelId,
        globalFailure: false,
        message: '三维模型解析失败，已切换为定位方块',
      });
    },

    handleSceneLog({ detail }) {
      console.log('[ar-marker-scene]', detail && detail.value);
    },

    handleTrackerSwitch(event) {
      const modelId = event.currentTarget.dataset.modelId;
      this.emitTrackerChange(modelId, event.detail);
    },

    handleTrackerState(event) {
      const modelId = event.currentTarget.dataset.modelId;
      const detail = event.detail;
      const tracker = detail && detail.value;
      this.triggerEvent('tracker-state', {
        modelId,
        state: tracker && tracker.state,
        errorMessage: (tracker && tracker.errorMessage) || '',
      });
    },

    emitTrackerChange(modelId, detail) {
      this.triggerEvent('tracker-change', {
        modelId,
        active: Boolean(detail && detail.value),
      });
    },
  },
});
