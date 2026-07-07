import { buildPaletteSummary, findDominantColor, getReadableTextColor } from './color.js';
import { extractPhotoMetadata } from './exif.js';
import {
  describeColor,
  generateCoverText,
  layoutDefinitions,
  panelDefinitions,
} from './templates.js';

const outputRatioConfig = {
  ratioPresets: [
    { id: '3:4', width: 1080, height: 1440 },
    { id: '4:5', width: 1080, height: 1350 },
    { id: '9:16', width: 1080, height: 1920 },
    { id: '2:3', width: 1080, height: 1620 },
    { id: '1:2', width: 1080, height: 2160 },
  ],
};

const state = {
  photos: [],
  selectedLayout: 'grid9',
  activePanel: 'copy',
  customColor: '#2a4252',
  movieColorOnTop: true,
  copyDirty: false,
  locationCache: new Map(),
  photoTransforms: new Map(),
  imageGesture: {
    activePhotoId: null,
    pointerId: null,
    lastX: 0,
    lastY: 0,
    pointers: new Map(),
    pinchStartDistance: 0,
    pinchStartScale: 1,
  },
  viewport: {
    zoom: 1,
    panX: 0,
    panY: 0,
    isPanning: false,
    pointerId: null,
    lastX: 0,
    lastY: 0,
    spacePressed: false,
    pointers: new Map(),
    pinchStartDistance: 0,
    pinchStartZoom: 1,
  },
  style: {
    radius: 0,
    padding: 0,
    ratio: 50,
    borderless: true,
    fontSize: 24,
    font: 'system',
    outputRatio: '3:4',
  },
};

const els = {
  fileInput: document.querySelector('#fileInput'),
  resetButton: document.querySelector('#resetButton'),
  stashButton: document.querySelector('#stashButton'),
  photoGrid: document.querySelector('#photoGrid'),
  photoCount: document.querySelector('#photoCount'),
  paletteStrip: document.querySelector('#paletteStrip'),
  averageColor: document.querySelector('#averageColor'),
  layoutControls: document.querySelector('#layoutControls'),
  layoutHint: document.querySelector('#layoutHint'),
  panelTabBar: document.querySelector('#panelTabBar'),
  panelContent: document.querySelector('#panelContent'),
  copyGenerateButton: document.querySelector('#copyGenerateButton'),
  copyTextButton: document.querySelector('#copyTextButton'),
  customColorButton: document.querySelector('#customColorButton'),
  customColorInput: document.querySelector('#customColorInput'),
  coverTextInput: document.querySelector('#coverTextInput'),
  ratioInput: document.querySelector('#ratioInput'),
  equalRatioButton: document.querySelector('#equalRatioButton'),
  borderlessInput: document.querySelector('#borderlessInput'),
  radiusInput: document.querySelector('#radiusInput'),
  paddingInput: document.querySelector('#paddingInput'),
  ratioPresetBar: document.querySelector('#ratioPresetBar'),
  ratioResolution: document.querySelector('#ratioResolution'),
  fontSizeInput: document.querySelector('#fontSizeInput'),
  fontSelect: document.querySelector('#fontSelect'),
  canvasViewport: document.querySelector('#canvasViewport'),
  canvasTransform: document.querySelector('#canvasTransform'),
  zoomOutButton: document.querySelector('#zoomOutButton'),
  zoomLevelButton: document.querySelector('#zoomLevelButton'),
  zoomInButton: document.querySelector('#zoomInButton'),
  zoomFitButton: document.querySelector('#zoomFitButton'),
  previewCanvas: document.querySelector('#previewCanvas'),
  workCanvas: document.querySelector('#workCanvas'),
  exportCanvas: document.querySelector('#exportCanvas'),
  exportButton: document.querySelector('#exportButton'),
  exportStatus: document.querySelector('#exportStatus'),
};

init();

function init() {
  renderPanelTabs();
  renderLayoutControls();
  renderRatioPresets();
  bindEvents();
  applyStyleControls();
  applyCanvasViewport();
  seedCoverText(true);
  renderAll();
}

function bindEvents() {
  els.fileInput.addEventListener('change', handleFiles);
  els.resetButton.addEventListener('click', handleResetUpload);
  els.stashButton.addEventListener('click', stashDraft);
  els.copyGenerateButton.addEventListener('click', function () {
    state.copyDirty = false;
    seedCoverText(true);
    renderPreview();
  });
  els.copyTextButton.addEventListener('click', copyCurrentText);
  els.customColorInput.addEventListener('input', function () {
    state.customColor = els.customColorInput.value;
    renderPreview();
    els.exportStatus.textContent = els.customColorInput.value.toUpperCase() + ' 已应用为自定义色。';
  });
  els.exportButton.addEventListener('click', exportPng);
  els.zoomOutButton.addEventListener('click', function () { setCanvasZoom(state.viewport.zoom - 0.1); });
  els.zoomInButton.addEventListener('click', function () { setCanvasZoom(state.viewport.zoom + 0.1); });
  els.zoomLevelButton.addEventListener('click', function () { resetCanvasViewport(false); });
  els.zoomFitButton.addEventListener('click', function () { fitCanvasToViewport(false); });
  els.equalRatioButton.addEventListener('click', function () { setEqualMovieRatio(); });
  els.ratioPresetBar.addEventListener('click', function (event) {
    const button = event.target.closest('button[data-ratio]');
    if (!button) return;
    setOutputRatio(button.dataset.ratio);
  });
  bindCanvasViewportEvents();

  els.coverTextInput.addEventListener('input', function () {
    state.copyDirty = true;
    renderPreview();
  });

  [els.radiusInput, els.paddingInput, els.fontSizeInput, els.ratioInput].forEach(function (input) {
    input.addEventListener('input', function () {
      state.style.radius = Number(els.radiusInput.value);
      state.style.padding = Number(els.paddingInput.value);
      state.style.ratio = Number(els.ratioInput.value);
      state.style.fontSize = Number(els.fontSizeInput.value);
      if ((state.style.radius > 0 || state.style.padding > 0) && state.style.borderless) {
        state.style.borderless = false;
        els.borderlessInput.checked = false;
      }
      applyStyleControls();
      renderPreview();
    });
  });

  els.borderlessInput.addEventListener('change', function () {
    state.style.borderless = els.borderlessInput.checked;
    if (state.style.borderless) {
      state.style.radius = 0;
      state.style.padding = 0;
      els.radiusInput.value = '0';
      els.paddingInput.value = '0';
    }
    applyStyleControls();
    renderPreview();
  });

  els.fontSelect.addEventListener('input', function () {
    state.style.font = els.fontSelect.value;
    applyStyleControls();
    renderPreview();
  });
}

