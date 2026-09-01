const config = require('../../config/assembly_0001');

function vectorToText(vector) {
  return vector.map((value) => Number(value) || 0).join(' ');
}

Component({
  data: {
    assetId: config.assetId,
    modelSrc: config.modelSrc,
    modelScale: config.scale,
    rotationText: vectorToText(config.rotation),
  },

  lifetimes: {
    detached() {
      this.disposed = true;
      this.animationToken = (this.animationToken || 0) + 1;
      clearTimeout(this.animationTimer);
      this.animationTimer = null;
      this.animator = null;
      this.scene = null;
    },
  },

  methods: {
    handleSceneReady({ detail }) {
      this.scene = detail.value;
      this.disposed = false;
      this.triggerEvent('scene-ready');
    },

    handleAssetsProgress({ detail }) {
      const payload = detail && (detail.value || detail);
      this.triggerEvent('assets-progress', {
        progress: payload && payload.progress,
      });
    },

    handleAssetCollectionLoaded() {
      this.assetCollectionLoaded = true;
    },

    handleAssetsError(event) {
      console.error('[solidworks-assembly] asset load failed:', event);
      this.triggerEvent('model-error', { message: '装配体 GLB 资源加载失败' });
    },

    handleGltfLoaded() {
      try {
        const xrFrameSystem = wx.getXrFrameSystem();
        const model = this.scene.getElementById('assembly-model');
        this.animator = model.getComponent(xrFrameSystem.Animator);
        if (!this.animator) throw new Error('未找到 Animator 组件');

        this.ready = true;
        this.initializeAnimationClips();
        this.triggerEvent('model-ready', {
          clipName: config.displayClipName,
          durationMs: config.durationMs,
          animatedNodeCount: config.animatedNodeCount,
        });
        this.triggerEvent('assets-loaded');
      } catch (error) {
        console.error('[solidworks-assembly] animation init failed:', error);
        this.triggerEvent('model-error', {
          message: `爆炸动画初始化失败：${error.message}`,
        });
      }
    },

    handleGltfError(event) {
      console.error('[solidworks-assembly] glTF parse failed:', event);
      this.triggerEvent('model-error', { message: '装配体 GLB 解析失败' });
    },

    initializeAnimationClips() {
      this.animator.stop();
      for (const clipName of config.clipNames) {
        this.animator.play(clipName, { loop: 0, direction: 'forwards' });
        this.animator.pauseToFrame(clipName, 0);
      }
      this.animationProgress = 0;
      this.animating = false;
      return true;
    },

    applyAnimationProgress(progress) {
      if (!this.animator) return false;
      const normalizedProgress = Math.max(0, Math.min(1, progress));
      for (const clipName of config.clipNames) {
        this.animator.pauseToFrame(clipName, normalizedProgress);
      }
      this.animationProgress = normalizedProgress;
      return true;
    },

    setAnimationProgress(progress) {
      if (!this.animator) return false;
      this.animationToken = (this.animationToken || 0) + 1;
      clearTimeout(this.animationTimer);
      this.animationTimer = null;
      this.animating = false;
      return this.applyAnimationProgress(progress);
    },

    animateToProgress(targetProgress, mode) {
      if (!this.ready || !this.animator || this.animating) return false;
      this.animationToken = (this.animationToken || 0) + 1;
      const token = this.animationToken;
      clearTimeout(this.animationTimer);
      const fromProgress = Number(this.animationProgress) || 0;
      const toProgress = Math.max(0, Math.min(1, targetProgress));
      const distance = Math.abs(toProgress - fromProgress);
      const durationMs = Math.max(240, Math.round(config.durationMs * distance));
      const startedAt = Date.now();
      this.currentMode = mode;
      this.animating = true;
      this.triggerEvent('animation-start', { mode });
      console.log('[solidworks-assembly] tween animation progress', {
        clips: config.clipNames,
        fromProgress,
        toProgress,
        durationMs,
        mode,
      });

      const tick = () => {
        if (this.disposed || token !== this.animationToken) return;
        const elapsedRatio = Math.min(1, (Date.now() - startedAt) / durationMs);
        const easedRatio =
          elapsedRatio < 0.5
            ? 2 * elapsedRatio * elapsedRatio
            : 1 - Math.pow(-2 * elapsedRatio + 2, 2) / 2;
        this.applyAnimationProgress(
          fromProgress + (toProgress - fromProgress) * easedRatio,
        );
        if (elapsedRatio >= 1) {
          this.finishAnimation(token);
          return;
        }
        this.animationTimer = setTimeout(tick, 32);
      };
      this.animationTimer = setTimeout(tick, 0);
      return true;
    },

    finishAnimation(token = this.animationToken) {
      if (
        this.disposed ||
        !this.animating ||
        token !== this.animationToken
      ) {
        return;
      }
      clearTimeout(this.animationTimer);
      this.animationTimer = null;
      this.animating = false;
      this.triggerEvent('animation-end', { mode: this.currentMode });
    },

    playInstall() {
      return this.animateToProgress(0, 'complete');
    },

    playExplode() {
      return this.animateToProgress(1, 'exploded');
    },

    playSection() {
      return this.animateToProgress(0.52, 'section');
    },

    showComplete() {
      if (!this.ready || this.animating) return false;
      this.triggerEvent('animation-start', { mode: 'complete' });
      this.setAnimationProgress(0);
      setTimeout(() => {
        if (!this.disposed) this.triggerEvent('animation-end', { mode: 'complete' });
      }, 80);
      return true;
    },

    handleSceneLog({ detail }) {
      console.log('[solidworks-assembly]', detail && detail.value);
    },
  },
});
