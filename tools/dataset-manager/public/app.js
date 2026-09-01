const state = {
  targets: [],
  editingId: '',
  imageFile: null,
  modelFile: null,
  animationFile: null,
  animationReport: null,
};

const elements = {
  form: document.querySelector('#targetForm'),
  formTitle: document.querySelector('#formTitle'),
  modelId: document.querySelector('#modelId'),
  fcode: document.querySelector('#fcode'),
  imageFile: document.querySelector('#imageFile'),
  modelFile: document.querySelector('#modelFile'),
  imageStatus: document.querySelector('#imageStatus'),
  modelStatus: document.querySelector('#modelStatus'),
  imagePreview: document.querySelector('#imagePreview'),
  imageDrop: document.querySelector('#imageDrop'),
  modelDrop: document.querySelector('#modelDrop'),
  colorPicker: document.querySelector('#colorPicker'),
  submitButton: document.querySelector('#submitButton'),
  cancelEdit: document.querySelector('#cancelEdit'),
  refreshButton: document.querySelector('#refreshButton'),
  verifyButton: document.querySelector('#verifyButton'),
  targetCount: document.querySelector('#targetCount'),
  modelCount: document.querySelector('#modelCount'),
  targetList: document.querySelector('#targetList'),
  toast: document.querySelector('#toast'),
  dialog: document.querySelector('#resultDialog'),
  dialogTitle: document.querySelector('#dialogTitle'),
  verifyOutput: document.querySelector('#verifyOutput'),
  closeDialog: document.querySelector('#closeDialog'),
  assemblyId: document.querySelector('#assemblyId'),
  animationFile: document.querySelector('#animationFile'),
  animationDrop: document.querySelector('#animationDrop'),
  animationStatus: document.querySelector('#animationStatus'),
  animationEmpty: document.querySelector('#animationEmpty'),
  animationReport: document.querySelector('#animationReport'),
};