function toggleMovieColorPosition() {
  if (state.selectedLayout !== 'movie-poster') return;
  state.movieColorOnTop = !state.movieColorOnTop;
  renderPreview();
  els.exportStatus.textContent = state.movieColorOnTop ? '色块已切换到上方。' : '色块已切换到下方。';
}

function setEqualMovieRatio() {
  els.ratioInput.value = '50';
  state.style.ratio = 50;
  applyStyleControls();
  renderPreview();
  els.exportStatus.textContent = '已设为上下等大。';
}

async function handleFiles(event) {
  const files = Array.from(event.target.files || []).slice(0, 9 - state.photos.length);
  if (!files.length) return;
  els.exportStatus.textContent = '正在识别图片主色和照片信息...';

  const loaded = await Promise.all(files.map(createPhotoItem));
  state.photos.push(...loaded.filter(Boolean));
  await hydrateLocationLabels(loaded.filter(Boolean));
  state.customColor = getMainColorHex() || state.customColor;
  state.copyDirty = false;
  seedCoverText();
  renderAll();
  els.exportStatus.textContent = '已完成识别，可以继续调整文本和结构。';
  requestAnimationFrame(function () { fitCanvasToViewport(true); });
  event.target.value = '';
}

async function createPhotoItem(file) {
  const src = URL.createObjectURL(file);
  const image = await loadImage(src);
  const dominant = extractDominantColor(image) || { r: 160, g: 160, b: 160, hex: '#a0a0a0' };
  const metadata = await extractPhotoMetadata(file);

  return {
    id: String(Date.now()) + '-' + Math.random().toString(16).slice(2),
    fileName: file.name,
    src,
    image,
    dominantColor: dominant,
    textColor: getReadableTextColor(dominant.hex),
    metadata,
    naturalWidth: image.naturalWidth,
    naturalHeight: image.naturalHeight,
    ratio: image.naturalWidth / image.naturalHeight,
  };
}

function extractDominantColor(image) {
  const canvas = els.workCanvas;
  const size = 72;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, size, size);
  drawImageCover(ctx, image, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size);
  return findDominantColor(data.data, size, size, {
    sampleStep: 2,
    bucketSize: 16,
    ignoreNearWhite: true,
    ignoreNearBlack: true,
  });
}

async function hydrateLocationLabels(photos) {
  await Promise.all(photos.map(resolvePhotoLocation));
}

async function resolvePhotoLocation(photo) {
  const metadata = photo?.metadata || {};
  if (!Number.isFinite(metadata.latitude) || !Number.isFinite(metadata.longitude)) return;
  const cacheKey = metadata.latitude.toFixed(4) + ',' + metadata.longitude.toFixed(4);
  if (state.locationCache.has(cacheKey)) {
    photo.locationLabel = state.locationCache.get(cacheKey);
    return;
  }

  try {
    const response = await fetch('/api/resolve-location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latitude: metadata.latitude, longitude: metadata.longitude }),
    });
    if (!response.ok) return;
    const data = await response.json();
    const label = typeof data.label === 'string' ? data.label.trim() : '';
    if (!label || data.confidence === 'low') return;
    state.locationCache.set(cacheKey, label);
    photo.locationLabel = label;
  } catch {
    // Location lookup is a convenience layer; EXIF-based text should still render.
  }
}

function seedCoverText(force) {
  if (!force && els.coverTextInput.value && state.copyDirty) return;
  const metadata = getPrimaryMetadata();
  const coverText = generateCoverText({
    dominantColor: getMainColorHex() || '#f05f87',
    paletteColors: getPaletteColors(),
    locationLabel: getPrimaryLocationLabel(),
    metadata,
  });

  if (force || !els.coverTextInput.value || !state.copyDirty) {
    els.coverTextInput.value = coverText;
  }
}

function getPrimaryMetadata() {
  return state.photos.find(function (photo) { return photo.metadata; })?.metadata || {};
}

function getPrimaryLocationLabel() {
  return state.photos.find(function (photo) { return photo.locationLabel; })?.locationLabel || '';
}

function getCurrentCoverText() {
  return els.coverTextInput.value.trim();
}

function renderAll() {
  renderPhotos();
  renderPalette();
  renderPreview();
}

function renderPanelTabs() {
  els.panelTabBar.innerHTML = '';
  panelDefinitions.forEach(function (panel) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'panel-tab';
    button.innerHTML = iconHtml(panel.icon) + '<span>' + escapeHtml(panel.label) + '</span>';
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(panel.id === state.activePanel));
    button.addEventListener('click', function () {
      state.activePanel = panel.id;
      renderPanelTabs();
      showActivePanel();
    });
    if (panel.id === state.activePanel) button.classList.add('active');
    els.panelTabBar.append(button);
  });

  showActivePanel();
}

function showActivePanel() {
  els.panelContent.querySelectorAll('[data-panel]').forEach(function (panel) {
    panel.classList.toggle('active', panel.dataset.panel === state.activePanel);
  });
}

function renderRatioPresets() {
  els.ratioPresetBar.querySelectorAll('button[data-ratio]').forEach(function (button) {
    const isActive = button.dataset.ratio === state.style.outputRatio;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });
  applyOutputRatioVars();
}

function setOutputRatio(id) {
  if (!outputRatioConfig.ratioPresets.some(function (preset) { return preset.id === id; })) return;
  state.style.outputRatio = id;
  renderRatioPresets();
  renderPreview();
  els.exportStatus.textContent = '输出比例已切换为 ' + id + '。';
}

function getSelectedRatioPreset() {
  return outputRatioConfig.ratioPresets.find(function (preset) {
    return preset.id === state.style.outputRatio;
  }) || outputRatioConfig.ratioPresets[2];
}

