const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const HOST = '127.0.0.1';
const PORT = Number(process.env.AR_DATASET_MANAGER_PORT || 4180);
const projectRoot = path.resolve(__dirname, '..', '..');
const publicRoot = path.join(__dirname, 'public');
const miniprogramRoot = path.join(projectRoot, 'miniprogram');
const configPath = path.join(
  miniprogramRoot,
  'config',
  'model_fcode_map.js',
);
const scenePath = path.join(
  miniprogramRoot,
  'components',
  'ar-marker-scene',
  'index.wxml',
);
const markerRoot = path.join(miniprogramRoot, 'assets', 'markers');
const modelRoot = path.join(miniprogramRoot, 'assets', 'models');
const backupRoot = path.join(projectRoot, 'dataset_backups');
const MAX_BODY_BYTES = 64 * 1024 * 1024;
const MODEL_ID_PATTERN = /^part_\d{4,}$/;
const COLOR_PATTERN =
  /^(?:0(?:\.\d+)?|1(?:\.0+)?) (?:0(?:\.\d+)?|1(?:\.0+)?) (?:0(?:\.\d+)?|1(?:\.0+)?) (?:0(?:\.\d+)?|1(?:\.0+)?)$/;

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

function sendText(response, status, contentType, body) {
  response.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

function safeJoin(root, relativePath) {
  const resolvedRoot = path.resolve(root) + path.sep;
  const resolved = path.resolve(root, relativePath);
  if (!resolved.startsWith(resolvedRoot)) {
    throw new Error('非法文件路径');
  }
  return resolved;
}

function getMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return (
    {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.glb': 'model/gltf-binary',
    }[extension] || 'application/octet-stream'
  );
}

function serveFile(response, filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    sendJson(response, 404, { ok: false, message: '文件不存在' });
    return;
  }
  const body = fs.readFileSync(filePath);
  response.writeHead(200, {
    'Content-Type': getMimeType(filePath),
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

function readRequestJson(request) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error('上传内容超过 64MB 限制'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new Error('请求数据格式不正确'));
      }
    });
    request.on('error', reject);
  });
}

function loadRuntimeConfig() {
  const resolved = require.resolve(configPath);
  delete require.cache[resolved];
  const runtimeConfig = require(resolved);
  return {
    targets: runtimeConfig.AR_TARGETS.map((target) => ({ ...target })),
    fcodes: { ...runtimeConfig.MODEL_FCODE_MAP },
  };
}

function inspectPng(buffer) {
  const isPng =
    buffer.length >= 24 &&
    buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
  if (!isPng) throw new Error('目标图必须是有效的 PNG 文件');
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width < 640 || height < 480) {
    throw new Error(
      `目标图分辨率 ${width}×${height}，最低要求为 640×480`,
    );
  }
  return { width, height, bytes: buffer.length };
}

function inspectGlb(buffer) {
  const validHeader =
    buffer.length >= 20 &&
    buffer.subarray(0, 4).toString('ascii') === 'glTF' &&
    buffer.readUInt32LE(4) === 2 &&
    buffer.readUInt32LE(8) === buffer.length &&
    buffer.toString('ascii', 16, 20) === 'JSON';
  if (!validHeader) throw new Error('模型必须是有效的 glTF 2.0 GLB 文件');

  const jsonChunkLength = buffer.readUInt32LE(12);
  const modelJson = JSON.parse(
    buffer
      .subarray(20, 20 + jsonChunkLength)
      .toString('utf8')
      .replace(/\0|\s+$/g, ''),
  );
  const extensions = new Set([
    ...(modelJson.extensionsUsed || []),
    ...(modelJson.extensionsRequired || []),
  ]);
  if (extensions.has('KHR_draco_mesh_compression')) {
    throw new Error('GLB 使用了 Draco 压缩，当前 XR-FRAME 无法直接解码');
  }
  if (extensions.has('KHR_lights_punctual')) {
    throw new Error('GLB 含有不兼容的灯光扩展，请先清理模型');
  }
  return {
    bytes: buffer.length,
    meshes: Array.isArray(modelJson.meshes) ? modelJson.meshes.length : 0,
  };
}

function decodeUpload(upload, label) {
  if (!upload || typeof upload.data !== 'string') {
    throw new Error(`请选择${label}`);
  }
  const comma = upload.data.indexOf(',');
  const encoded = comma >= 0 ? upload.data.slice(comma + 1) : upload.data;
  if (!encoded) throw new Error(`${label}内容为空`);
  return Buffer.from(encoded, 'base64');
}

function inspectTarget(target, fcodes) {
  const markerPath = safeJoin(
    miniprogramRoot,
    target.markerSrc.replace(/^[/\\]+/, ''),
  );
  const modelPath = safeJoin(
    miniprogramRoot,
    target.modelSrc.replace(/^[/\\]+/, ''),
  );
  const markerBuffer = fs.readFileSync(markerPath);
  const modelBuffer = fs.readFileSync(modelPath);
  return {
    ...target,
    fcode: fcodes[target.modelId] || '',
    image: inspectPng(markerBuffer),
    model: inspectGlb(modelBuffer),
  };
}

