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
      this.stopRawPartDrag();
      this.animationTimer = null;
      this.animator = null;
      this.gltfComponent = null;
      this.cameraOrbit = null;
      this.cameraTransform = null;
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

        // 碰撞盒并非模型显示的必要条件。先让模型进入可用状态，再分批
        // 初始化零件交互；单个节点失败时不能把正常 GLB 误报为加载失败。
        if (this.interactionPrepared) return;
        this.interactionPrepared = true;
        setTimeout(() => {
          if (this.disposed) return;
          this.prepareInteractiveParts(xrFrameSystem)
            .then((interactivePartCount) => {
              if (this.disposed) return;
              this.triggerEvent('interaction-ready', {
                interactivePartCount,
                interactivePartNames: this.partRecords.map((record) => record.name),
                reason: this.interactionFailureReason || '',
              });
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

    getElementChildren(element) {
      if (typeof element.getChildrenByFilter === 'function') {
        return element.getChildrenByFilter(() => true);
      }
      return Array.isArray(element._children) ? element._children : [];
    },

    getComponentMesh(target, meshClass) {
      if (meshClass && target.getComponent(meshClass)) return target.getComponent(meshClass);
      if (typeof target.getComponent === 'function') {
        return target.getComponent('mesh');
      }
      return null;
    },

    findFirstMeshElement(element, meshClass) {
      let found = null;
      // glTF Node 可能自身就是 Mesh 节点，必须先检查根元素。
      if (this.getComponentMesh(element, meshClass)) return element;
      if (typeof element.dfs === 'function') {
        element.dfs((target) => {
          if (!found && this.getComponentMesh(target, meshClass)) found = target;
        });
        return found;
      }
      // 兼容缺少 dfs 的旧运行时：手动遍历子元素查找 Mesh
      if (this.getComponentMesh(element, meshClass)) return element;
      const stack = this.getElementChildren(element);
      while (stack.length && !found) {
        const target = stack.pop();
        if (this.getComponentMesh(target, meshClass)) {
          found = target;
        } else {
          for (const child of this.getElementChildren(target)) stack.push(child);
        }
      }
      return found;
    },

    normalizeRuntimeNodeName(name) {
      const value = String(name || '');
      const normalized = typeof value.normalize === 'function' ? value.normalize('NFKC') : value;
      return normalized.replace(/\s+/g, '').toLowerCase();
    },

    getRuntimeNodeMap() {
      const nodeMap = this.gltfComponent && this.gltfComponent._nodeMap;
      return nodeMap && typeof nodeMap.get === 'function' && typeof nodeMap.forEach === 'function'
        ? nodeMap
        : null;
    },

    findRuntimeNodeName(name) {
      const nodeMap = this.getRuntimeNodeMap();
      if (!nodeMap) return name;
      if (nodeMap.get(name)) return name;
      const expected = this.normalizeRuntimeNodeName(name);
      let matchedName = null;
      nodeMap.forEach((entry, runtimeName) => {
        if (
          matchedName === null &&
          this.normalizeRuntimeNodeName(runtimeName) === expected
        ) {
          matchedName = runtimeName;
        }
      });
      return matchedName || name;
    },

    getPartPrimitives(name) {
      if (
        !this.gltfComponent ||
        typeof this.gltfComponent.getPrimitivesByNodeName !== 'function'
      ) {
        return [];
      }
      try {
        const runtimeName = this.findRuntimeNodeName(name);
        const primitives = this.gltfComponent.getPrimitivesByNodeName(runtimeName);
        return Array.isArray(primitives) ? primitives : [];
      } catch (error) {
        console.warn(`[solidworks-assembly] primitive lookup failed: ${name}`, error);
        return [];
      }
    },

    resolvePartBinding(name, xrFrameSystem) {
      const runtimeName = this.findRuntimeNodeName(name);
      const nodeMap = this.getRuntimeNodeMap();
      const runtimeEntry = nodeMap ? nodeMap.get(runtimeName) : null;
      let internalElement = null;
      if (typeof this.gltfComponent.getInternalNodeByName === 'function') {
        try {
          internalElement = this.gltfComponent.getInternalNodeByName(runtimeName);
        } catch (error) {
          console.warn(`[solidworks-assembly] internal node lookup failed: ${name}`, error);
        }
      }

      if (!internalElement && runtimeEntry && runtimeEntry.el) {
        internalElement = runtimeEntry.el;
      }

      const primitives = this.getPartPrimitives(name);
      const runtimePrimitives =
        runtimeEntry && Array.isArray(runtimeEntry.meshes) ? runtimeEntry.meshes : [];
      const primitive = primitives.concat(runtimePrimitives)
        .find((item) => item && item.el);
      const primitiveElement = primitive ? primitive.el : null;
      const candidates = [internalElement, primitiveElement].filter(Boolean);
      for (const element of candidates) {
        if (typeof element.getComponent !== 'function') continue;
        const transform =
          (xrFrameSystem.Transform && element.getComponent(xrFrameSystem.Transform)) ||
          element.getComponent('transform');
        if (transform) {
          return {
            element,
            transform,
            hitElement: primitiveElement || element,
          };
        }
      }
      return null;
    },

    runtimeNodeDiagnostic() {
      const nodeMap = this.getRuntimeNodeMap();
      if (!nodeMap) return 'runtime-map-unavailable';
      const samples = [];
      nodeMap.forEach((entry, name) => {
        if (samples.length < 2 && entry && entry.hasMesh) samples.push(String(name));
      });
      return `runtime-map=${nodeMap.size || 0}${samples.length ? `, sample=${samples.join('|')}` : ''}`;
    },

    async resolvePartRecords(xrFrameSystem) {
      const maxAttempts = 5;
      let lastFailures = [];
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        if (this.disposed || !this.gltfComponent) return [];
        const failures = [];
        const records = config.interactivePartNames
          .map((name) => {
            try {
              const binding = this.resolvePartBinding(name, xrFrameSystem);
              if (!binding) {
                failures.push(`${name}:not-found`);
                return null;
              }
              return {
                name,
                element: binding.element,
                transform: binding.transform,
                hitElement: binding.hitElement,
                basePosition: null,
                explodedPosition: null,
                isExploded: false,
                dragged: false,
                eventsBound: false,
                animationToken: 0,
              };
            } catch (error) {
              failures.push(`${name}:${(error && error.message) || 'error'}`);
              return null;
            }
          })
          .filter(Boolean);
        if (records.length) {
          if (attempt > 1) {
            console.log(`[solidworks-assembly] part nodes resolved on attempt ${attempt}`);
          }
          return records;
        }
        lastFailures = failures;
        console.warn(
          `[solidworks-assembly] part nodes unresolved (attempt ${attempt}/${maxAttempts})`,
          failures.slice(0, 5),
        );
        if (attempt < maxAttempts) await this.waitForPoseUpdate(400);
      }
      this.interactionFailureReason = `零件节点解析失败：${lastFailures[0] || 'unknown'}；${this.runtimeNodeDiagnostic()}`;
      return [];
    },

    async prepareInteractiveParts(xrFrameSystem) {
      this.partRecords = await this.resolvePartRecords(xrFrameSystem);
      if (this.disposed) return 0;

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

      const camera = this.scene ? this.scene.getElementById('camera') : null;
      this.cameraOrbit = camera
        ? camera.getComponent(xrFrameSystem.CameraOrbitControl)
        : null;
      this.cameraTransform = camera
        ? camera.getComponent(xrFrameSystem.Transform)
        : null;
      const cameraComponent = camera
        ? camera.getComponent(xrFrameSystem.Camera)
        : null;
      this.cameraFov = Number(cameraComponent && cameraComponent.fov) || 60;

      const meshClass = xrFrameSystem.Mesh;
      const shapeClass = xrFrameSystem.CubeShape;
      const failures = [];
      const noteFailure = (stage, name, reason) => {
        failures.push({ stage, name, reason });
      };
      if (typeof shapeClass !== 'function') {
        noteFailure('shape-class', '-', 'xrFrameSystem.CubeShape 不可用');
      }

      const interactiveRecords = [];
      if (typeof shapeClass === 'function') {
        for (let index = 0; index < this.partRecords.length; index += 1) {
          const record = this.partRecords[index];
          try {
            const hitElement =
              record.hitElement ||
              this.findFirstMeshElement(record.element, meshClass);
            if (!hitElement) {
              noteFailure('mesh', record.name, '零件子树中未找到 Mesh 元素');
              continue;
            }
            if (!hitElement.event || typeof hitElement.event.add !== 'function') {
              noteFailure('event', record.name, '元素事件中心不可用');
              continue;
            }
            let shape = hitElement.getComponent(shapeClass);
            if (!shape) {
              shape = hitElement.addComponent(shapeClass, { autoFit: true });
            }
            if (!shape) {
              noteFailure('shape', record.name, 'addComponent 未返回组件');
              continue;
            }
            if (!record.eventsBound) {
              hitElement.event.add('touch-shape', (event) => this.handlePartTouch(record, event));
              hitElement.event.add('drag-shape', (event) => this.handlePartDrag(record, event));
              hitElement.event.add('untouch-shape', () => this.handlePartUntouch(record));
              record.eventsBound = true;
            }
            interactiveRecords.push(record);
          } catch (error) {
            noteFailure('collider', record.name, (error && error.message) || String(error));
          }
          if ((index + 1) % 5 === 0) await this.waitForPoseUpdate(16);
          if (this.disposed) return 0;
        }
      }
      this.partRecords = interactiveRecords;
      if (failures.length) {
        this.interactionFailureReason = `${failures.length} 个零件初始化失败：${failures[0].stage}(${failures[0].reason})`;
      } else if (!interactiveRecords.length && !this.interactionFailureReason) {
        this.interactionFailureReason = '配置中的零件节点均未在模型中解析到';
      }
      console.log('[solidworks-assembly] interactive parts ready', {
        configured: config.interactivePartNames.length,
        resolved: interactiveRecords.length,
        failures,
      });
      return interactiveRecords.length;
    },

    eventPayload(event) {
      if (!event) return {};
      return event.detail ? event.detail.value || event.detail : event.value || event;
    },

    setCameraOrbitLocked(locked) {
      const orbit = this.cameraOrbit;
      if (!orbit) return;
      // 规避运行时缺陷：CameraOrbitControl.disable() 只摘除 touchstart/wheel，
      // 进行中手势的 touchmove/touchend 仍会驱动相机旋转，需手动清理，
      // 并配合 isLock* 开关确保拖动零件时相机完全静止。
      if (orbit._mouseInfo) orbit._mouseInfo.isDown = false;
      if (this.scene && this.scene.event) {
        if (orbit._handleTouchMove) {
          this.scene.event.remove('touchmove', orbit._handleTouchMove);
        }
        if (orbit._handleTouchEnd) {
          this.scene.event.remove('touchend', orbit._handleTouchEnd);
        }
      }
      orbit.isLockRotate = locked;
      orbit.isLockMove = locked;
      orbit.isLockZoom = locked;
      if (locked) {
        if (typeof orbit.disable === 'function') orbit.disable();
      } else if (typeof orbit.enable === 'function') {
        orbit.enable();
      }
    },

    getDragScale(record) {
      const fallbackStep = 0.00075;
      const cameraTransform = this.cameraTransform;
      const scene = this.scene;
      if (!cameraTransform || !scene) return fallbackStep;
      const partWorld = record.transform.worldPosition;
      const cameraWorld = cameraTransform.worldPosition;
      const dx = partWorld.x - cameraWorld.x;
      const dy = partWorld.y - cameraWorld.y;
      const dz = partWorld.z - cameraWorld.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const fovRad = ((Number(this.cameraFov) || 60) * Math.PI) / 180;
      const sceneHeight = Math.max(1, Number(scene.height) || 667);
      const worldPerPixel = (2 * distance * Math.tan(fovRad / 2)) / sceneHeight;
      const worldScale = record.transform.worldScale;
      const scale =
        (Math.abs(worldScale.x) + Math.abs(worldScale.y) + Math.abs(worldScale.z)) / 3;
      if (!Number.isFinite(scale) || scale < 1e-6) return fallbackStep;
      return worldPerPixel / scale;
    },

    touchPointFromEvent(event) {
      const payload = this.eventPayload(event);
      const touch =
        (payload.changedTouches && payload.changedTouches[0]) ||
        (payload.touches && payload.touches[0]);
      if (touch) {
        return {
          x: Number(touch.x != null ? touch.x : touch.pageX) || 0,
          y: Number(touch.y != null ? touch.y : touch.pageY) || 0,
        };
      }
      return {
        x: Number(payload.x) || 0,
        y: Number(payload.y) || 0,
      };
    },

    startRawPartDrag(record, event) {
      this.stopRawPartDrag();
      if (!this.scene || !this.scene.event) return false;
      const point = this.touchPointFromEvent(event);
      this.rawPartDragActive = true;
      this.rawPartDragPoint = point;
      this.rawPartMoveHandler = (moveEvent) => {
        if (!this.rawPartDragActive || this.activePart !== record) return;
        const nextPoint = this.touchPointFromEvent(moveEvent);
        const deltaX = nextPoint.x - this.rawPartDragPoint.x;
        const deltaY = nextPoint.y - this.rawPartDragPoint.y;
        this.rawPartDragPoint = nextPoint;
        this.applyPartDragDelta(record, deltaX, deltaY);
      };
      this.rawPartEndHandler = () => this.handlePartUntouch(record);
      this.scene.event.add('touchmove', this.rawPartMoveHandler);
      this.scene.event.addOnce('touchend', this.rawPartEndHandler);
      return true;
    },

    stopRawPartDrag() {
      if (this.scene && this.scene.event) {
        if (this.rawPartMoveHandler) {
          this.scene.event.remove('touchmove', this.rawPartMoveHandler);
        }
        if (this.rawPartEndHandler) {
          this.scene.event.remove('touchend', this.rawPartEndHandler);
        }
      }
      this.rawPartDragActive = false;
      this.rawPartDragPoint = null;
      this.rawPartMoveHandler = null;
      this.rawPartEndHandler = null;
    },

    handlePartTouch(record, event) {
      if (!this.ready || this.animating) return;
      this.activePart = record;
      record.dragged = false;
      this.setCameraOrbitLocked(true);
      this.startRawPartDrag(record, event);
      this.triggerEvent('part-selected', {
        name: record.name,
        action: 'selected',
      });
    },

    handlePartDrag(record, event) {
      if (!this.ready || this.animating || this.activePart !== record) return;
      // 原始 touchmove 已接管时忽略合成 drag-shape，避免同一位移应用两次。
      if (this.rawPartDragActive) return;
      const payload = this.eventPayload(event);
      const deltaX = Number(payload.deltaX) || 0;
      const deltaY = Number(payload.deltaY) || 0;
      this.applyPartDragDelta(record, deltaX, deltaY);
    },

    applyPartDragDelta(record, deltaX, deltaY) {
      if (!deltaX && !deltaY) return;
      const wasDragged = record.dragged;
      record.animationToken += 1;
      record.dragged = true;
      const step = this.getDragScale(record);
      const right = this.cameraTransform
        ? this.cameraTransform.worldRight
        : { x: 1, y: 0, z: 0 };
      const up = this.cameraTransform
        ? this.cameraTransform.worldUp
        : { x: 0, y: 1, z: 0 };
      const position = record.transform.position;
      position.x += (right.x * deltaX - up.x * deltaY) * step;
      position.y += (right.y * deltaX - up.y * deltaY) * step;
      position.z += (right.z * deltaX - up.z * deltaY) * step;
      if (!wasDragged) {
        this.triggerEvent('part-selected', {
          name: record.name,
          action: 'dragging',
        });
      }
    },

    handlePartUntouch(record) {
      this.stopRawPartDrag();
      this.setCameraOrbitLocked(false);
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

    setPartPosition(name, mode) {
      if (!this.ready || this.animating) return false;
      const record = (this.partRecords || []).find((item) => item.name === name);
      if (!record) return false;
      const moveToExploded = mode === 'exploded';
      record.isExploded = moveToExploded;
      const target = moveToExploded
        ? record.explodedPosition
        : record.basePosition;
      return this.animatePartTo(
        record,
        target,
        moveToExploded ? 'exploded' : 'complete',
      );
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
      this.setCameraOrbitLocked(false);
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