function applyOutputRatioVars() {
  const preset = getSelectedRatioPreset();
  setPreviewVar('--canvas-ratio', preset.width + ' / ' + preset.height);
  els.ratioResolution.textContent = preset.id + ' (' + preset.width + 'x' + preset.height + ')';
}

function setPreviewVar(name, value) {
  document.documentElement.style.setProperty(name, value);
}

function renderLayoutControls() {
  els.layoutControls.innerHTML = '';
  layoutDefinitions.forEach(function (layout) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'layout-option';
    button.title = layout.description;
    button.innerHTML = '<span class="layout-wireframe" aria-hidden="true">' + getLayoutGlyph(layout.id) + '</span><span>' + layout.label + '</span>';
    button.addEventListener('click', function () {
      state.selectedLayout = layout.id;
      if (!state.copyDirty) seedCoverText(true);
      renderLayoutControls();
      renderPreview();
      applyStyleControls();
    });
    if (layout.id === state.selectedLayout) button.classList.add('active');
    els.layoutControls.append(button);
  });
}

function getLayoutGlyph(id) {
  const glyphs = {
    'movie-poster': '<i class="wide swatch"></i><i class="wide"></i>',
    grid9: '<i></i><i></i><i></i><i></i><i></i><i></i>',
    stacked: '<i class="wide"></i><i class="wide small"></i>',
    magazine: '<i class="tall"></i><i></i><i></i>',
    'color-card-poster': '<i class="wide"></i><i class="swatch"></i><i class="wide small"></i>',
  };
  return glyphs[id] || glyphs.grid9;
}

function iconHtml(name) {
  return '<span class="icon icon-' + escapeHtml(name) + '" aria-hidden="true">' + getIconSvg(name) + '</span>';
}

function getIconSvg(name) {
  const icons = {
    layout: '<svg viewBox="0 0 24 24"><path d="M4 5h16"/><path d="M4 12h16"/><path d="M4 19h16"/></svg>',
    palette: '<svg viewBox="0 0 24 24"><path d="M12 4a8 8 0 0 0 0 16h1.5a1.8 1.8 0 0 0 0-3.6H13a1.4 1.4 0 0 1 0-2.8h1.3A5.7 5.7 0 0 0 20 8.4C18.6 5.8 15.6 4 12 4z"/><path d="M8 10h.01"/><path d="M11 8h.01"/><path d="M8.5 14h.01"/></svg>',
    copy: '<svg viewBox="0 0 24 24"><path d="M8 6h11v14H8z"/><path d="M5 17V4h11"/></svg>',
    sliders: '<svg viewBox="0 0 24 24"><path d="M5 7h14"/><path d="M5 12h14"/><path d="M5 17h14"/><path d="M9 5v4"/><path d="M15 10v4"/><path d="M11 15v4"/></svg>',
  };
  return icons[name] || icons.layout;
}

function bindCanvasViewportEvents() {
  els.canvasViewport.addEventListener('dblclick', function (event) {
    if (isTypingTarget(event.target)) return;
    toggleMovieColorPosition();
  });

  els.canvasViewport.addEventListener('wheel', function (event) {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const delta = event.deltaY > 0 ? -0.08 : 0.08;
    setCanvasZoom(state.viewport.zoom + delta);
  }, { passive: false });

  els.canvasViewport.addEventListener('pointerdown', function (event) {
    state.viewport.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (state.viewport.pointers.size === 2) {
      state.viewport.pinchStartDistance = getPointerDistance();
      state.viewport.pinchStartZoom = state.viewport.zoom;
      state.viewport.isPanning = false;
      capturePointer(els.canvasViewport, event.pointerId);
      return;
    }

    if (!canStartPan(event)) return;
    event.preventDefault();
    state.viewport.isPanning = true;
    state.viewport.pointerId = event.pointerId;
    state.viewport.lastX = event.clientX;
    state.viewport.lastY = event.clientY;
    capturePointer(els.canvasViewport, event.pointerId);
    applyCanvasViewport();
  });

  els.canvasViewport.addEventListener('pointermove', function (event) {
    if (state.viewport.pointers.has(event.pointerId)) {
      state.viewport.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }

    if (state.viewport.pointers.size >= 2 && state.viewport.pinchStartDistance > 0) {
      event.preventDefault();
      const distance = getPointerDistance();
      const zoom = state.viewport.pinchStartZoom * (distance / state.viewport.pinchStartDistance);
      setCanvasZoom(zoom);
      return;
    }

    if (!state.viewport.isPanning || state.viewport.pointerId !== event.pointerId) return;
    event.preventDefault();
    const dx = event.clientX - state.viewport.lastX;
    const dy = event.clientY - state.viewport.lastY;
    state.viewport.panX += dx;
    state.viewport.panY += dy;
    state.viewport.lastX = event.clientX;
    state.viewport.lastY = event.clientY;
    applyCanvasViewport();
  });

  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (eventName) {
    els.canvasViewport.addEventListener(eventName, function (event) {
      state.viewport.pointers.delete(event.pointerId);
      if (state.viewport.pointerId === event.pointerId) {
        state.viewport.isPanning = false;
        state.viewport.pointerId = null;
      }
      if (state.viewport.pointers.size < 2) {
        state.viewport.pinchStartDistance = 0;
      }
      applyCanvasViewport();
    });
  });

  window.addEventListener('keydown', function (event) {
    if (event.code !== 'Space' || isTypingTarget(event.target)) return;
    event.preventDefault();
    state.viewport.spacePressed = true;
    applyCanvasViewport();
  });

  window.addEventListener('keyup', function (event) {
    if (event.code !== 'Space') return;
    state.viewport.spacePressed = false;
    state.viewport.isPanning = false;
    applyCanvasViewport();
  });
}

function capturePointer(target, pointerId) {
  try {
    target.setPointerCapture(pointerId);
  } catch (error) {
    // Synthetic test events do not create an active browser pointer; real gestures do.
  }
}

function canStartPan(event) {
  if (event.button !== 0) return false;
  if (isTypingTarget(event.target)) return false;
  return true;
}

function isTypingTarget(target) {
  return ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target?.tagName);
}

function getPointerDistance() {
  const points = Array.from(state.viewport.pointers.values());
  if (points.length < 2) return 0;
  const dx = points[0].x - points[1].x;
  const dy = points[0].y - points[1].y;
  return Math.hypot(dx, dy);
}

