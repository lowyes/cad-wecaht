'use strict';

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

const COMPONENT_READERS = {
  5120: { bytes: 1, read: (view, offset) => view.getInt8(offset) },
  5121: { bytes: 1, read: (view, offset) => view.getUint8(offset) },
  5122: { bytes: 2, read: (view, offset) => view.getInt16(offset, true) },
  5123: { bytes: 2, read: (view, offset) => view.getUint16(offset, true) },
  5125: { bytes: 4, read: (view, offset) => view.getUint32(offset, true) },
  5126: { bytes: 4, read: (view, offset) => view.getFloat32(offset, true) },
};

const EXPLODE_WORDS = [
  'explode',
  'exploded',
  'disassemble',
  'disassembly',
  'remove',
  'open',
  '爆炸',
  '拆卸',
  '拆分',
  '展开',
];

const INSTALL_WORDS = [
  'collapse',
  'assemble',
  'assembly',
  'install',
  'close',
  'complete',
  '安装',
  '装配',
  '收拢',
  '复位',
  '完整',
];

function parseGlb(buffer) {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);
  if (buffer.length < 20) throw new Error('GLB 文件过短');
  if (buffer.readUInt32LE(0) !== GLB_MAGIC) {
    throw new Error('文件不是有效的 GLB');
  }
  if (buffer.readUInt32LE(4) !== 2) {
    throw new Error('只支持 glTF 2.0 GLB');
  }
  if (buffer.readUInt32LE(8) !== buffer.length) {
    throw new Error('GLB 头部长度与实际文件不一致');
  }

  let offset = 12;
  let json = null;
  let binary = null;
  while (offset + 8 <= buffer.length) {
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + chunkLength;
    if (end > buffer.length) throw new Error('GLB 分块长度越界');
    if (chunkType === JSON_CHUNK && !json) {
      json = JSON.parse(
        buffer
          .subarray(start, end)
          .toString('utf8')
          .replace(/[\0\u0020\t\r\n]+$/g, ''),
      );
    } else if (chunkType === BIN_CHUNK && !binary) {
      binary = buffer.subarray(start, end);
    }
    offset = end;
  }
  if (!json) throw new Error('GLB 缺少 JSON 分块');
  return { json, binary };
}