function showToast(message, type = 'success') {
  elements.toast.textContent = message;
  elements.toast.className = `toast visible ${type === 'error' ? 'error' : ''}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    elements.toast.className = 'toast';
  }, 4300);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.message || payload.output || '操作失败');
  }
  return payload;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function colorStringToHex(colorString) {
  const values = String(colorString)
    .split(/\s+/)
    .slice(0, 3)
    .map((value) => Math.round(Number(value) * 255));
  return `#${values
    .map((value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0'))
    .join('')}`;
}

function hexToColorString(hex) {
  const values = [1, 3, 5].map((index) =>
    (parseInt(hex.slice(index, index + 2), 16) / 255)
      .toFixed(3)
      .replace(/0+$/, '')
      .replace(/\.$/, ''),
  );
  return `${values.join(' ')} 1`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderTargets() {
  elements.targetCount.textContent = state.targets.length;
  elements.modelCount.textContent = state.targets.filter(
    (target) => target.hasModel,
  ).length;
  if (!state.targets.length) {
    elements.targetList.innerHTML =
      '<div class="empty-row">目标库为空，请先添加一个零件</div>';
    return;
  }
  elements.targetList.innerHTML = state.targets
    .map(
      (target) => `
        <article class="target-item">
          <img
            class="target-thumb"
            src="/mini${escapeHtml(target.markerSrc)}?v=${Date.now()}"
            alt="${escapeHtml(target.modelId)} 工程图"
          />
          <div class="target-info">
            <strong>${escapeHtml(target.modelId)}</strong>
            <span>${target.image.width}×${target.image.height} · ${
              target.model ? formatBytes(target.model.bytes) : '无 AR 模型'
            }</span>
            <span>${
              target.targetType === 'assembly'
                ? '装配图 · 跳转爆炸图'
                : `fcode · ${escapeHtml(target.fcode)}`
            }</span>
          </div>
          <div class="target-actions">
            ${
              target.targetType === 'assembly'
                ? '<span class="type-badge">ASSEMBLY</span>'
                : `<button class="small-button" data-action="edit" data-id="${escapeHtml(
                    target.modelId,
                  )}">编辑</button>
            <button class="small-button danger" data-action="delete" data-id="${escapeHtml(
              target.modelId,
            )}">删除</button>`
            }
          </div>
        </article>`,
    )
    .join('');
}

async function loadTargets() {
  elements.targetList.innerHTML =
    '<div class="loading-row">正在读取目标库…</div>';
  try {
    const payload = await api('/api/targets');
    state.targets = payload.targets;
    renderTargets();
  } catch (error) {
    elements.targetList.innerHTML =
      '<div class="empty-row">目标库读取失败</div>';
    showToast(error.message, 'error');
  }
}

function validateImage(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.name.toLowerCase().endsWith('.png')) {
      reject(new Error('请选择 PNG 格式的原始工程图'));
      return;
    }
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(image.src);
      if (image.naturalWidth < 640 || image.naturalHeight < 480) {
        reject(
          new Error(
            `图片只有 ${image.naturalWidth}×${image.naturalHeight}，最低要求 640×480`,
          ),
        );
        return;
      }
      resolve({
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
    };
    image.onerror = () => reject(new Error('PNG 图片无法读取'));
    image.src = URL.createObjectURL(file);
  });
}

function validateModel(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.name.toLowerCase().endsWith('.glb')) {
      reject(new Error('请选择 GLB 格式的三维模型'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const bytes = new Uint8Array(reader.result);
      const magic = new TextDecoder().decode(bytes.slice(0, 4));
      const view = new DataView(reader.result);
      if (
        bytes.length < 20 ||
        magic !== 'glTF' ||
        view.getUint32(4, true) !== 2 ||
        view.getUint32(8, true) !== bytes.length
      ) {
        reject(new Error('文件不是有效的 glTF 2.0 GLB'));
        return;
      }
      resolve({ bytes: bytes.length });
    };
    reader.onerror = () => reject(new Error('GLB 文件无法读取'));
    reader.readAsArrayBuffer(file);
  });
}

async function chooseImage(file) {
  try {
    const info = await validateImage(file);
    state.imageFile = file;
    elements.imageStatus.textContent = `${file.name} · ${info.width}×${info.height}`;
    elements.imagePreview.src = URL.createObjectURL(file);
    elements.imagePreview.classList.remove('hidden');
  } catch (error) {
    state.imageFile = null;
    elements.imageStatus.textContent = error.message;
    elements.imagePreview.classList.add('hidden');
    showToast(error.message, 'error');
  }
}

async function chooseModel(file) {
  try {
    const info = await validateModel(file);
    state.modelFile = file;
    elements.modelStatus.textContent = `${file.name} · ${formatBytes(info.bytes)}`;
  } catch (error) {
    state.modelFile = null;
    elements.modelStatus.textContent = error.message;
    showToast(error.message, 'error');
  }
}

function wireDropZone(zone, input, handler) {
  ['dragenter', 'dragover'].forEach((name) => {
    zone.addEventListener(name, (event) => {
      event.preventDefault();
      zone.classList.add('dragging');
    });
  });
  ['dragleave', 'drop'].forEach((name) => {
    zone.addEventListener(name, (event) => {
      event.preventDefault();
      zone.classList.remove('dragging');
    });
  });
  zone.addEventListener('drop', (event) => {
    const file = event.dataTransfer.files[0];
    if (file) handler(file);
  });
  input.addEventListener('change', () => {
    if (input.files[0]) handler(input.files[0]);
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () =>
      resolve({ name: file.name, data: String(reader.result) });
    reader.onerror = () => reject(new Error(`无法读取 ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function resetForm() {
  state.editingId = '';
  state.imageFile = null;
  state.modelFile = null;
  elements.form.reset();
  elements.colorPicker.value = '#1fb891';
  elements.modelId.disabled = false;
  elements.formTitle.textContent = '添加新零件';
  elements.submitButton.textContent = '校验并加入目标库';
  elements.cancelEdit.classList.add('hidden');
  elements.imageStatus.textContent = '尚未选择';
  elements.modelStatus.textContent = '尚未选择';
  elements.imagePreview.classList.add('hidden');
}

function startEdit(modelId) {
  const target = state.targets.find((item) => item.modelId === modelId);
  if (!target) return;
  state.editingId = modelId;
  state.imageFile = null;
  state.modelFile = null;
  elements.formTitle.textContent = `编辑 ${modelId}`;
  elements.modelId.value = modelId;
  elements.modelId.disabled = true;
  elements.fcode.value = target.fcode;
  elements.colorPicker.value = colorStringToHex(target.placeholderColor);
  elements.imageStatus.textContent = '保留现有图片；重新选择可替换';
  elements.modelStatus.textContent = '保留现有模型；重新选择可替换';
  elements.imagePreview.src = `/mini${target.markerSrc}?v=${Date.now()}`;
  elements.imagePreview.classList.remove('hidden');
  elements.submitButton.textContent = '校验并保存修改';
  elements.cancelEdit.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function submitTarget(event) {
  event.preventDefault();
  const modelId = state.editingId || elements.modelId.value.trim().toLowerCase();
  if (!state.editingId && (!state.imageFile || !state.modelFile)) {
    showToast('新增零件需要同时选择工程图和 GLB', 'error');
    return;
  }
  elements.submitButton.disabled = true;
  elements.submitButton.textContent = '正在校验和备份…';
  try {
    const [image, model] = await Promise.all([
      fileToDataUrl(state.imageFile),
      fileToDataUrl(state.modelFile),
    ]);
    const payload = await api('/api/targets', {
      method: 'POST',
      body: JSON.stringify({
        modelId,
        fcode: elements.fcode.value.trim(),
        placeholderColor: hexToColorString(elements.colorPicker.value),
        image,
        model,
      }),
    });
    showToast(payload.message);
    resetForm();
    await loadTargets();
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    elements.submitButton.disabled = false;
    elements.submitButton.textContent = state.editingId
      ? '校验并保存修改'
      : '校验并加入目标库';
  }
}

async function removeTarget(modelId) {
  const confirmed = window.confirm(
    `确定删除 ${modelId} 吗？\n\n删除前会自动完整备份，可以恢复。`,
  );
  if (!confirmed) return;
  try {
    const payload = await api(`/api/targets/${encodeURIComponent(modelId)}`, {
      method: 'DELETE',
    });
    if (state.editingId === modelId) resetForm();
    showToast(payload.message);
    await loadTargets();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function verifyAll() {
  elements.verifyButton.disabled = true;
  elements.verifyButton.textContent = '正在检查…';
  try {
    const payload = await api('/api/verify', {
      method: 'POST',
      body: '{}',
    });
    elements.dialogTitle.textContent = '全部检查通过';
    elements.verifyOutput.textContent = payload.output;
    elements.dialog.showModal();
  } catch (error) {
    elements.dialogTitle.textContent = '发现需要处理的问题';
    elements.verifyOutput.textContent = error.message;
    elements.dialog.showModal();
  } finally {
    elements.verifyButton.disabled = false;
    elements.verifyButton.innerHTML =
      '<span class="button-dot"></span>一键完整校验';
  }
}

function roleLabel(role) {
  return (
    {
      explode: '拆卸 / 爆炸',
      install: '安装 / 复位',
      unknown: '待判定',
    }[role] || role
  );
}

function renderAnimationReport(report) {
  state.animationReport = report;
  elements.animationEmpty.classList.add('hidden');
  elements.animationReport.classList.remove('hidden');
  const transformClipCount = report.animations.filter(
    (animation) => animation.hasTransformTracks,
  ).length;
  const animationCards = report.animations.length
    ? report.animations
        .map(
          (animation) => `
          <article class="clip-card">
            <div class="clip-title">
              <strong>${escapeHtml(animation.name)}</strong>
              <span class="role-badge role-${escapeHtml(
                animation.inferredRole,
              )}">${escapeHtml(roleLabel(animation.inferredRole))}</span>
            </div>
            <div class="clip-stats">
              <span><b>${
                animation.durationSec == null
                  ? '未知'
                  : `${animation.durationSec.toFixed(2)}s`
              }</b>时长</span>
              <span><b>${animation.channelCount}</b>轨道</span>
              <span><b>${animation.targetNodeCount}</b>节点</span>
            </div>
            <div class="track-row">
              <span>位移 ${animation.tracks.translation}</span>
              <span>旋转 ${animation.tracks.rotation}</span>
              <span>缩放 ${animation.tracks.scale}</span>
              <span>形变 ${animation.tracks.weights}</span>
            </div>
            <details>
              <summary>查看受影响节点</summary>
              <p>${
                animation.targetNodes.length
                  ? animation.targetNodes.map(escapeHtml).join(' · ')
                  : '没有记录节点'
              }</p>
            </details>
          </article>`,
        )
        .join('')
    : '<div class="report-warning">该 GLB 没有 animations 数据，当前不能直接播放爆炸动画。</div>';
  const messages = [...report.errors, ...report.warnings, ...report.manifest.notes];
  elements.animationReport.innerHTML = `
    <div class="report-summary">
      <div>
        <span>动画片段</span>
        <strong>${report.counts.animations}</strong>
      </div>
      <div>
        <span>变换动画</span>
        <strong>${transformClipCount}</strong>
      </div>
      <div>
        <span>网格 / 节点</span>
        <strong>${report.counts.meshes} / ${report.counts.nodes}</strong>
      </div>
      <div>
        <span>自动判定</span>
        <strong class="summary-word">${
          report.manifest.explodeClip ? '可生成配置' : '需补动画'
        }</strong>
      </div>
    </div>
    <div class="clip-list">${animationCards}</div>
    ${
      messages.length
        ? `<div class="report-notes">${messages
            .map((message) => `<p>${escapeHtml(message)}</p>`)
            .join('')}</div>`
        : ''
    }
    <div class="manifest-card">
      <div>
        <span>推荐拆卸轨道</span>
        <strong>${escapeHtml(report.manifest.explodeClip || '未确定')}</strong>
      </div>
      <div>
        <span>安装方式</span>
        <strong>${escapeHtml(
          report.manifest.installClip ||
            (report.manifest.installMode === 'reverse-explode'
              ? '反向播放拆卸轨道'
              : '未确定'),
        )}</strong>
      </div>
      <div class="manifest-actions">
        <button class="small-button" data-animation-action="copy" type="button">复制配置</button>
        <button class="primary-button compact" data-animation-action="download" type="button">下载 JSON</button>
      </div>
    </div>`;
}

async function inspectAnimationFile(file) {
  try {
    await validateModel(file);
    if (file.size > 70 * 1024 * 1024) {
      throw new Error('单个 GLB 请控制在 70MB 以内');
    }
    state.animationFile = file;
    elements.animationStatus.textContent = `${file.name} · ${formatBytes(
      file.size,
    )} · 正在解析轨道…`;
    elements.animationDrop.classList.add('analyzing');
    const model = await fileToDataUrl(file);
    const payload = await api('/api/inspect-animation', {
      method: 'POST',
      body: JSON.stringify({
        assemblyId: elements.assemblyId.value.trim(),
        model,
      }),
    });
    elements.animationStatus.textContent = `${file.name} · ${formatBytes(
      file.size,
    )} · 解析完成`;
    renderAnimationReport(payload.report);
    showToast('动画轨道解析完成');
  } catch (error) {
    state.animationFile = null;
    state.animationReport = null;
    elements.animationStatus.textContent = error.message;
    elements.animationReport.classList.add('hidden');
    elements.animationEmpty.classList.remove('hidden');
    showToast(error.message, 'error');
  } finally {
    elements.animationDrop.classList.remove('analyzing');
  }
}

function animationManifestJson() {
  if (!state.animationReport) return '';
  return JSON.stringify(state.animationReport.manifest, null, 2);
}

async function copyManifest() {
  const content = animationManifestJson();
  if (!content) return;
  await navigator.clipboard.writeText(content);
  showToast('动画配置已复制');
}

function downloadManifest() {
  const content = animationManifestJson();
  if (!content) return;
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const link = document.createElement('a');
  const assemblyId = state.animationReport.manifest.assemblyId || 'assembly';
  link.href = URL.createObjectURL(blob);
  link.download = `${assemblyId}_animation.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  showToast('动画配置已下载');
}

elements.form.addEventListener('submit', submitTarget);
elements.cancelEdit.addEventListener('click', resetForm);
elements.refreshButton.addEventListener('click', loadTargets);
elements.verifyButton.addEventListener('click', verifyAll);
elements.closeDialog.addEventListener('click', () => elements.dialog.close());
elements.targetList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  if (button.dataset.action === 'edit') startEdit(button.dataset.id);
  if (button.dataset.action === 'delete') removeTarget(button.dataset.id);
});
elements.animationReport.addEventListener('click', (event) => {
  const button = event.target.closest('[data-animation-action]');
  if (!button) return;
  if (button.dataset.animationAction === 'copy') copyManifest();
  if (button.dataset.animationAction === 'download') downloadManifest();
});

wireDropZone(elements.imageDrop, elements.imageFile, chooseImage);
wireDropZone(elements.modelDrop, elements.modelFile, chooseModel);
wireDropZone(
  elements.animationDrop,
  elements.animationFile,
  inspectAnimationFile,
);
loadTargets();