function setCanvasZoom(value) {
  state.viewport.zoom = clamp(value, 0.25, 4);
  applyCanvasViewport();
}

function resetCanvasViewport(fitToStage) {
  state.viewport.zoom = 1;
  state.viewport.panX = 0;
  state.viewport.panY = 0;
  state.viewport.isPanning = false;
  state.viewport.pointerId = null;
  applyCanvasViewport();
  els.exportStatus.textContent = fitToStage ? '画布已自适应视口。' : '画布已重置为 100%。';
}

function fitCanvasToViewport(silent) {
  const inset = 48;
  const viewportWidth = Math.max(1, els.canvasViewport.clientWidth - inset);
  const viewportHeight = Math.max(1, els.canvasViewport.clientHeight - inset);
  const canvasWidth = Math.max(1, els.previewCanvas.offsetWidth);
  const canvasHeight = Math.max(1, els.previewCanvas.offsetHeight);
  state.viewport.zoom = clamp(Math.min(viewportWidth / canvasWidth, viewportHeight / canvasHeight), 0.25, 4);
  els.canvasViewport.classList.add('is-fitting');
  state.viewport.panX = 0;
  state.viewport.panY = 0;
  state.viewport.isPanning = false;
  state.viewport.pointerId = null;
  applyCanvasViewport();
  requestAnimationFrame(centerPreviewInViewport);
  if (!silent) els.exportStatus.textContent = '画布已自适应视口。';
}

function centerPreviewInViewport() {
  const previewRect = els.previewCanvas.getBoundingClientRect();
  const viewportRect = els.canvasViewport.getBoundingClientRect();
  const previewCenterX = previewRect.left + previewRect.width / 2;
  const previewCenterY = previewRect.top + previewRect.height / 2;
  const viewportCenterX = viewportRect.left + viewportRect.width / 2;
  const viewportCenterY = viewportRect.top + viewportRect.height / 2;
  const deltaX = viewportCenterX - previewCenterX;
  const deltaY = viewportCenterY - previewCenterY;
  if (Math.abs(deltaX) >= 0.5 || Math.abs(deltaY) >= 0.5) {
    state.viewport.panX += deltaX;
    state.viewport.panY += deltaY;
    applyCanvasViewport();
  }
  requestAnimationFrame(function () {
    els.canvasViewport.classList.remove('is-fitting');
  });
}