function listTargets() {
  const { targets, fcodes } = loadRuntimeConfig();
  return targets.map((target) => inspectTarget(target, fcodes));
}

function formatTimestamp() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
    '-',
    String(date.getMilliseconds()).padStart(3, '0'),
  ].join('');
}

function createBackup(reason) {
  fs.mkdirSync(backupRoot, { recursive: true });
  const backupDirectory = path.join(
    backupRoot,
    `${formatTimestamp()}-${reason}`,
  );
  fs.mkdirSync(backupDirectory, { recursive: false });
  fs.copyFileSync(configPath, path.join(backupDirectory, 'model_fcode_map.js'));
  fs.copyFileSync(scenePath, path.join(backupDirectory, 'index.wxml'));
  fs.cpSync(markerRoot, path.join(backupDirectory, 'markers'), {
    recursive: true,
  });
  fs.cpSync(modelRoot, path.join(backupDirectory, 'models'), {
    recursive: true,
  });
  return backupDirectory;
}

function generateConfig(targets, fcodes) {
  const fcodeLines = targets
    .map(
      (target) =>
        `  '${target.modelId}': ${JSON.stringify(fcodes[target.modelId] || '')},`,
    )
    .join('\n');
  const targetLines = targets
    .map(
      (target) => `  {
    modelId: ${JSON.stringify(target.modelId)},
    markerSrc: ${JSON.stringify(target.markerSrc)},
    modelSrc: ${JSON.stringify(target.modelSrc)},
    modelAssetId: ${JSON.stringify(target.modelAssetId)},
    hasModel: ${Boolean(target.hasModel)},
    placeholderColor: ${JSON.stringify(target.placeholderColor)},
  },`,
    )
    .join('\n');

  return `/**
 * 本地 AR 目标、GLB 模型与迪威 fcode 配置。
 *
 * 本文件由“AR 数据集管理器”维护，也可由开发人员手动编辑。
 * 当前目标数量：${targets.length}
 */

const MODEL_FCODE_MAP = {
${fcodeLines}
};

const AR_TARGETS = [
${targetLines}
];

function getFcodeByModelId(modelId) {
  if (!modelId) return null;
  return MODEL_FCODE_MAP[modelId] || null;
}

module.exports = {
  AR_TARGETS,
  MODEL_FCODE_MAP,
  getFcodeByModelId,
};
`;
}

function generateAssetRegion(targets) {
  const blocks = targets
    .map(
      (target) => `    <xr-asset-load
      type="gltf"
      asset-id="${target.modelAssetId}"
      src="${target.modelSrc}"
      options="ignoreError: -1"
    />`,
    )
    .join('\n');
  return `    <!-- DATASET_MANAGER:ASSETS_START -->\n${blocks}\n    <!-- DATASET_MANAGER:ASSETS_END -->`;
}

function generateScene(sceneSource, targets) {
  const pattern =
    /    <!-- DATASET_MANAGER:ASSETS_START -->[\s\S]*?    <!-- DATASET_MANAGER:ASSETS_END -->/;
  if (!pattern.test(sceneSource)) {
    throw new Error('XR 场景缺少数据集管理器资源标记');
  }
  return sceneSource.replace(pattern, generateAssetRegion(targets));
}

function atomicWrite(filePath, content) {
  const temporaryPath = `${filePath}.dataset-manager-tmp`;
  fs.writeFileSync(temporaryPath, content);
  fs.renameSync(temporaryPath, filePath);
}

function normalizePayload(payload) {
  const modelId = String(payload.modelId || '').trim().toLowerCase();
  const fcode = String(payload.fcode || '').trim();
  const placeholderColor = String(
    payload.placeholderColor || '0.12 0.72 0.58 1',
  ).trim();
  if (!MODEL_ID_PATTERN.test(modelId)) {
    throw new Error('零件编号格式应为 part_0004（至少四位数字）');
  }
  if (!fcode) throw new Error('请填写迪威 fcode');
  if (!/^[a-zA-Z0-9_-]{4,128}$/.test(fcode)) {
    throw new Error('迪威 fcode 格式不正确');
  }
  if (!COLOR_PATTERN.test(placeholderColor)) {
    throw new Error('占位颜色格式不正确');
  }
  return { modelId, fcode, placeholderColor };
}

