const {
  ASSEMBLY_LAYOUTS,
  ASSEMBLY_PARTS,
} = require('../../config/assembly_demo');
const {
  interpolateVector,
  vectorToAttribute,
} = require('../../utils/assembly_animation');

const FRAME_INTERVAL_MS = 32;
const PART_ANIMATION_MS = 480;
const GROUP_ANIMATION_MS = 720;

function createParts(layoutName) {
  const layout = ASSEMBLY_LAYOUTS[layoutName];
  return ASSEMBLY_PARTS.map((part) => ({
    ...part,
    position: layout[part.id].slice(),
    positionText: vectorToAttribute(layout[part.id]),
    rotationText: vectorToAttribute(part.rotation),
  }));
}

Component({
  data: {
    parts: createParts('complete'),
  },

  lifetimes: {
    detached() {
      this.disposed = true;
      this.cancelAnimation();
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

    handleAssetsLoaded() {
      this.triggerEvent('assets-loaded');
    },

    handleAssetsError(event) {
      console.error('[assembly-demo] asset load failed:', event);
      this.triggerEvent('model-error', { message: '爆炸图模型资源加载失败' });
    },

    handleGltfLoaded(event) {
      this.triggerEvent('part-loaded', {
        partId: event.currentTarget.dataset.partId,
      });
    },

    handleGltfError(event) {
      const partId = event.currentTarget.dataset.partId;
      console.error('[assembly-demo] glTF parse failed:', partId, event);
      this.triggerEvent('model-error', {
        partId,
        message: `${partId} 模型解析失败`,
      });
    },

    async playMode(mode) {
      if (!ASSEMBLY_LAYOUTS[mode] || this.animating) return false;
      this.animating = true;
      this.animationToken = (this.animationToken || 0) + 1;
      const token = this.animationToken;
      this.triggerEvent('animation-start', { mode });

      try {
        if (mode === 'exploded') {
          await this.animatePartTo('pin', ASSEMBLY_LAYOUTS.exploded.pin, token);
          await this.animatePartTo('support', ASSEMBLY_LAYOUTS.exploded.support, token);
          await this.animatePartTo('base', ASSEMBLY_LAYOUTS.exploded.base, token);
        } else if (mode === 'complete') {
          await this.animatePartTo('base', ASSEMBLY_LAYOUTS.complete.base, token);
          await this.animatePartTo('support', ASSEMBLY_LAYOUTS.complete.support, token);
          await this.animatePartTo('pin', ASSEMBLY_LAYOUTS.complete.pin, token);
        } else {
          await this.animateAllTo(ASSEMBLY_LAYOUTS[mode], token);
        }
      } catch (error) {
        if (error.message !== 'ANIMATION_CANCELLED') throw error;
        return false;
      } finally {
        if (this.animationToken === token) this.animating = false;
      }

      if (!this.disposed && this.animationToken === token) {
        this.triggerEvent('animation-end', { mode });
        return true;
      }
      return false;
    },

    playInstall() {
      return this.playMode('complete');
    },

    playExplode() {
      return this.playMode('exploded');
    },

    playSection() {
      return this.playMode('section');
    },

    showComplete() {
      return this.playMode('complete');
    },

    animatePartTo(partId, target, token) {
      const index = this.data.parts.findIndex((part) => part.id === partId);
      if (index < 0) return Promise.resolve();
      return this.animateVectors(
        [{ index, from: this.data.parts[index].position.slice(), to: target }],
        PART_ANIMATION_MS,
        token,
      );
    },

    animateAllTo(layout, token) {
      const vectors = this.data.parts.map((part, index) => ({
        index,
        from: part.position.slice(),
        to: layout[part.id],
      }));
      return this.animateVectors(vectors, GROUP_ANIMATION_MS, token);
    },

    animateVectors(vectors, duration, token) {
      const startedAt = Date.now();
      return new Promise((resolve, reject) => {
        const step = () => {
          if (this.disposed || this.animationToken !== token) {
            reject(new Error('ANIMATION_CANCELLED'));
            return;
          }

          const progress = Math.min((Date.now() - startedAt) / duration, 1);
          const updates = {};
          vectors.forEach(({ index, from, to }) => {
            const position = interpolateVector(from, to, progress);
            updates[`parts[${index}].position`] = position;
            updates[`parts[${index}].positionText`] = vectorToAttribute(position);
          });
          this.setData(updates);

          if (progress >= 1) {
            resolve();
            return;
          }
          this.animationTimer = setTimeout(step, FRAME_INTERVAL_MS);
        };
        step();
      });
    },

    cancelAnimation() {
      clearTimeout(this.animationTimer);
      this.animationTimer = null;
      this.animationToken = (this.animationToken || 0) + 1;
      this.animating = false;
    },

    handleSceneLog({ detail }) {
      console.log('[assembly-demo]', detail && detail.value);
    },
  },
});