function applyCanvasViewport() {
  els.canvasTransform.style.setProperty('--canvas-zoom', state.viewport.zoom.toFixed(3));
  els.canvasTransform.style.setProperty('--canvas-pan-x', Math.round(state.viewport.panX) + 'px');
  els.canvasTransform.style.setProperty('--canvas-pan-y', Math.round(state.viewport.panY) + 'px');
  els.zoomLevelButton.textContent = Math.round(state.viewport.zoom * 100) + '%';
  els.canvasViewport.classList.toggle('is-panning', state.viewport.isPanning);
  els.canvasViewport.classList.add('is-pannable');
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function renderPhotos() {
  els.photoCount.textContent = state.photos.length + ' 张';
  els.photoGrid.innerHTML = '';

  if (!state.photos.length) {
    els.photoGrid.className = 'photo-grid empty-state';
    els.photoGrid.innerHTML = '<p>上传 1 到 9 张照片后，这里会显示主色调和 EXIF 信息。</p>';
    return;
  }

  els.photoGrid.className = 'photo-grid';
  state.photos.forEach(function (photo) {
    const card = document.createElement('article');
    card.className = 'photo-card';

    const img = document.createElement('img');
    img.src = photo.src;
    img.alt = photo.fileName;

    const chip = document.createElement('div');
    chip.className = 'color-chip';
    chip.style.background = photo.dominantColor.hex;
    chip.style.color = getReadableTextColor(photo.dominantColor.hex);
    chip.innerHTML = '<span>' + describeColor(photo.dominantColor.hex) + '</span><span>' + photo.dominantColor.hex.toUpperCase() + '</span>';

    const remove = document.createElement('button');
    remove.className = 'remove-photo';
    remove.type = 'button';
    remove.setAttribute('aria-label', '删除图片');
    remove.textContent = '×';
    remove.addEventListener('click', function () {
      URL.revokeObjectURL(photo.src);
      state.photoTransforms.delete(photo.id);
      state.photos = state.photos.filter(function (item) { return item.id !== photo.id; });
      state.copyDirty = false;
      seedCoverText();
      renderAll();
    });

    card.append(img, chip, remove);
    els.photoGrid.append(card);
  });
}

function renderPalette() {
  els.paletteStrip.innerHTML = '';
  const colors = getPaletteColors();
  const summary = buildPaletteSummary(colors);
  els.averageColor.textContent = state.photos.length ? summary.average.hex.toUpperCase() : '等待图片';

  colors.slice(0, 6).forEach(function (hex) {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'palette-swatch';
    swatch.style.background = hex;
    swatch.style.color = getReadableTextColor(hex);
    swatch.innerHTML = '<strong>' + describeColor(hex) + '</strong><span>' + hex.toUpperCase() + '</span>';
    swatch.addEventListener('click', function () {
      state.customColor = hex;
      renderPreview();
      els.exportStatus.textContent = hex.toUpperCase() + ' 已应用为预览强调色。';
    });
    els.paletteStrip.append(swatch);
  });
}

function renderPreview() {
  const layout = getSelectedLayout();
  const previewColor = state.customColor || getMainColorHex() || '#2a4252';
  const isMoviePoster = layout.id === 'movie-poster';
  const isBorderless = isMoviePoster && state.style.borderless;
  const hasMoviePhoto = isMoviePoster && Boolean(state.photos[0]);
  els.layoutHint.textContent = layout.label;
  els.previewCanvas.className = 'poster-card collage-preview ' + layout.className + ' font-' + state.style.font + (isBorderless ? ' borderless' : '') + (hasMoviePhoto ? ' has-photo' : '');
  applyOutputRatioVars();
  const resolvedPadding = isBorderless ? 0 : state.style.padding;
  const resolvedRadius = isBorderless ? 0 : state.style.radius;
  setPreviewVar('--preview-color', previewColor);
  setPreviewVar('--image-radius', resolvedRadius + 'px');
  setPreviewVar('--image-padding', resolvedPadding + 'px');
  setPreviewVar('--text-font-size', state.style.fontSize + 'px');
  setPreviewVar('--movie-text-color', getReadableTextColor(previewColor));
  setPreviewVar('--movie-color-ratio', state.style.ratio + '%');
  setPreviewVar('--movie-card-ratio', String(getMovieCardRatio()));
  els.previewCanvas.innerHTML = '';

  const inner = document.createElement('div');
  inner.className = isMoviePoster ? 'movie-poster-inner' : 'preview-inner';
  if (hasMoviePhoto) inner.classList.add('has-photo');

  if (isMoviePoster) {
    renderMoviePoster(inner);
    els.previewCanvas.append(inner);
    return;
  }

  const swatches = createPreviewSwatches();

  if (layout.id === 'grid9') {
    inner.append(createPreviewVisual(9), swatches);
  } else if (layout.id === 'stacked') {
    inner.append(createPreviewVisual(1), swatches);
  } else if (layout.id === 'magazine') {
    inner.append(createPreviewVisual(Math.min(Math.max(state.photos.length, 3), 4)), swatches);
  } else {
    inner.append(createPreviewVisual(1), swatches);
  }

  els.previewCanvas.append(inner);
}

function renderMoviePoster(inner) {
  inner.classList.toggle('color-top', state.movieColorOnTop);
  inner.classList.toggle('color-bottom', !state.movieColorOnTop);

  const colorCard = document.createElement('section');
  colorCard.className = 'movie-color-card';
  colorCard.append(createColorWalkTextOverlay('center'));

  const image = createPreviewImage();
  image.classList.add('movie-photo');

  if (state.movieColorOnTop) inner.append(colorCard, image);
  else inner.append(image, colorCard);
}

function createPreviewSwatches() {
  const swatches = document.createElement('div');
  swatches.className = 'preview-swatches';
  getPaletteColors().slice(0, 6).forEach(function (hex) {
    const swatch = document.createElement('div');
    swatch.className = 'preview-swatch';
    swatch.style.background = hex;
    swatches.append(swatch);
  });
  return swatches;
}

function createPreviewVisual(slots) {
  const visual = document.createElement('div');
  visual.className = 'preview-visual';
  visual.append(createPreviewGallery(slots), createColorWalkTextOverlay());
  return visual;
}

function createColorWalkTextOverlay(variant) {
  const overlay = document.createElement('div');
  overlay.className = 'color-walk-text-overlay';
  if (variant === 'center') overlay.classList.add('is-center');

  const text = getCurrentCoverText() || generateCoverText({
    dominantColor: getMainColorHex() || '#f05f87',
    paletteColors: getPaletteColors(),
    locationLabel: getPrimaryLocationLabel(),
    metadata: getPrimaryMetadata(),
  });

  text.split('\n').filter(Boolean).forEach(function (line) {
    appendTextElement(overlay, 'color-walk-text-line', line);
  });
  return overlay;
}

function appendTextElement(parent, className, text) {
  if (!text) return;
  const element = document.createElement('p');
  element.className = className;
  element.textContent = text;
  parent.append(element);
}

function createPreviewImage() {
  const imageWrap = document.createElement('div');
  imageWrap.className = 'preview-image';
  hydratePreviewImage(imageWrap, state.photos[0]);
  return imageWrap;
}

function createPreviewGallery(slots) {
  const gallery = document.createElement('div');
  gallery.className = 'preview-gallery';

  for (let index = 0; index < slots; index += 1) {
    const photo = state.photos[index % Math.max(state.photos.length, 1)];
    const imageWrap = document.createElement('div');
    imageWrap.className = 'preview-image';
    hydratePreviewImage(imageWrap, photo);
    gallery.append(imageWrap);
  }

  return gallery;
}

function hydratePreviewImage(imageWrap, photo) {
  if (!photo) {
    imageWrap.innerHTML = '<span>上传图片</span>';
    return;
  }

  imageWrap.classList.add('has-photo');
  imageWrap.style.setProperty('--raw-ratio', String(photo.ratio));
  imageWrap.dataset.rawRatio = String(photo.ratio);
  imageWrap.dataset.photoId = photo.id;
  applyPhotoTransformToElement(imageWrap, photo.id);

  const img = document.createElement('img');
  img.src = photo.src;
  img.alt = photo.fileName;
  img.style.aspectRatio = photo.naturalWidth + ' / ' + photo.naturalHeight;
  imageWrap.append(img);
  bindImageTransformEvents(imageWrap, photo);
  requestAnimationFrame(function () {
    applyPhotoTransformToElement(imageWrap, photo.id);
  });
}

function bindImageTransformEvents(imageWrap, photo) {
  imageWrap.addEventListener('wheel', function (event) {
    if (event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    event.stopPropagation();
    const transform = getPhotoTransform(photo.id);
    const delta = event.deltaY > 0 ? -0.08 : 0.08;
    setPhotoTransform(photo.id, {
      scale: transform.scale + delta,
      x: transform.x,
      y: transform.y,
    });
    applyPhotoTransformToElement(imageWrap, photo.id);
    els.exportStatus.textContent = '图片焦点缩放至 ' + Math.round(getPhotoTransform(photo.id).scale * 100) + '%。';
  }, { passive: false });

  imageWrap.addEventListener('pointerdown', function (event) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    state.imageGesture.activePhotoId = photo.id;
    state.imageGesture.pointerId = event.pointerId;
    state.imageGesture.lastX = event.clientX;
    state.imageGesture.lastY = event.clientY;
    state.imageGesture.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (state.imageGesture.pointers.size === 2) updateImagePinchStart(photo.id);
    imageWrap.classList.add('is-transforming');
    capturePointer(imageWrap, event.pointerId);
  });

  imageWrap.addEventListener('pointermove', function (event) {
    if (state.imageGesture.activePhotoId !== photo.id || !state.imageGesture.pointers.has(event.pointerId)) return;
    event.preventDefault();
    event.stopPropagation();
    state.imageGesture.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (state.imageGesture.pointers.size >= 2 && state.imageGesture.pinchStartDistance > 0) {
      const distance = getImagePointerDistance();
      const transform = getPhotoTransform(photo.id);
      setPhotoTransform(photo.id, {
        scale: state.imageGesture.pinchStartScale * (distance / state.imageGesture.pinchStartDistance),
        x: transform.x,
        y: transform.y,
      });
      applyPhotoTransformToElement(imageWrap, photo.id);
      return;
    }

    if (state.imageGesture.pointerId !== event.pointerId) return;
    const width = Math.max(1, imageWrap.clientWidth);
    const height = Math.max(1, imageWrap.clientHeight);
    const dx = (event.clientX - state.imageGesture.lastX) / width;
    const dy = (event.clientY - state.imageGesture.lastY) / height;
    const transform = getPhotoTransform(photo.id);
    setPhotoTransform(photo.id, {
      scale: transform.scale,
      x: transform.x + dx,
      y: transform.y + dy,
    });
    state.imageGesture.lastX = event.clientX;
    state.imageGesture.lastY = event.clientY;
    applyPhotoTransformToElement(imageWrap, photo.id);
  });

  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (eventName) {
    imageWrap.addEventListener(eventName, function (event) {
      if (state.imageGesture.activePhotoId !== photo.id) return;
      event.stopPropagation();
      state.imageGesture.pointers.delete(event.pointerId);
      if (state.imageGesture.pointers.size === 0) {
        state.imageGesture.activePhotoId = null;
        state.imageGesture.pointerId = null;
        state.imageGesture.pinchStartDistance = 0;
        imageWrap.classList.remove('is-transforming');
        return;
      }

      const nextPointer = state.imageGesture.pointers.values().next().value;
      state.imageGesture.pointerId = Array.from(state.imageGesture.pointers.keys())[0];
      state.imageGesture.lastX = nextPointer.x;
      state.imageGesture.lastY = nextPointer.y;
      if (state.imageGesture.pointers.size === 1) state.imageGesture.pinchStartDistance = 0;
      else updateImagePinchStart(photo.id);
    });
  });
}