function saveTarget(payload) {
  const normalized = normalizePayload(payload);
  const { targets, fcodes } = loadRuntimeConfig();
  const index = targets.findIndex(
    (target) => target.modelId === normalized.modelId,
  );
  const isNew = index === -1;
  if (isNew && (!payload.image || !payload.model)) {
    throw new Error('新增零件必须同时选择原始工程图和 GLB 模型');
  }

  const markerPath = path.join(
    markerRoot,
    `${normalized.modelId}_ar_target.png`,
  );
  const modelDirectory = path.join(modelRoot, normalized.modelId);
  const modelPath = path.join(modelDirectory, 'model_plain.glb');
  const imageBuffer = payload.image
    ? decodeUpload(payload.image, '原始工程图')
    : fs.readFileSync(markerPath);
  const modelBuffer = payload.model
    ? decodeUpload(payload.model, 'GLB 模型')
    : fs.readFileSync(modelPath);
  const imageInfo = inspectPng(imageBuffer);
  const modelInfo = inspectGlb(modelBuffer);

  const backupDirectory = createBackup(isNew ? 'add' : 'edit');
  fs.mkdirSync(markerRoot, { recursive: true });
  fs.mkdirSync(modelDirectory, { recursive: true });
  if (payload.image || isNew) fs.writeFileSync(markerPath, imageBuffer);
  if (payload.model || isNew) fs.writeFileSync(modelPath, modelBuffer);

  const target = {
    modelId: normalized.modelId,
    markerSrc: `/assets/markers/${normalized.modelId}_ar_target.png`,
    modelSrc: `/assets/models/${normalized.modelId}/model_plain.glb`,
    modelAssetId: `${normalized.modelId.replace(/_/g, '-')}-model`,
    hasModel: true,
    placeholderColor: normalized.placeholderColor,
  };
  if (isNew) targets.push(target);
  else targets[index] = target;
  fcodes[normalized.modelId] = normalized.fcode;

  const sceneSource = fs.readFileSync(scenePath, 'utf8');
  atomicWrite(configPath, generateConfig(targets, fcodes));
  atomicWrite(scenePath, generateScene(sceneSource, targets));

  return {
    target: inspectTarget(target, fcodes),
    backupDirectory,
    imageInfo,
    modelInfo,
    isNew,
  };
}

function deleteTarget(modelId) {
  if (!MODEL_ID_PATTERN.test(modelId)) {
    throw new Error('零件编号格式不正确');
  }
  const { targets, fcodes } = loadRuntimeConfig();
  const target = targets.find((item) => item.modelId === modelId);
  if (!target) throw new Error('目标不存在');
  if (targets.length <= 1) throw new Error('至少保留一个 AR 目标');

  const nextTargets = targets.filter((item) => item.modelId !== modelId);
  const nextFcodes = { ...fcodes };
  delete nextFcodes[modelId];
  const backupDirectory = createBackup('delete');
  const sceneSource = fs.readFileSync(scenePath, 'utf8');
  atomicWrite(configPath, generateConfig(nextTargets, nextFcodes));
  atomicWrite(scenePath, generateScene(sceneSource, nextTargets));

  const markerPath = safeJoin(
    miniprogramRoot,
    target.markerSrc.replace(/^[/\\]+/, ''),
  );
  const modelDirectory = path.dirname(
    safeJoin(miniprogramRoot, target.modelSrc.replace(/^[/\\]+/, '')),
  );
  fs.rmSync(markerPath, { force: true });
  fs.rmSync(modelDirectory, { recursive: true, force: true });
  return { backupDirectory };
}

function runVerifier() {
  const result = spawnSync(
    process.execPath,
    [path.join(projectRoot, 'tools', 'verify_local_ar.js')],
    {
      cwd: projectRoot,
      encoding: 'utf8',
      timeout: 60_000,
    },
  );
  return {
    ok: result.status === 0,
    status: result.status,
    output: `${result.stdout || ''}${result.stderr || ''}`.trim(),
  };
}

async function handleApi(request, response, pathname) {
  if (request.method === 'GET' && pathname === '/api/targets') {
    sendJson(response, 200, { ok: true, targets: listTargets() });
    return;
  }
  if (request.method === 'POST' && pathname === '/api/targets') {
    const payload = await readRequestJson(request);
    const result = saveTarget(payload);
    sendJson(response, 200, {
      ok: true,
      message: result.isNew ? '零件已加入目标库' : '零件配置已更新',
      ...result,
    });
    return;
  }
  if (request.method === 'DELETE' && pathname.startsWith('/api/targets/')) {
    const modelId = decodeURIComponent(pathname.slice('/api/targets/'.length));
    const result = deleteTarget(modelId);
    sendJson(response, 200, {
      ok: true,
      message: `${modelId} 已删除，可从自动备份恢复`,
      ...result,
    });
    return;
  }
  if (request.method === 'POST' && pathname === '/api/verify') {
    const result = runVerifier();
    sendJson(response, result.ok ? 200 : 422, result);
    return;
  }
  sendJson(response, 404, { ok: false, message: '接口不存在' });
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${HOST}:${PORT}`);
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.startsWith('/api/')) {
      await handleApi(request, response, pathname);
      return;
    }
    if (pathname.startsWith('/mini/')) {
      serveFile(
        response,
        safeJoin(miniprogramRoot, pathname.slice('/mini/'.length)),
      );
      return;
    }
    const relativePath =
      pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    serveFile(response, safeJoin(publicRoot, relativePath));
  } catch (error) {
    console.error('[dataset-manager]', error);
    sendJson(response, 400, {
      ok: false,
      message: error.message || '操作失败',
    });
  }
});

server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}`;
  console.log('');
  console.log('AR 数据集管理器已启动：');
  console.log(url);
  console.log('');
  console.log('关闭此窗口即可停止管理器。');
  if (process.platform === 'win32' && process.env.NO_BROWSER !== '1') {
    const child = spawn('cmd.exe', ['/c', 'start', '', url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
  }
});

