const state = {
  targets: [],
  editingId: '',
  imageFile: null,
  modelFile: null,
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
            <span>${target.image.width}×${target.image.height} · ${formatBytes(
              target.model.bytes,
            )}</span>
            <span>fcode · ${escapeHtml(target.fcode)}</span>
          </div>
          <div class="target-actions">
            <button class="small-button" data-action="edit" data-id="${escapeHtml(
              target.modelId,
            )}">编辑</button>
            <button class="small-button danger" data-action="delete" data-id="${escapeHtml(
              target.modelId,
            )}">删除</button>
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

wireDropZone(elements.imageDrop, elements.imageFile, chooseImage);
wireDropZone(elements.modelDrop, elements.modelFile, chooseModel);
loadTargets();