function updateImagePinchStart(photoId) {
  state.imageGesture.pinchStartDistance = getImagePointerDistance();
  state.imageGesture.pinchStartScale = getPhotoTransform(photoId).scale;
}

function getImagePointerDistance() {
  const points = Array.from(state.imageGesture.pointers.values());
  if (points.length < 2) return 0;
  const dx = points[0].x - points[1].x;
  const dy = points[0].y - points[1].y;
  return Math.hypot(dx, dy);
}

function getPhotoTransform(photoId) {
  return state.photoTransforms.get(photoId) || { scale: 1, x: 0, y: 0 };
}

function setPhotoTransform(photoId, transform) {
  state.photoTransforms.set(photoId, clampPhotoTransform(transform));
}

function applyPhotoTransformToElement(element, photoId) {
  const transform = getPhotoTransform(photoId);
  const offsetX = Math.round(transform.x * Math.max(1, element.clientWidth));
  const offsetY = Math.round(transform.y * Math.max(1, element.clientHeight));
  element.style.setProperty('--image-scale', transform.scale.toFixed(3));
  element.style.setProperty('--image-translate-x', offsetX + 'px');
  element.style.setProperty('--image-translate-y', offsetY + 'px');
}

function clampPhotoTransform(transform) {
  const scale = clamp(transform.scale || 1, 1, 4);
  const maxOffset = scale <= 1 ? 0 : Math.min(0.48, (scale - 1) / (scale * 2) + 0.08);
  return {
    scale,
    x: scale <= 1 ? 0 : clamp(transform.x || 0, -maxOffset, maxOffset),
    y: scale <= 1 ? 0 : clamp(transform.y || 0, -maxOffset, maxOffset),
  };
}

function applyStyleControls() {
  applyOutputRatioVars();
  const borderlessMovie = state.selectedLayout === 'movie-poster' && state.style.borderless;
  els.radiusInput.disabled = borderlessMovie;
  els.paddingInput.disabled = borderlessMovie;
  const resolvedPadding = borderlessMovie ? 0 : state.style.padding;
  const resolvedRadius = borderlessMovie ? 0 : state.style.radius;
  setPreviewVar('--image-radius', resolvedRadius + 'px');
  setPreviewVar('--image-padding', resolvedPadding + 'px');
  setPreviewVar('--text-font-size', state.style.fontSize + 'px');
  setPreviewVar('--movie-color-ratio', state.style.ratio + '%');
  setPreviewVar('--movie-card-ratio', String(getMovieCardRatio()));
  els.previewCanvas.classList.toggle('borderless', borderlessMovie);
  els.previewCanvas.classList.remove('font-system', 'font-serif', 'font-hand', 'font-casual');
  els.previewCanvas.classList.add('font-' + state.style.font);
}

function getMovieCardRatio() {
  const photo = state.photos[0];
  if (!photo) return 1;
  const colorWeight = clamp(state.style.ratio, 1, 99);
  const imageWeight = 100 - colorWeight;
  return photo.ratio * (imageWeight / colorWeight);
}

function stashDraft() {
  const draft = {
    selectedLayout: state.selectedLayout,
    activePanel: state.activePanel,
    coverText: els.coverTextInput.value,
    style: state.style,
    customColor: state.customColor,
    colors: getPaletteColors(),
  };
  localStorage.setItem('color-walk-draft', JSON.stringify(draft));
  els.exportStatus.textContent = '已暂存当前布局、封面文字和样式。';
}

async function copyCurrentText() {
  const text = getCurrentCoverText();
  try {
    await navigator.clipboard.writeText(text);
    els.exportStatus.textContent = '封面文字已复制。';
  } catch (error) {
    els.exportStatus.textContent = '复制失败，请手动选择文本复制。';
  }
}