function getAccessorRange(document, binary, accessorIndex) {
  const accessor = (document.accessors || [])[accessorIndex];
  if (!accessor) return null;
  if (Array.isArray(accessor.min) && Array.isArray(accessor.max)) {
    return { min: Number(accessor.min[0]), max: Number(accessor.max[0]) };
  }
  if (
    accessor.type !== 'SCALAR' ||
    accessor.sparse ||
    accessor.bufferView == null ||
    !binary
  ) {
    return null;
  }
  const bufferView = (document.bufferViews || [])[accessor.bufferView];
  const component = COMPONENT_READERS[accessor.componentType];
  if (!bufferView || !component || !Number.isInteger(accessor.count)) return null;
  const stride = bufferView.byteStride || component.bytes;
  const baseOffset = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
  if (accessor.count <= 0) return { min: 0, max: 0 };
  const lastOffset = baseOffset + (accessor.count - 1) * stride;
  if (lastOffset + component.bytes > binary.length) return null;
  const view = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
  let min = Infinity;
  let max = -Infinity;
  for (let index = 0; index < accessor.count; index += 1) {
    const value = component.read(view, baseOffset + index * stride);
    if (Number.isFinite(value)) {
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  }
  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
}

function inferRole(name) {
  const normalized = String(name || '').trim().toLowerCase();
  if (!normalized) return { role: 'unknown', confidence: 'none' };
  if (EXPLODE_WORDS.some((word) => normalized.includes(word))) {
    return { role: 'explode', confidence: 'high' };
  }
  if (INSTALL_WORDS.some((word) => normalized.includes(word))) {
    return { role: 'install', confidence: 'high' };
  }
  return { role: 'unknown', confidence: 'none' };
}

function inspectAnimation(animation, animationIndex, document, binary) {
  const channelTypes = {
    translation: 0,
    rotation: 0,
    scale: 0,
    weights: 0,
    other: 0,
  };
  const nodes = new Map();
  let start = Infinity;
  let end = -Infinity;

  for (const channel of animation.channels || []) {
    const path = channel.target && channel.target.path;
    if (Object.hasOwn(channelTypes, path)) channelTypes[path] += 1;
    else channelTypes.other += 1;
    const nodeIndex = channel.target && channel.target.node;
    if (Number.isInteger(nodeIndex)) {
      const node = (document.nodes || [])[nodeIndex] || {};
      nodes.set(nodeIndex, node.name || `node_${nodeIndex}`);
    }
    const sampler = (animation.samplers || [])[channel.sampler];
    if (!sampler) continue;
    const range = getAccessorRange(document, binary, sampler.input);
    if (range) {
      start = Math.min(start, range.min);
      end = Math.max(end, range.max);
    }
  }

  const name = animation.name || `Animation_${animationIndex + 1}`;
  const inferred = inferRole(name);
  const hasTransformTracks =
    channelTypes.translation + channelTypes.rotation + channelTypes.scale > 0;
  return {
    index: animationIndex,
    name,
    durationSec:
      Number.isFinite(start) && Number.isFinite(end)
        ? Number(Math.max(0, end - start).toFixed(4))
        : null,
    channelCount: Array.isArray(animation.channels)
      ? animation.channels.length
      : 0,
    tracks: channelTypes,
    targetNodeCount: nodes.size,
    targetNodes: [...nodes.values()],
    hasTransformTracks,
    inferredRole: inferred.role,
    roleConfidence: inferred.confidence,
  };
}

function buildManifest(animations, suggestedAssemblyId) {
  const transformAnimations = animations.filter(
    (animation) => animation.hasTransformTracks,
  );
  const explode = transformAnimations.find(
    (animation) => animation.inferredRole === 'explode',
  );
  const install = transformAnimations.find(
    (animation) => animation.inferredRole === 'install',
  );

  let explodeClip = explode ? explode.name : null;
  let installClip = install ? install.name : null;
  let installMode = installClip ? 'clip' : null;
  let confidence = explode || install ? 'high' : 'none';
  const notes = [];

  if (!explodeClip && transformAnimations.length === 1) {
    explodeClip = transformAnimations[0].name;
    installMode = 'reverse-explode';
    confidence = 'medium';
    notes.push('仅检测到一条变换动画，暂按“拆卸”处理；“安装”可反向播放该动画。');
  } else if (explodeClip && !installClip) {
    installMode = 'reverse-explode';
    notes.push('未找到独立安装动画，建议将拆卸动画反向播放。');
  }
  if (!explodeClip && transformAnimations.length > 1) {
    notes.push('动画名称无法自动判断用途，请在 CAD 软件中将轨道命名为 Explode / Install。');
  }
  if (!transformAnimations.length) {
    notes.push('没有可用的位移、旋转或缩放轨道。');
  }

  return {
    schemaVersion: 1,
    assemblyId: suggestedAssemblyId || 'assembly_0001',
    explodeClip,
    installClip,
    installMode,
    confidence,
    clips: animations.map((animation) => ({
      name: animation.name,
      durationSec: animation.durationSec,
      role: animation.inferredRole,
    })),
    notes,
  };
}

function sanitizeAssemblyId(fileName) {
  const base = String(fileName || 'assembly_0001')
    .replace(/\.glb$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return base || 'assembly_0001';
}

function inspectGlbAnimation(buffer, options = {}) {
  const { json, binary } = parseGlb(buffer);
  const animations = (json.animations || []).map((animation, index) =>
    inspectAnimation(animation, index, json, binary),
  );
  const extensions = [
    ...new Set([
      ...(json.extensionsUsed || []),
      ...(json.extensionsRequired || []),
    ]),
  ];
  const errors = [];
  const warnings = [];
  if (extensions.includes('KHR_draco_mesh_compression')) {
    errors.push('GLB 使用 Draco 压缩，当前项目不建议直接使用。');
  }
  if (extensions.includes('KHR_lights_punctual')) {
    warnings.push('GLB 包含灯光扩展，在 XR-FRAME 中可能不一致。');
  }
  if (!animations.length) {
    warnings.push('没有检测到动画轨道。');
  } else if (!animations.some((animation) => animation.hasTransformTracks)) {
    warnings.push('只检测到形变等非变换轨道，不能直接用作零件爆炸动画。');
  }

  const manifest = buildManifest(
    animations,
    options.assemblyId || sanitizeAssemblyId(options.fileName),
  );
  return {
    valid: errors.length === 0,
    fileName: options.fileName || '',
    bytes: Buffer.byteLength(buffer),
    gltfVersion: json.asset && json.asset.version ? json.asset.version : '2.0',
    generator: (json.asset && json.asset.generator) || '',
    counts: {
      scenes: (json.scenes || []).length,
      nodes: (json.nodes || []).length,
      meshes: (json.meshes || []).length,
      materials: (json.materials || []).length,
      animations: animations.length,
    },
    extensions,
    animations,
    manifest,
    errors,
    warnings,
  };
}

module.exports = {
  buildManifest,
  inferRole,
  inspectGlbAnimation,
  parseGlb,
};
