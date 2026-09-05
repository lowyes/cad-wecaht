const config = require('../../config/assembly_0001');

const FRAME_INTERVAL_MS = 32;
const PART_MOVE_DURATION_MS = 620;
const POSITION_EPSILON_SQUARED = 1e-10;

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
      clearTimeout(this.completionTimer);
      clearTimeout(this.interactionStartTimer);
      this.cancelAllPartAnimations();
      this.releasePartEventBindings();
      this.stopRawPartDrag();
      this.animationTimer = null;
      this.completionTimer = null;
      this.interactionStartTimer = null;
      this.animator = null;
      this.gltfComponent = null;
      this.runtimeMeshBindings = null;
      this.runtimeMeshBindingsOwner = null;
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
        // 真机远程调试下，类引用可能与 RenderContext 中已挂载组件的类
        // 不是同一个引用；此时按类取得的 GLTF 组件内部节点表可能为空。
        // 字符串名称是 XR-FRAME 注册组件时使用的稳定键，应优先使用。
        this.animator =
          model.getComponent('animator') ||
          model.getComponent(xrFrameSystem.Animator);
        this.gltfComponent =
          model.getComponent('gltf') ||
          model.getComponent(xrFrameSystem.GLTF);
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
        this.interactionStartTimer = setTimeout(() => {
          this.interactionStartTimer = null;
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

    positionDistanceSquared(left, right) {
      if (!left || !right) return Number.POSITIVE_INFINITY;
      const dx = left[0] - right[0];
      const dy = left[1] - right[1];
      const dz = left[2] - right[2];
      return dx * dx + dy * dy + dz * dz;
    },

    getElementComponent(element, name, componentClass) {
      if (!element || typeof element.getComponent !== 'function') return null;
      try {
        const byName = name ? element.getComponent(name) : null;
        if (byName) return byName;
      } catch (error) {
        console.warn(`[solidworks-assembly] component lookup failed: ${name}`, error);
      }
      if (!componentClass) return null;
      try {
        return element.getComponent(componentClass) || null;
      } catch (error) {
        console.warn('[solidworks-assembly] class component lookup failed', error);
        return null;
      }
    },

    getElementChildren(element) {
      if (typeof element.getChildrenByFilter === 'function') {
        return element.getChildrenByFilter(() => true);
      }
      return Array.isArray(element._children) ? element._children : [];
    },

    getComponentMesh(target, meshClass) {
      return this.getElementComponent(target, 'mesh', meshClass);
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
      if (nodeMap && nodeMap.get(name)) return name;
      const expected = this.normalizeRuntimeNodeName(name);
      let matchedName = null;
      if (nodeMap) {
        nodeMap.forEach((entry, runtimeName) => {
          if (
            matchedName === null &&
            this.normalizeRuntimeNodeName(runtimeName) === expected
          ) {
            matchedName = runtimeName;
          }
        });
      }
      if (!matchedName) {
        const runtimeElement = this.findRuntimeElement(name);
        if (runtimeElement && runtimeElement.name) matchedName = runtimeElement.name;
      }
      return matchedName || name;
    },

    findRuntimeElement(name) {
      const expected = this.normalizeRuntimeNodeName(name);
      const roots =
        this.gltfComponent && Array.isArray(this.gltfComponent._subRoots)
          ? this.gltfComponent._subRoots.slice()
          : [];
      const stack = roots;
      while (stack.length) {
        const element = stack.pop();
        if (!element) continue;
        if (this.normalizeRuntimeNodeName(element.name) === expected) return element;
        for (const child of this.getElementChildren(element)) stack.push(child);
      }
      return null;
    },

    getRuntimeMeshBindings() {
      if (
        this.runtimeMeshBindings &&
        this.runtimeMeshBindingsOwner === this.gltfComponent
      ) {
        return this.runtimeMeshBindings;
      }
      const meshes =
        this.gltfComponent && Array.isArray(this.gltfComponent.meshes)
          ? this.gltfComponent.meshes
          : [];
      const bindings = [];
      const seenElements = [];
      for (const mesh of meshes) {
        const hitElement = mesh && mesh.el;
        if (!hitElement) continue;
        // XR-FRAME 实例化 glTF 时，每个 primitive Mesh 元素的父元素就是
        // 对应的 glTF Node。GLTF.meshes 是公开接口，在 Android 真机上也
        // 可用；不再依赖可能为空的私有 _nodeMap / _subRoots。
        const element = hitElement._parent || hitElement.parent || hitElement;
        const existingIndex = seenElements.indexOf(element);
        if (existingIndex >= 0) {
          bindings[existingIndex].hitElements.push(hitElement);
          continue;
        }
        seenElements.push(element);
        bindings.push({ element, hitElement, hitElements: [hitElement] });
      }
      this.runtimeMeshBindings = bindings;
      this.runtimeMeshBindingsOwner = this.gltfComponent;
      return bindings;
    },

    findRuntimeMeshBinding(name, partIndex) {
      const expected = this.normalizeRuntimeNodeName(name);
      const bindings = this.getRuntimeMeshBindings();
      const namedBinding = bindings.find(
        (binding) => this.normalizeRuntimeNodeName(binding.element.name) === expected,
      );
      if (namedBinding) return namedBinding;

      const ordinals = config.interactivePartMeshOrdinals || [];
      const ordinal = Number(ordinals[partIndex]);
      return Number.isInteger(ordinal) ? bindings[ordinal] || null : null;
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

    resolvePartBinding(name, xrFrameSystem, partIndex = -1) {
      const runtimeName = this.findRuntimeNodeName(name);
      const nodeMap = this.getRuntimeNodeMap();
      const runtimeEntry = nodeMap ? nodeMap.get(runtimeName) : null;
      const meshBinding = this.findRuntimeMeshBinding(name, partIndex);
      let internalElement =
        (runtimeEntry && runtimeEntry.el) ||
        this.findRuntimeElement(runtimeName) ||
        (meshBinding && meshBinding.element);
      // 官方方法内部直接读取 this._nodeMap.get(name).el，没有空值保护。
      // 只有确认节点表存在该名称时才调用，避免真机因 undefined.el 中断。
      if (
        !internalElement &&
        runtimeEntry &&
        typeof this.gltfComponent.getInternalNodeByName === 'function'
      ) {
        try {
          internalElement = this.gltfComponent.getInternalNodeByName(runtimeName);
        } catch (error) {
          console.warn(`[solidworks-assembly] internal node lookup failed: ${name}`, error);
        }
      }

      const primitives = this.getPartPrimitives(name);
      const runtimePrimitives =
        runtimeEntry && Array.isArray(runtimeEntry.meshes) ? runtimeEntry.meshes : [];
      const primitive = primitives.concat(runtimePrimitives)
        .find((item) => item && item.el);
      const primitiveElement = primitive
        ? primitive.el
        : meshBinding && meshBinding.hitElement;
      const hitElements = [];
      for (const item of primitives.concat(runtimePrimitives)) {
        if (item && item.el && hitElements.indexOf(item.el) < 0) {
          hitElements.push(item.el);
        }
      }
      for (const element of (meshBinding && meshBinding.hitElements) || []) {
        if (element && hitElements.indexOf(element) < 0) hitElements.push(element);
      }
      if (!hitElements.length && primitiveElement) hitElements.push(primitiveElement);
      const candidates = [internalElement, primitiveElement].filter(Boolean);
      for (const element of candidates) {
        const transform = this.getElementComponent(
          element,
          'transform',
          xrFrameSystem.Transform,
        );
        if (transform) {
          return {
            element,
            transform,
            hitElement: primitiveElement || element,
            hitElements,
          };
        }
      }
      return null;
    },

    runtimeNodeDiagnostic() {
      const nodeMap = this.getRuntimeNodeMap();
      const samples = [];
      if (nodeMap) {
        nodeMap.forEach((entry, name) => {
          if (samples.length < 2 && entry && entry.hasMesh) samples.push(String(name));
        });
      }
      const roots =
        this.gltfComponent && Array.isArray(this.gltfComponent._subRoots)
          ? this.gltfComponent._subRoots
          : [];
      const meshBindings = this.getRuntimeMeshBindings();
      return `runtime-map=${nodeMap ? nodeMap.size || 0 : 'unavailable'}, roots=${roots.length}, mesh-bindings=${meshBindings.length}${samples.length ? `, sample=${samples.join('|')}` : ''}`;
    },

    async resolvePartRecords(xrFrameSystem) {
      const maxAttempts = 10;
      let lastFailures = [];
      let bestRecords = [];
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        if (this.disposed || !this.gltfComponent) return [];
        // meshes 在部分 Android 机型上会晚于 gltf-loaded 一到数帧可见。
        // 每轮重试必须刷新缓存，否则第一次得到的空列表会被永久复用。
        this.runtimeMeshBindings = null;
        this.runtimeMeshBindingsOwner = null;
        const failures = [];
        const records = config.interactivePartNames
          .map((name, partIndex) => {
            try {
              const binding = this.resolvePartBinding(name, xrFrameSystem, partIndex);
              if (!binding) {
                failures.push(`${name}:not-found`);
                return null;
              }
              return {
                name,
                element: binding.element,
                transform: binding.transform,
                hitElement: binding.hitElement,
                hitElements: binding.hitElements,
                basePosition: null,
                explodedPosition: null,
                isExploded: false,
                dragged: false,
                eventBindings: [],
                eventsBound: false,
                animationToken: 0,
              };
            } catch (error) {
              failures.push(`${name}:${(error && error.message) || 'error'}`);
              return null;
            }
          })
          .filter(Boolean);
        if (records.length > bestRecords.length) bestRecords = records;
        if (records.length === config.interactivePartNames.length) {
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
      if (bestRecords.length) {
        this.interactionFailureReason = `已解析 ${bestRecords.length}/${config.interactivePartNames.length} 个零件节点；${this.runtimeNodeDiagnostic()}`;
        return bestRecords;
      }
      this.interactionFailureReason = `零件节点解析失败：${lastFailures[0] || 'unknown'}；${this.runtimeNodeDiagnostic()}`;
      return [];
    },

    async waitForGlobalAnimationIdle() {
      const maxWaitMs = config.durationMs + 1200;
      const startedAt = Date.now();
      while (this.animating && !this.disposed) {
        if (Date.now() - startedAt >= maxWaitMs) return false;
        await this.waitForPoseUpdate(50);
      }
      return !this.disposed;
    },

    installPartInteraction(record, xrFrameSystem) {
      const meshClass = xrFrameSystem.Mesh;
      const shapeClass = xrFrameSystem.CubeShape;
      const shapeInteractClass = xrFrameSystem.ShapeInteract;
      const hitElements = Array.isArray(record.hitElements)
        ? record.hitElements.filter(Boolean)
        : [];
      if (!hitElements.length && record.hitElement) {
        hitElements.push(record.hitElement);
      }
      if (!hitElements.length) {
        const fallbackElement = this.findFirstMeshElement(record.element, meshClass);
        if (fallbackElement) hitElements.push(fallbackElement);
      }
      if (!hitElements.length) {
        return { stage: 'mesh', reason: '零件子树中未找到 Mesh 元素' };
      }
      const uniqueHitElements = hitElements.filter(
        (element, index) => hitElements.indexOf(element) === index,
      );
      const bindings = Array.isArray(record.eventBindings)
        ? record.eventBindings
        : [];
      const initialBindingCount = bindings.length;
      const rollbackNewBindings = () => {
        for (const binding of bindings.slice(initialBindingCount)) {
          const event = binding.element && binding.element.event;
          if (!event || typeof event.remove !== 'function') continue;
          event.remove('touch-shape', binding.touch);
          event.remove('drag-shape', binding.drag);
          event.remove('untouch-shape', binding.untouch);
        }
        bindings.splice(initialBindingCount);
      };
      const fail = (stage, reason) => {
        rollbackNewBindings();
        return { stage, reason };
      };
      try {
        for (const hitElement of uniqueHitElements) {
          if (
            !hitElement.event ||
            typeof hitElement.event.add !== 'function' ||
            typeof hitElement.addComponent !== 'function'
          ) {
            return fail('event', '元素事件或组件接口不可用');
          }

          // Shape 只负责碰撞体；没有 ShapeInteract 时运行时会把
          // nativeCollider.interactType 保持为 None，射线不会产生触摸事件。
          let shapeInteract = this.getElementComponent(
            hitElement,
            'shape-interact',
            shapeInteractClass,
          );
          if (!shapeInteract) {
            shapeInteract = hitElement.addComponent(shapeInteractClass, {
              disabled: false,
              collide: false,
            });
          }
          if (!shapeInteract) {
            return fail('shape-interact', 'addComponent 未返回组件');
          }

          let shape = this.getElementComponent(
            hitElement,
            'cube-shape',
            shapeClass,
          );
          if (!shape) {
            shape = hitElement.addComponent(shapeClass, { autoFit: true });
          }
          if (!shape) {
            return fail('shape', 'addComponent 未返回组件');
          }
          if (bindings.some((binding) => binding.element === hitElement)) continue;
          const handlers = {
            touch: (event) => this.handlePartTouch(record, event),
            drag: (event) => this.handlePartDrag(record, event),
            untouch: () => this.handlePartUntouch(record),
          };
          hitElement.event.add('touch-shape', handlers.touch);
          hitElement.event.add('drag-shape', handlers.drag);
          hitElement.event.add('untouch-shape', handlers.untouch);
          bindings.push({ element: hitElement, ...handlers });
        }
      } catch (error) {
        rollbackNewBindings();
        throw error;
      }
      record.hitElements = uniqueHitElements;
      record.hitElement = uniqueHitElements[0];
      record.eventBindings = bindings;
      record.eventsBound = bindings.length > 0;
      return null;
    },

    releasePartEventBindings() {
      for (const record of this.partRecords || []) {
        for (const binding of record.eventBindings || []) {
          const event = binding.element && binding.element.event;
          if (!event || typeof event.remove !== 'function') continue;
          event.remove('touch-shape', binding.touch);
          event.remove('drag-shape', binding.drag);
          event.remove('untouch-shape', binding.untouch);
        }
        record.eventBindings = [];
        record.eventsBound = false;
      }
    },

    async prepareInteractiveParts(xrFrameSystem) {
      this.interactionFailureReason = '';
      this.partRecords = await this.resolvePartRecords(xrFrameSystem);
      if (this.disposed) return 0;

      if (!(await this.waitForGlobalAnimationIdle())) {
        throw new Error('等待整体动画结束超时');
      }

      this.interactionPoseSampling = true;
      const restoreProgress = Math.max(
        0,
        Math.min(1, Number(this.animationProgress) || 0),
      );
      try {
        this.applyAnimationProgress(0);
        await this.waitForPoseUpdate();
        for (const record of this.partRecords) {
          record.basePosition = this.clonePosition(record.transform);
        }
        this.applyAnimationProgress(1);
        await this.waitForPoseUpdate();
        for (const record of this.partRecords) {
          record.explodedPosition = this.clonePosition(record.transform);
        }
        this.applyAnimationProgress(restoreProgress);
        await this.waitForPoseUpdate();
        if (restoreProgress <= 0) this.syncPartEndpointState(false);
        if (restoreProgress >= 1) this.syncPartEndpointState(true);
      } finally {
        this.interactionPoseSampling = false;
      }
      if (this.disposed) return 0;

      const camera = this.scene ? this.scene.getElementById('camera') : null;
      this.cameraOrbit = this.getElementComponent(
        camera,
        'camera-orbit-control',
        xrFrameSystem.CameraOrbitControl,
      );
      this.cameraOrbitLocked = false;
      this.cameraTransform = this.getElementComponent(
        camera,
        'transform',
        xrFrameSystem.Transform,
      );
      const cameraComponent = this.getElementComponent(
        camera,
        'camera',
        xrFrameSystem.Camera,
      );
      this.cameraFov = Number(cameraComponent && cameraComponent.fov) || 60;

      const shapeClass = xrFrameSystem.CubeShape;
      const shapeInteractClass = xrFrameSystem.ShapeInteract;
      const failures = [];
      const noteFailure = (stage, name, reason) => {
        failures.push({ stage, name, reason });
      };
      if (typeof shapeClass !== 'function') {
        noteFailure('shape-class', '-', 'xrFrameSystem.CubeShape 不可用');
      }
      if (typeof shapeInteractClass !== 'function') {
        noteFailure('interact-class', '-', 'xrFrameSystem.ShapeInteract 不可用');
      }

      const interactiveRecords = [];
      if (
        typeof shapeClass === 'function' &&
        typeof shapeInteractClass === 'function'
      ) {
        for (let index = 0; index < this.partRecords.length; index += 1) {
          const record = this.partRecords[index];
          try {
            const failure = this.installPartInteraction(record, xrFrameSystem);
            if (failure) {
              noteFailure(failure.stage, record.name, failure.reason);
              continue;
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
      if (this.cameraOrbitLocked === locked) return;
      this.cameraOrbitLocked = locked;
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
      if (!partWorld || !cameraWorld) return fallbackStep;
      const dx = partWorld.x - cameraWorld.x;
      const dy = partWorld.y - cameraWorld.y;
      const dz = partWorld.z - cameraWorld.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const fovRad = ((Number(this.cameraFov) || 60) * Math.PI) / 180;
      const sceneHeight = Math.max(1, Number(scene.height) || 667);
      const worldPerPixel = (2 * distance * Math.tan(fovRad / 2)) / sceneHeight;
      const worldScale = record.transform.worldScale;
      if (!worldScale) return fallbackStep;
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
        const x = Number(touch.x != null ? touch.x : touch.pageX);
        const y = Number(touch.y != null ? touch.y : touch.pageY);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        return {
          x,
          y,
        };
      }
      const x = Number(payload.x);
      const y = Number(payload.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return {
        x,
        y,
      };
    },

    applyPartDragPoint(record, point) {
      if (!point) return false;
      const previous = this.rawPartDragPoint;
      this.rawPartDragPoint = point;
      if (!previous) return false;
      this.applyPartDragDelta(
        record,
        point.x - previous.x,
        point.y - previous.y,
      );
      return true;
    },

    startRawPartDrag(record, event) {
      this.stopRawPartDrag();
      if (!this.scene || !this.scene.event) return false;
      const point = this.touchPointFromEvent(event);
      if (!point) return false;
      if (
        typeof this.scene.event.add !== 'function' ||
        typeof this.scene.event.remove !== 'function'
      ) {
        return false;
      }
      this.rawPartDragActive = true;
      this.rawPartDragPoint = point;
      this.rawPartMoveHandler = (moveEvent) => {
        if (!this.rawPartDragActive || this.activePart !== record) return;
        this.applyPartDragPoint(record, this.touchPointFromEvent(moveEvent));
      };
      this.rawPartEndHandler = () => this.handlePartUntouch(record);
      this.scene.event.add('touchmove', this.rawPartMoveHandler);
      // 不使用 addOnce：部分事件实现会包装原回调，取消拖动时无法再用
      // 原函数 remove，容易留下悬挂的 touchend 监听。
      this.scene.event.add('touchend', this.rawPartEndHandler);
      return true;
    },

    stopRawPartDrag() {
      if (
        this.scene &&
        this.scene.event &&
        typeof this.scene.event.remove === 'function'
      ) {
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
      const payload = this.eventPayload(event);
      // 原始 touchmove 和 drag-shape 在不同真机上的触发顺序并不固定。
      // 两路都用绝对触点更新同一个 lastPoint，同一帧的第二次回调增量为 0，
      // 因此既能互为回退，也不会重复移动。
      const point = this.touchPointFromEvent(event);
      if (point && this.rawPartDragPoint) {
        this.applyPartDragPoint(record, point);
        return;
      }
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
      const configuredDirection = Array.isArray(config.dragScreenDirection)
        ? config.dragScreenDirection
        : [1, 1];
      const screenDeltaX = deltaX * (Number(configuredDirection[0]) < 0 ? -1 : 1);
      const screenDeltaY = deltaY * (Number(configuredDirection[1]) < 0 ? -1 : 1);
      const right = this.cameraTransform
        ? this.cameraTransform.worldRight
        : { x: 1, y: 0, z: 0 };
      const up = this.cameraTransform
        ? this.cameraTransform.worldUp
        : { x: 0, y: 1, z: 0 };
      const position = record.transform.position;
      position.x += (right.x * screenDeltaX - up.x * screenDeltaY) * step;
      position.y += (right.y * screenDeltaX - up.y * screenDeltaY) * step;
      position.z += (right.z * screenDeltaX - up.z * screenDeltaY) * step;
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
      const currentPosition = this.clonePosition(record.transform);
      const distanceToBase = this.positionDistanceSquared(
        currentPosition,
        record.basePosition,
      );
      const distanceToExploded = this.positionDistanceSquared(
        currentPosition,
        record.explodedPosition,
      );
      const moveToExploded = distanceToBase <= distanceToExploded;
      const target = moveToExploded
        ? record.explodedPosition
        : record.basePosition;
      return this.animatePartTo(
        record,
        target,
        moveToExploded ? 'exploded' : 'complete',
      );
    },

    setPartPosition(name, mode) {
      if (!this.ready || this.animating || this.interactionPoseSampling) return false;
      if (mode !== 'exploded' && mode !== 'complete') return false;
      const record = (this.partRecords || []).find((item) => item.name === name);
      if (!record) return false;
      const moveToExploded = mode === 'exploded';
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
      clearTimeout(record.animationTimer);
      const token = record.animationToken;
      const start = this.clonePosition(record.transform);
      const startedAt = Date.now();
      const durationMs = PART_MOVE_DURATION_MS;
      this.triggerEvent('part-selected', {
        name: record.name,
        action: state === 'exploded' ? 'moving-out' : 'moving-back',
      });
      if (this.positionDistanceSquared(start, target) <= POSITION_EPSILON_SQUARED) {
        this.setTransformPosition(record.transform, target);
        record.isExploded = state === 'exploded';
        this.triggerEvent('part-selected', { name: record.name, action: state });
        return true;
      }
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
          record.animationTimer = null;
          record.isExploded = state === 'exploded';
          this.triggerEvent('part-selected', {
            name: record.name,
            action: state,
          });
          return;
        }
        record.animationTimer = setTimeout(tick, FRAME_INTERVAL_MS);
      };
      record.animationTimer = setTimeout(tick, 0);
      return true;
    },

    cancelAllPartAnimations() {
      this.stopRawPartDrag();
      for (const record of this.partRecords || []) {
        record.animationToken += 1;
        clearTimeout(record.animationTimer);
        record.animationTimer = null;
      }
      this.setCameraOrbitLocked(false);
      this.activePart = null;
    },

    syncPartEndpointState(isExploded) {
      for (const record of this.partRecords || []) {
        record.isExploded = isExploded;
      }
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
      this.cancelAllPartAnimations();
      this.animationToken = (this.animationToken || 0) + 1;
      clearTimeout(this.animationTimer);
      this.animationTimer = null;
      this.animating = false;
      const applied = this.applyAnimationProgress(progress);
      if (!applied) return false;
      if (this.animationProgress <= 0) this.syncPartEndpointState(false);
      if (this.animationProgress >= 1) this.syncPartEndpointState(true);
      return true;
    },

    animateToProgress(targetProgress, mode) {
      if (
        !this.ready ||
        !this.animator ||
        this.animating ||
        this.interactionPoseSampling
      ) {
        return false;
      }
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
        this.animationTimer = setTimeout(tick, FRAME_INTERVAL_MS);
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
        this.syncPartEndpointState(isExploded);
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
      if (!this.ready || this.animating || this.interactionPoseSampling) return false;
      if (!this.setAnimationProgress(0)) return false;
      this.triggerEvent('animation-start', { mode: 'complete' });
      clearTimeout(this.completionTimer);
      this.completionTimer = setTimeout(() => {
        this.completionTimer = null;
        if (!this.disposed) this.triggerEvent('animation-end', { mode: 'complete' });
      }, 80);
      return true;
    },

    handleSceneLog({ detail }) {
      console.log('[solidworks-assembly]', detail && detail.value);
    },
  },
});