async function exportPng() {
  if (!state.photos.length) {
    els.exportStatus.textContent = '请先上传至少一张图片。';
    return;
  }

  els.exportStatus.textContent = '正在生成 PNG...';
  const canvas = els.exportCanvas;
  canvas.width = 1080;
  canvas.height = state.selectedLayout === 'movie-poster' ? getMoviePosterExportHeight(1080) : getOutputExportHeight(1080);
  const ctx = canvas.getContext('2d');
  drawExport(ctx, canvas.width, canvas.height);

  canvas.toBlob(function (blob) {
    if (!blob) {
      els.exportStatus.textContent = '导出失败，请再试一次。';
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'color-walk-collage.png';
    link.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    els.exportStatus.textContent = '已导出 PNG。';
  }, 'image/png', 0.95);
}

function getMoviePosterExportHeight(width) {
  const photo = state.photos[0];
  if (!photo) return getOutputExportHeight(width);
  const margin = state.style.borderless ? 0 : 72;
  const posterWidth = width - margin * 2;
  const colorWeight = clamp(state.style.ratio, 1, 99);
  const imageWeight = 100 - colorWeight;
  const imageHeight = posterWidth / photo.ratio;
  const colorHeight = imageHeight * (colorWeight / imageWeight);
  return Math.round(colorHeight + imageHeight + margin * 2);
}

function getOutputExportHeight(width) {
  const preset = getSelectedRatioPreset();
  return Math.round(width * (preset.height / preset.width));
}

function drawExport(ctx, width, height) {
  const layout = state.selectedLayout;
  const mainColor = state.customColor || getMainColorHex() || '#2a4252';
  ctx.clearRect(0, 0, width, height);

  if (layout === 'movie-poster') {
    drawExportMoviePoster(ctx, width, height, mainColor);
    return;
  }

  ctx.fillStyle = layout === 'color-card-poster' ? mainColor : '#ffffff';
  ctx.fillRect(0, 0, width, height);

  let textFrame;
  if (layout === 'grid9') textFrame = drawExportGrid(ctx);
  if (layout === 'stacked') textFrame = drawExportStacked(ctx);
  if (layout === 'magazine') textFrame = drawExportMagazine(ctx);
  if (layout === 'color-card-poster') textFrame = drawExportPoster(ctx, mainColor);

  drawExportCoverText(ctx, textFrame || { x: 72, y: 180, w: 936, h: 936 }, layout === 'color-card-poster');
}

function drawExportMoviePoster(ctx, width, height, mainColor) {
  const photo = state.photos[0];
  const margin = state.style.borderless ? 0 : 72;
  const posterX = margin;
  const posterY = margin;
  const posterW = width - margin * 2;
  const posterH = height - margin * 2;
  const colorH = Math.round(posterH * (clamp(state.style.ratio, 1, 99) / 100));
  const imageH = posterH - colorH;
  const colorY = state.movieColorOnTop ? posterY : posterY + imageH;
  const imageY = state.movieColorOnTop ? posterY + colorH : posterY;
  const radius = state.style.borderless ? 0 : state.style.radius;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  if (radius > 0) roundedClip(ctx, posterX, posterY, posterW, posterH, radius);
  ctx.fillStyle = mainColor;
  ctx.fillRect(posterX, colorY, posterW, colorH);
  drawPhotoContain(ctx, photo, posterX, imageY, posterW, imageH, '#111a24');
  ctx.restore();

  drawExportCoverText(ctx, { x: posterX, y: colorY, w: posterW, h: colorH }, true, 'center');
}

function drawExportGrid(ctx) {
  const frame = { x: 72, y: 126, w: 936, h: 936 };
  drawImageGrid(ctx, frame.x, frame.y, frame.w, frame.h, 3, 14);
  drawPalette(ctx, 72, 1090, 936, 52);
  return frame;
}

function drawExportStacked(ctx) {
  const frame = { x: 72, y: 150, w: 936, h: 720 };
  drawImageGrid(ctx, frame.x, frame.y, frame.w, frame.h, 1, 0);
  drawPalette(ctx, 72, 904, 936, 68);
  return frame;
}

function drawExportMagazine(ctx) {
  drawImageGrid(ctx, 72, 150, 590, 760, 1, 0);
  drawImageGrid(ctx, 694, 150, 314, 360, 1, 0);
  drawPalette(ctx, 694, 544, 314, 366, true);
  return { x: 72, y: 150, w: 936, h: 760 };
}

function drawExportPoster(ctx, mainColor) {
  ctx.fillStyle = '#ffffff';
  roundedRect(ctx, 108, 150, 864, 720, 32);
  ctx.fill();
  const frame = { x: 138, y: 180, w: 804, h: 660 };
  drawImageGrid(ctx, frame.x, frame.y, frame.w, frame.h, 1, 0);
  ctx.fillStyle = mainColor;
  roundedRect(ctx, 108, 906, 864, 86, 24);
  ctx.fill();
  drawPalette(ctx, 140, 930, 800, 38);
  return frame;
}

function drawExportCoverText(ctx, frame, onTint, align) {
  const text = getCurrentCoverText() || generateCoverText({
    dominantColor: getMainColorHex() || '#f05f87',
    paletteColors: getPaletteColors(),
    locationLabel: getPrimaryLocationLabel(),
    metadata: getPrimaryMetadata(),
  });
  const left = frame.x + Math.max(34, frame.w * 0.045);
  const top = frame.y + Math.max(34, frame.h * 0.045);
  const maxWidth = frame.w - Math.max(68, frame.w * 0.09);
  const lineHeight = Math.max(25, state.style.fontSize * 1.12);
  const fontSize = Math.max(21, state.style.fontSize * 0.92);
  const lines = text.split('\n').map(function (line) { return line.trim(); }).filter(Boolean).slice(0, 7);

  ctx.save();
  ctx.font = '400 ' + fontSize + 'px ' + getExportFontFamily();

  if (align === 'center') {
    ctx.fillStyle = getReadableTextColor(state.customColor || getMainColorHex() || '#2a4252');
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    const centerX = frame.x + frame.w / 2;
    const startY = frame.y + frame.h / 2 - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach(function (line, index) {
      wrapCenteredText(ctx, line, centerX, startY + index * lineHeight, maxWidth, lineHeight, 2);
    });
    ctx.restore();
    return;
  }

  ctx.fillStyle = onTint ? 'rgba(255,255,255,0.94)' : 'rgba(255,255,255,0.94)';
  ctx.shadowColor = 'rgba(0,0,0,0.32)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 2;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  lines.forEach(function (line, index) {
    wrapText(ctx, line, left, top + fontSize + index * lineHeight, maxWidth, lineHeight, 2);
  });
  ctx.restore();
}

