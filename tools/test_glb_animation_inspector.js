'use strict';

const assert = require('assert');
const {
  inspectGlbAnimation,
} = require('./dataset-manager/glb-animation-inspector');

function padded(buffer, byte = 0x20) {
  const padding = (4 - (buffer.length % 4)) % 4;
  return padding ? Buffer.concat([buffer, Buffer.alloc(padding, byte)]) : buffer;
}

function makeAnimatedGlb() {
  const times = Buffer.alloc(12);
  [0, 0.75, 1.5].forEach((value, index) =>
    times.writeFloatLE(value, index * 4),
  );
  const translations = Buffer.alloc(36);
  [
    0, 0, 0,
    0, 0.5, 0,
    0, 1, 0,
  ].forEach((value, index) => translations.writeFloatLE(value, index * 4));
  const binary = padded(Buffer.concat([times, translations]), 0);
  const document = {
    asset: { version: '2.0', generator: 'animation-inspector-test' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'Pin', mesh: 0 }],
    meshes: [{ primitives: [] }],
    buffers: [{ byteLength: binary.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 12 },
      { buffer: 0, byteOffset: 12, byteLength: 36 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'SCALAR' },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' },
    ],
    animations: [
      {
        name: 'Explode_Main',
        samplers: [{ input: 0, output: 1, interpolation: 'LINEAR' }],
        channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }],
      },
    ],
  };
  const json = padded(Buffer.from(JSON.stringify(document), 'utf8'));
  const totalLength = 12 + 8 + json.length + 8 + binary.length;
  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'ascii');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(json.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binary.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, json, binHeader, binary]);
}

const report = inspectGlbAnimation(makeAnimatedGlb(), {
  fileName: 'assembly_0042.glb',
});

assert.equal(report.valid, true);
assert.equal(report.counts.animations, 1);
assert.equal(report.animations[0].name, 'Explode_Main');
assert.equal(report.animations[0].durationSec, 1.5);
assert.equal(report.animations[0].tracks.translation, 1);
assert.deepEqual(report.animations[0].targetNodes, ['Pin']);
assert.equal(report.animations[0].inferredRole, 'explode');
assert.equal(report.manifest.assemblyId, 'assembly_0042');
assert.equal(report.manifest.explodeClip, 'Explode_Main');
assert.equal(report.manifest.installMode, 'reverse-explode');

console.log('[PASS] GLB 动画轨道、时长、节点与爆炸角色解析正常');
