const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const miniprogramRoot = path.join(projectRoot, 'miniprogram');
const { AR_TARGETS, MODEL_FCODE_MAP } = require(path.join(
  miniprogramRoot,
  'config',
  'model_fcode_map.js',
));

let failed = false;

function check(condition, message) {
  console.log(`${condition ? 'PASS' : 'FAIL'} ${message}`);
  failed ||= !condition;
}

function resolveMiniProgramPath(value) {
  return path.join(miniprogramRoot, value.replace(/^[/\\]+/, ''));
}

const appConfig = JSON.parse(
  fs.readFileSync(path.join(miniprogramRoot, 'app.json'), 'utf8'),
);
check(
  appConfig.pages.length === 1 &&
    appConfig.pages[0] === 'pages/ar-viewer/ar-viewer',
  '应用仅注册本地 AR 页面',
);

check(AR_TARGETS.length > 0, `本地目标清单包含 ${AR_TARGETS.length} 项`);
check(
  new Set(AR_TARGETS.map((target) => target.modelId)).size ===
    AR_TARGETS.length,
  'modelId 没有重复',
);
check(
  new Set(AR_TARGETS.map((target) => target.modelAssetId)).size ===
    AR_TARGETS.length,
  'modelAssetId 没有重复',
);

for (const target of AR_TARGETS) {
  const markerPath = resolveMiniProgramPath(target.markerSrc);
  const modelPath = resolveMiniProgramPath(target.modelSrc);
  const marker = fs.readFileSync(markerPath);
  const model = fs.readFileSync(modelPath);

  const markerIsPng =
    marker.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
  const markerWidth = marker.readUInt32BE(16);
  const markerHeight = marker.readUInt32BE(20);
  check(
    markerIsPng && markerWidth >= 640 && markerHeight >= 480,
    `${target.modelId} 目标图有效（${markerWidth}x${markerHeight}）`,
  );

  const modelIsGlb =
    model.subarray(0, 4).toString('ascii') === 'glTF' &&
    model.readUInt32LE(4) === 2 &&
    model.readUInt32LE(8) === model.length;
  check(
    modelIsGlb,
    `${target.modelId} GLB 有效（${model.length} bytes）`,
  );

  const jsonChunkLength = model.readUInt32LE(12);
  const jsonChunkType = model.toString('ascii', 16, 20);
  const modelJson = JSON.parse(
    model
      .subarray(20, 20 + jsonChunkLength)
      .toString('utf8')
      .replace(/\0|\s+$/g, ''),
  );
  const extensionsUsed = modelJson.extensionsUsed || [];
  const extensionsRequired = modelJson.extensionsRequired || [];
  check(
    jsonChunkType === 'JSON' &&
      !extensionsUsed.includes('KHR_draco_mesh_compression') &&
      !extensionsRequired.includes('KHR_draco_mesh_compression'),
    `${target.modelId} 不依赖 Draco Decoder`,
  );
  check(
    !extensionsUsed.includes('KHR_lights_punctual'),
    `${target.modelId} 不包含无效灯光扩展声明`,
  );
  check(
    Boolean(MODEL_FCODE_MAP[target.modelId]),
    `${target.modelId} 已配置迪威跳转`,
  );
}

const forbiddenPatterns = [
  /\bBASE_URL\b/,
  /\/api\/recognize/,
  /wx\.uploadFile/,
  /\bGLM\b/i,
  /\bVLM\b/i,
  /three-platformize/,
];
const sourceExtensions = new Set(['.js', '.json', '.wxml', '.wxss']);

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(entryPath) : [entryPath];
  });
}

const runtimeSources = walk(miniprogramRoot).filter((filePath) =>
  sourceExtensions.has(path.extname(filePath)),
);
for (const filePath of runtimeSources) {
  const source = fs.readFileSync(filePath, 'utf8');
  for (const pattern of forbiddenPatterns) {
    check(
      !pattern.test(source),
      `${path.relative(projectRoot, filePath)} 不包含旧识别依赖 ${pattern}`,
    );
  }
}

process.exitCode = failed ? 1 : 0;
