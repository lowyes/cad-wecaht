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
      this.cancelAllPartAnimations();
      this.animationTimer = null;
      this.animator = null;
      this.gltfComponent = null;
      this.partRecords = [];
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
        this.gltfComponent = model.getComponent(xrFrameSystem.GLTF);
        if (!this.animator) throw new Error('未找到 Animator 组件');
        if (!this.gltfComponent) throw new Error('未找到 GLTF 组件');

        this.initializeAnimationClips();
        this.ready = true;
        this.triggerEvent('model-ready', {
          clipName: config.displayClipName,
          durationMs: config.durationMs,
          animatedNodeCount: config.animatedNodeCount,
        });
        this.triggerEvent('assets-loaded');

        // 碰撞框并非模型显示的必要条件。先让模型进入可用状态，再分批
        // 初始化零件交互；单个节点失败时不能把正常 GLB 误报为加载失败。
        setTimeout(() => {
          if (this.disposed) return;
          this.prepareInteractiveParts(xrFrameSystem)
            .then((interactivePartCount) => {
              if (this.disposed) return;
              this.triggerEvent('interaction-ready', { interactivePartCount });
            })
            .catch((error) => {
              console.warn('[solidworks-assembly] part interaction disabled:', error);
              if (this.disposed) return;
              this.triggerEvent('interaction-warning', {
                message: `模型已加载，零件交互初始化失败：${error.message}`,
                interactivePartCount: 0,
              });
            });
        }, 0);
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

    waitForPoseUpdate(delayMs = 48) {
      return new Promise((resolve) => setTimeout(resolve, delayMs));
    },

    clonePosition(transform) {
      return [
        Number(transform.position.x) || 0,
        Number(transform.position.y) || 0,
        Number(transform.position.z) || 0,
      ];
    },

    setTransformPosition(transform, position) {
      transform.position.x = position[0];
      transform.position.y = position[1];
      transform.position.z = position[2];
    },

    async prepareInteractiveParts(xrFrameSystem) {
      this.partRecords = config.interactivePartNames
        .map((name) => {
          try {
            const element = this.gltfComponent.getInternalNodeByName(name);
            if (!element) return null;
            const transform = element.getComponent(xrFrameSystem.Transform);
            if (!transform) return null;
            return {
              name,
              element,
              transform,
              basePosition: null,
              explodedPosition: null,
              isExploded: false,
              dragged: false,
              animationToken: 0,
            };
          } catch (error) {
            console.warn(`[solidworks-assembly] skip unresolved part: ${name}`, error);
            return null;
          }
        })
        .filter(Boolean);

      await this.waitForPoseUpdate();
      for (const record of this.partRecords) {
        record.basePosition = this.clonePosition(record.transform);
      }
      this.applyAnimationProgress(1);
      await this.waitForPoseUpdate();
      for (const record of this.partRecords) {
        record.explodedPosition = this.clonePosition(record.transform);
      }
      this.applyAnimationProgress(0);
      await this.waitForPoseUpdate();

      const camera = this.scene.getElementById('camera');
      this.cameraOrbit = camera && camera.getComponent(
        xrFrameSystem.CameraOrbitControl,
      );
      let shapeCount = 0;
      const interactiveRecords = [];
      for (let index = 0; index < this.partRecords.length; index += 1) {
        const record = this.partRecords[index];
        try {
          let hitElement = null;
          record.element.dfs((element) => {
            if (hitElement) return;
            const mesh = element.getComponent(xrFrameSystem.Mesh);
            if (mesh) hitElement = element;
          });
          if (!hitElement) continue;
          let shape = hitElement.getComponent(xrFrameSystem.CubeShape);
          if (!shape) {
            shape = hitElement.addComponent(xrFrameSystem.CubeShape, {
              autoFit: true,
            });
          }
          if (!shape) continue;
          hitElement.event.add('touch-shape', (event) => {
            this.handlePartTouch(record, event);
          });
          hitElement.event.add('drag-shape', (event) => {
            this.handlePartDrag(record, event);
          });
          hitElement.event.add('untouch-shape', (event) => {
            this.handlePartUntouch(record, event);
          });
          shapeCount += 1;
          interactiveRecords.push(record);
        } catch (error) {
          console.warn(`[solidworks-assembly] skip collider: ${record.name}`, error);
        }
        if ((index + 1) % 5 === 0) await this.waitForPoseUpdate(16);
      }
      this.partRecords = interactiveRecords;
      console.log('[solidworks-assembly] interactive parts ready', {
        configured: config.interactivePartNames.length,
        resolved: this.partRecords.length,
        shapes: shapeCount,
      });
      return shapeCount;
    },

    eventPayload(event) {
      if (!event) return {};
      return event.detail ? event.detail.value || event.detail : event.value || event;
    },

    handlePartTouch(record) {
      if (!this.ready || this.animating) return;
      this.activePart = record;
      record.dragged = false;
      if (this.cameraOrbit) this.cameraOrbit.disable();
      this.triggerEvent('part-selected', {
        name: record.name,
        action: 'selected',
      });
    },

    handlePartDrag(record, event) {
      if (!this.ready || this.animating || this.activePart !== record) return;
      const payload = this.eventPayload(event);
      const deltaX = Number(payload.deltaX) || 0;
      const deltaY = Number(payload.deltaY) || 0;
      if (!deltaX && !deltaY) return;
      record.animationToken += 1;
      record.dragged = true;
      const dragScale = 0.00042;
      record.transform.position.x += deltaX * dragScale;
      record.transform.position.y -= deltaY * dragScale;
      this.triggerEvent('part-selected', {
        name: record.name,
        action: 'dragging',
      });
    },

    handlePartUntouch(record) {
      if (this.cameraOrbit) this.cameraOrbit.enable();
      if (this.activePart !== record) return;
      this.activePart = null;
      if (record.dragged || this.animating) {
        this.triggerEvent('part-selected', {
          name: record.name,
          action: 'dragged',
        });
        return;
      }
      this.togglePartPosition(record);
    },

    togglePartPosition(record) {
      const moveToExploded = !record.isExploded;
      const target = moveToExploded
        ? record.explodedPosition
        : record.basePosition;
      record.isExploded = moveToExploded;
      this.animatePartTo(record, target, moveToExploded ? 'exploded' : 'complete');
    },

    animatePartTo(record, target, state) {
      if (!target) return false;
      record.animationToken += 1;
      const token = record.animationToken;
      const start = this.clonePosition(record.transform);
      const startedAt = Date.now();
      const durationMs = 620;
      this.triggerEvent('part-selected', {
        name: record.name,
        action: state === 'exploded' ? 'moving-out' : 'moving-back',
      });
      const tick = () => {
        if (this.disposed || token !== record.animationToken) return;
        const ratio = Math.min(1, (Date.now() - startedAt) / durationMs);
        const eased = 1 - Math.pow(1 - ratio, 3);
        this.setTransformPosition(record.transform, [
          start[0] + (target[0] - start[0]) * eased,
          start[1] + (target[1] - start[1]) * eased,
          start[2] + (target[2] - start[2]) * eased,
        ]);
        if (ratio >= 1) {
          this.triggerEvent('part-selected', {
            name: record.name,
            action: state,
          });
          return;
        }
        record.animationTimer = setTimeout(tick, 32);
      };
      record.animationTimer = setTimeout(tick, 0);
      return true;
    },

    cancelAllPartAnimations() {
      for (const record of this.partRecords || []) {
        record.animationToken += 1;
        clearTimeout(record.animationTimer);
        record.animationTimer = null;
      }
      if (this.cameraOrbit) this.cameraOrbit.enable();
      this.activePart = null;
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
      this.cancelAllPartAnimations();
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
      if (this.currentMode === 'exploded' || this.currentMode === 'complete') {
        const isExploded = this.currentMode === 'exploded';
        for (const record of this.partRecords || []) {
          record.isExploded = isExploded;
        }
      }
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
