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
        this.setAnimationProgress(0);
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

    setAnimationProgress(progress) {
      if (!this.animator) return false;
      this.animationToken = (this.animationToken || 0) + 1;
      clearTimeout(this.animationTimer);
      this.animating = false;
      this.animator.stop();
      const normalizedProgress = Math.max(0, Math.min(1, progress));
      for (const clipName of config.clipNames) {
        this.animator.play(clipName, { loop: 0, direction: 'forwards' });
        this.animator.pauseToFrame(clipName, normalizedProgress);
      }
      return true;
    },

    playAnimation(direction, mode) {
      if (!this.ready || !this.animator || this.animating) return false;
      this.animationToken = (this.animationToken || 0) + 1;
      const token = this.animationToken;
      clearTimeout(this.animationTimer);
      this.animator.stop();
      this.currentMode = mode;
      this.animating = true;
      this.triggerEvent('animation-start', { mode });
      console.log('[solidworks-assembly] play animation', {
        clips: config.clipNames,
        direction,
        mode,
      });
      for (const clipName of config.clipNames) {
        this.animator.play(clipName, {
          loop: 0,
          speed: 1,
          direction,
        });
      }
      this.animationTimer = setTimeout(
        () => this.finishAnimation(token),
        config.durationMs + 350,
      );
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

    handleAnimationStop() {
      this.finishAnimation();
    },

    playInstall() {
      return this.playAnimation('backwards', 'complete');
    },

    playExplode() {
      return this.playAnimation('forwards', 'exploded');
    },

    playSection() {
      if (!this.ready || this.animating) return false;
      this.triggerEvent('animation-start', { mode: 'section' });
      this.setAnimationProgress(0.52);
      setTimeout(() => {
        if (!this.disposed) this.triggerEvent('animation-end', { mode: 'section' });
      }, 80);
      return true;
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
