'use strict';

const fs = require('fs');
const path = require('path');

function usage() {
  console.error('Usage: node tools/prepare_solidworks_gltf.js input.gltf output.gltf');
}

function imageUriForTexture(document, textureIndex) {
  const texture = (document.textures || [])[textureIndex];
  if (!texture || !Number.isInteger(texture.source)) return '';
  const image = (document.images || [])[texture.source];
  return image && image.uri ? String(image.uri) : '';
}

function removeUnsupportedDdsNormals(document) {
  let removed = 0;
  for (const material of document.materials || []) {
    if (!material.normalTexture) continue;
    const uri = imageUriForTexture(document, material.normalTexture.index);
    if (/\.dds(?:$|[?#])/i.test(uri)) {
      delete material.normalTexture;
      removed += 1;
    }
  }
  return removed;
}

function removeSolidworksViewerMetadata(document) {
  const unsupported = new Set([
    'KHR_lights_punctual',
    'Solidworks_custom_properties',
  ]);
  if (Array.isArray(document.extensionsUsed)) {
    document.extensionsUsed = document.extensionsUsed.filter(
      (name) => !unsupported.has(name),
    );
    if (!document.extensionsUsed.length) delete document.extensionsUsed;
  }
  if (Array.isArray(document.extensionsRequired)) {
    document.extensionsRequired = document.extensionsRequired.filter(
      (name) => !unsupported.has(name),
    );
    if (!document.extensionsRequired.length) delete document.extensionsRequired;
  }
  for (const scene of document.scenes || []) {
    if (!scene.extensions) continue;
    for (const name of unsupported) delete scene.extensions[name];
    if (!Object.keys(scene.extensions).length) delete scene.extensions;
  }
}

function visitTextureReferences(value, callback) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item) => visitTextureReferences(item, callback));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (
      /Texture$/.test(key) &&
      child &&
      typeof child === 'object' &&
      Number.isInteger(child.index)
    ) {
      callback(child);
    }
    visitTextureReferences(child, callback);
  }
}

function pruneUnusedTextureResources(document) {
  const usedTextures = new Set();
  visitTextureReferences(document.materials || [], (reference) => {
    usedTextures.add(reference.index);
  });
  const textureMap = new Map();
  document.textures = (document.textures || []).filter((texture, index) => {
    if (!usedTextures.has(index)) return false;
    textureMap.set(index, textureMap.size);
    return true;
  });
  visitTextureReferences(document.materials || [], (reference) => {
    reference.index = textureMap.get(reference.index);
  });

  const usedImages = new Set();
  const usedSamplers = new Set();
  for (const texture of document.textures) {
    if (Number.isInteger(texture.source)) usedImages.add(texture.source);
    if (Number.isInteger(texture.sampler)) usedSamplers.add(texture.sampler);
  }
  const imageMap = new Map();
  document.images = (document.images || []).filter((image, index) => {
    if (!usedImages.has(index)) return false;
    imageMap.set(index, imageMap.size);
    return true;
  });
  const samplerMap = new Map();
  document.samplers = (document.samplers || []).filter((sampler, index) => {
    if (!usedSamplers.has(index)) return false;
    samplerMap.set(index, samplerMap.size);
    return true;
  });
  for (const texture of document.textures) {
    if (Number.isInteger(texture.source)) {
      texture.source = imageMap.get(texture.source);
    }
    if (Number.isInteger(texture.sampler)) {
      texture.sampler = samplerMap.get(texture.sampler);
    }
  }
  return {
    images: document.images.length,
    textures: document.textures.length,
  };
}

function normalizeAnimationNames(document) {
  return (document.animations || []).map((animation, index) => {
    const originalName = animation.name || `animation-${index}`;
    animation.extras = {
      ...(animation.extras || {}),
      sourceAnimationName: originalName,
    };
    animation.name = index === 0 ? 'gltfAnimation' : `gltfAnimation#${index}`;
    return { originalName, runtimeName: animation.name };
  });
}

function main() {
  const inputPath = process.argv[2] && path.resolve(process.argv[2]);
  const outputPath = process.argv[3] && path.resolve(process.argv[3]);
  if (!inputPath || !outputPath) {
    usage();
    process.exitCode = 2;
    return;
  }
  if (path.dirname(inputPath) !== path.dirname(outputPath)) {
    throw new Error('输出 glTF 必须与原文件位于同一目录，以保留外部 BIN 引用');
  }

  const document = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const removedDdsNormals = removeUnsupportedDdsNormals(document);
  removeSolidworksViewerMetadata(document);
  const retainedTextures = pruneUnusedTextureResources(document);
  const animations = normalizeAnimationNames(document);
  document.asset = {
    ...(document.asset || {}),
    generator: `${(document.asset && document.asset.generator) || 'SOLIDWORKSGLTF'} + CAD Vision XR prep`,
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`);
  console.log(
    `Prepared ${path.basename(outputPath)}: removed ${removedDdsNormals} unsupported DDS normal-map bindings; retained ${retainedTextures.textures} textures / ${retainedTextures.images} images; animations ${animations.map((item) => `${item.originalName} -> ${item.runtimeName}`).join(', ') || 'none'}.`,
  );
}

main();