function drawImageGrid(ctx, x, y, w, h, columns, gap) {
  const count = columns === 3 ? 9 : Math.min(state.photos.length, columns * columns);
  const rows = columns === 3 ? 3 : Math.max(1, Math.ceil(count / columns));
  const cellW = (w - gap * (columns - 1)) / columns;
  const cellH = columns === 1 ? h : (h - gap * (rows - 1)) / rows;

  for (let index = 0; index < count; index += 1) {
    const photo = state.photos[index % state.photos.length];
    const col = index % columns;
    const row = Math.floor(index / columns);
    const px = x + col * (cellW + gap);
    const py = y + row * (cellH + gap);
    ctx.save();
    roundedClip(ctx, px, py, cellW, cellH, 24);
    drawPhotoContain(ctx, photo, px, py, cellW, cellH, '#f3f4f6');
    ctx.restore();
    ctx.fillStyle = photo.dominantColor.hex;
    ctx.fillRect(px, py + cellH - 18, cellW, 18);
  }
}

function drawPalette(ctx, x, y, w, h, vertical) {
  const colors = getPaletteColors();
  const size = vertical ? h / colors.length : w / colors.length;
  colors.forEach(function (hex, index) {
    ctx.fillStyle = hex;
    if (vertical) ctx.fillRect(x, y + index * size, w, size + 1);
    else ctx.fillRect(x + index * size, y, size + 1, h);
  });
}

function wrapCenteredText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const chars = String(text).split('');
  const lines = [];
  let line = '';
  for (let index = 0; index < chars.length; index += 1) {
    const testLine = line + chars[index];
    if (ctx.measureText(testLine).width > maxWidth && line) {
      lines.push(line);
      line = chars[index];
      if (lines.length >= maxLines) break;
    } else {
      line = testLine;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  const startY = y - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach(function (item, index) {
    ctx.fillText(item, x, startY + index * lineHeight);
  });
}

function getExportFontFamily() {
  if (state.style.font === 'serif') return 'Georgia, \"Songti SC\", \"SimSun\", serif';
  if (state.style.font === 'hand' || state.style.font === 'casual') return 'cursive';
  return '-apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"PingFang SC\", sans-serif';
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const chars = String(text).split('');
  let line = '';
  let lines = 0;
  for (let index = 0; index < chars.length; index += 1) {
    const testLine = line + chars[index];
    if (ctx.measureText(testLine).width > maxWidth && line) {
      ctx.fillText(line, x, y + lines * lineHeight);
      line = chars[index];
      lines += 1;
      if (lines >= maxLines) return;
    } else {
      line = testLine;
    }
  }
  if (line && lines < maxLines) ctx.fillText(line, x, y + lines * lineHeight);
}

function roundedRect(ctx, x, y, w, h, radius) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
}

function roundedClip(ctx, x, y, w, h, radius) {
  roundedRect(ctx, x, y, w, h, radius);
  ctx.clip();
}

function drawImageCover(ctx, image, x, y, w, h) {
  const scale = Math.max(w / image.naturalWidth, h / image.naturalHeight);
  const sw = w / scale;
  const sh = h / scale;
  const sx = (image.naturalWidth - sw) / 2;
  const sy = (image.naturalHeight - sh) / 2;
  ctx.drawImage(image, sx, sy, sw, sh, x, y, w, h);
}

function drawPhotoContain(ctx, photo, x, y, w, h, background) {
  drawImageContain(ctx, photo.image, x, y, w, h, background, getPhotoTransform(photo.id));
}

function drawImageContain(ctx, image, x, y, w, h, background, transform) {
  const photoTransform = transform || { scale: 1, x: 0, y: 0 };
  ctx.fillStyle = background || '#f3f4f6';
  ctx.fillRect(x, y, w, h);
  const scale = Math.min(w / image.naturalWidth, h / image.naturalHeight) * photoTransform.scale;
  const dw = image.naturalWidth * scale;
  const dh = image.naturalHeight * scale;
  const dx = x + (w - dw) / 2 + photoTransform.x * w;
  const dy = y + (h - dh) / 2 + photoTransform.y * h;
  ctx.drawImage(image, dx, dy, dw, dh);
}

function getSelectedLayout() {
  return layoutDefinitions.find(function (layout) { return layout.id === state.selectedLayout; }) || layoutDefinitions[0];
}

function getPaletteColors() {
  return state.photos.length ? state.photos.map(function (photo) { return photo.dominantColor.hex; }) : ['#3498db', '#e67e22', '#2ecc71', '#e74c3c'];
}

function getMainColorHex() {
  if (!state.photos.length) return '';
  return buildPaletteSummary(state.photos.map(function (photo) { return photo.dominantColor.hex; })).average.hex;
}

function loadImage(src) {
  return new Promise(function (resolve, reject) {
    const image = new Image();
    image.onload = function () { resolve(image); };
    image.onerror = reject;
    image.src = src;
  });
}

function handleResetUpload() {
  const shouldReset = !state.photos.length || window.confirm('重新上传会清空当前画布，继续吗？');
  if (!shouldReset) return;
  resetApp();
  els.fileInput.click();
}

function resetApp() {
  state.photos.forEach(function (photo) { URL.revokeObjectURL(photo.src); });
  state.photos = [];
  state.photoTransforms.clear();
  state.imageGesture.activePhotoId = null;
  state.imageGesture.pointerId = null;
  state.imageGesture.pointers.clear();
  state.imageGesture.pinchStartDistance = 0;
  state.copyDirty = false;
  state.customColor = '#2a4252';
  state.movieColorOnTop = true;
  state.style.ratio = 50;
  state.style.borderless = true;
  state.style.outputRatio = '3:4';
  els.ratioInput.value = '50';
  els.borderlessInput.checked = true;
  state.viewport.zoom = 1;
  state.viewport.panX = 0;
  state.viewport.panY = 0;
  state.viewport.isPanning = false;
  state.viewport.pointerId = null;
  state.selectedLayout = 'grid9';
  state.activePanel = 'copy';
  els.coverTextInput.value = '';
  renderPanelTabs();
  renderLayoutControls();
  renderRatioPresets();
  applyCanvasViewport();
  seedCoverText(true);
  renderAll();
  els.exportStatus.textContent = '';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, function (char) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char];
  });
}
