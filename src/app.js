import { buildPaletteSummary, findDominantColor, getReadableTextColor } from './color.js';
import { parseDraft, serializeDraft } from './draft.js';
import { extractPhotoMetadata } from './exif.js';
import { buildReverseGeocodeUrl, formatReverseGeocodeLabel } from './geocode.js';
import {
  describeColor,
  generateCoverText,
  layoutDefinitions,
  panelDefinitions,
} from './templates.js';

const DRAFT_STORAGE_KEY = 'color-walk-draft';
const GEOCODE_CACHE_KEY = 'color-walk-geocode-cache';
const DIRECT_NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org/reverse';
let draftSaveTimer = 0;

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
  restoringDraft: false,
  draggedPhotoId: null,
  draggedColorIndex: null,
  paletteOrder: [],
  paletteWeights: {},
  visionInsight: null,

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
  clearDraftButton: document.querySelector('#clearDraftButton'),

  photoGrid: document.querySelector('#photoGrid'),
  photoCount: document.querySelector('#photoCount'),
  paletteStrip: document.querySelector('#paletteStrip'),
  averageColor: document.querySelector('#averageColor'),
  layoutControls: document.querySelector('#layoutControls'),
  layoutHint: document.querySelector('#layoutHint'),
  panelTabBar: document.querySelector('#panelTabBar'),
  panelContent: document.querySelector('#panelContent'),
  aiAnalyzeButton: document.querySelector('#aiAnalyzeButton'),
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
  fontSizeValue: document.querySelector('#fontSizeValue'),
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

async function init() {
  renderPanelTabs();
  renderLayoutControls();
  renderRatioPresets();
  bindEvents();
  applyStyleControls();
  applyCanvasViewport();
  const restored = await restoreDraft();
  if (!restored) seedCoverText(true);

  renderAll();
  if (restored) els.exportStatus.textContent = '已恢复上次草稿。';
}

function bindEvents() {
  els.fileInput.addEventListener('change', handleFiles);
  els.resetButton.addEventListener('click', handleResetUpload);
  els.stashButton.addEventListener('click', stashDraft);
  els.clearDraftButton.addEventListener('click', clearSavedDraft);
  els.aiAnalyzeButton.addEventListener('click', analyzePhotosWithAI);
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
    input.addEventListener('input', handleStyleRangeInput);
    input.addEventListener('change', handleStyleRangeInput);
  });

  els.borderlessInput.addEventListener('change', handleBorderlessInput);


  els.fontSelect.addEventListener('input', function () {
    state.style.font = els.fontSelect.value;
    applyStyleControls();
    renderPreview();
  });
}

function handleStyleRangeInput() {
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
}

function handleBorderlessInput() {
  state.style.borderless = els.borderlessInput.checked;
  if (state.style.borderless) {
    state.style.radius = 0;
    state.style.padding = 0;
    els.radiusInput.value = '0';
    els.paddingInput.value = '0';
  }
  applyStyleControls();
  renderPreview();
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
  const dataUrl = await fileToDataUrl(file);
  const image = await loadImage(dataUrl);
  const dominant = extractDominantColor(image) || { r: 160, g: 160, b: 160, hex: '#a0a0a0' };
  const metadata = await extractPhotoMetadata(file);

  return {
    id: String(Date.now()) + '-' + Math.random().toString(16).slice(2),
    fileName: file.name,
    src: dataUrl,
    dataUrl,
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
  await Promise.all(photos.map(reverseGeocodePhoto));
}

async function reverseGeocodePhoto(photo) {
  const latitude = photo?.metadata?.latitude;
  const longitude = photo?.metadata?.longitude;
  if (latitude === null || latitude === undefined || longitude === null || longitude === undefined) return;

  const cacheKey = Number(latitude).toFixed(5) + ',' + Number(longitude).toFixed(5);
  if (state.locationCache.has(cacheKey)) {
    applyReverseGeocodeLabel(state.locationCache.get(cacheKey), photo, false);
    return;
  }

  const cache = readGeocodeCache();
  if (cache[cacheKey]) {
    state.locationCache.set(cacheKey, cache[cacheKey]);
    applyReverseGeocodeLabel(cache[cacheKey], photo, false);
    return;
  }

  const endpoints = getReverseGeocodeEndpoints(latitude, longitude);
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, { headers: { Accept: 'application/json' } });
      if (!response.ok) continue;
      const data = await response.json();
      const label = data.label || formatReverseGeocodeLabel(data);
      if (!label) continue;
      state.locationCache.set(cacheKey, label);
      cache[cacheKey] = label;
      writeGeocodeCache(cache);
      applyReverseGeocodeLabel(label, photo, true);
      return;
    } catch (error) {
      // Try the next configured endpoint; the coordinate label remains usable offline.
    }
  }
  els.exportStatus.textContent = '无法反查地点，请检查网络或稍后重试。';
}

function applyReverseGeocodeLabel(label, photo, showStatus) {
  photo.locationLabel = label;
  photo.metadata.placeLabel = label;
  if (!state.copyDirty) {
    seedCoverText();
    renderPreview();
  }
  if (showStatus) els.exportStatus.textContent = '已反查地点：' + label + '。地点数据来自 OpenStreetMap/Nominatim。';
}

function getReverseGeocodeEndpoints(latitude, longitude) {
  const customEndpoint = window.COLOR_WALK_CONFIG?.reverseGeocodeEndpoint || '';
  const endpoints = [];
  if (customEndpoint) endpoints.push(buildReverseGeocodeUrl(customEndpoint, latitude, longitude));
  endpoints.push(buildReverseGeocodeUrl('/api/reverse-geocode', latitude, longitude));

  const directUrl = new URL(DIRECT_NOMINATIM_ENDPOINT);
  directUrl.searchParams.set('format', 'jsonv2');
  directUrl.searchParams.set('addressdetails', '1');
  directUrl.searchParams.set('namedetails', '1');
  directUrl.searchParams.set('zoom', '17');
  directUrl.searchParams.set('layer', 'address,poi');
  directUrl.searchParams.set('accept-language', 'zh-CN');
  directUrl.searchParams.set('lat', String(latitude));
  directUrl.searchParams.set('lon', String(longitude));
  endpoints.push(directUrl.toString());
  return endpoints.filter(Boolean);
}

function readGeocodeCache() {
  try {
    return JSON.parse(localStorage.getItem(GEOCODE_CACHE_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function writeGeocodeCache(cache) {
  try {
    localStorage.setItem(GEOCODE_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Cache misses are acceptable; reverse geocoding still works when online.
  }
}

async function analyzePhotosWithAI() {
  if (!state.photos.length) {
    els.exportStatus.textContent = '请先上传图片，再使用 AI 识图。';
    return;
  }

  els.aiAnalyzeButton.disabled = true;
  els.exportStatus.textContent = 'AI 正在识别图片内容...';
  try {
    const metadata = getPrimaryMetadata();
    const response = await fetch('/api/analyze-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        images: state.photos.slice(0, 4).map(function (photo) {
          return {
            dataUrl: photo.dataUrl || photo.src,
            fileName: photo.fileName,
          };
        }),
        context: {
          coverText: els.coverTextInput.value,
          location: getPrimaryLocationLabel(),
          date: metadata.displayDate || metadata.date || '',
        },
      }),
    });

    const payload = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      const reason = payload.code || payload.error || 'analyze_failed';
      throw new Error(reason);
    }

    applyVisionInsight(payload.insight || {});
  } catch (error) {
    els.exportStatus.textContent = getAiErrorMessage(error);
  } finally {
    els.aiAnalyzeButton.disabled = false;
  }
}

function getAiErrorMessage(error) {
  if (error?.message === 'openai_api_key_missing') return 'AI 识图暂时不可用：缺少 OpenAI API Key。';
  if (error?.message === 'insufficient_quota') return 'AI 识图暂时不可用：OpenAI 额度不足。';
  return 'AI 识图失败，请稍后再试或继续手动输入。';
}

function applyVisionInsight(insight) {
  const normalized = normalizeClientVisionInsight(insight);
  state.visionInsight = normalized;
  state.copyDirty = false;

  const generated = generateCoverText({
    dominantColor: getMainColorHex() || '#f05f87',
    paletteColors: getPaletteColors(),
    locationLabel: getPrimaryLocationLabel(),
    metadata: getPrimaryMetadata(),
  });
  const highlights = normalized.keywords.concat(normalized.subjects).slice(0, 4).join(' / ');
  const aiLines = [
    normalized.scene,
    normalized.mood,
    highlights ? 'AI识图：' + highlights : '',
    normalized.description,
  ].filter(Boolean);
  els.coverTextInput.value = [generated].concat(aiLines).filter(Boolean).join('\n');

  renderPreview();
  scheduleDraftSave();
  const visibleKeywords = normalized.keywords.slice(0, 4).join('、') || normalized.scene || '图片内容';
  els.exportStatus.textContent = 'AI 已识别：' + visibleKeywords + '。';
}

function normalizeClientVisionInsight(insight = {}) {
  return {
    keywords: normalizeTextList(insight.keywords, 8),
    subjects: normalizeTextList(insight.subjects, 6),
    scene: cleanPlainText(insight.scene).slice(0, 40),
    mood: cleanPlainText(insight.mood).slice(0, 32),
    description: cleanPlainText(insight.description).slice(0, 140),
    tags: normalizeTextList(insight.tags, 8),
  };
}

function normalizeTextList(value, limit) {
  return Array.isArray(value)
    ? value.map(cleanPlainText).filter(Boolean).filter(function (item, index, list) { return list.indexOf(item) === index; }).slice(0, limit)
    : [];
}

function cleanPlainText(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
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
    card.dataset.photoId = photo.id;
    card.draggable = true;
    card.addEventListener('dragstart', function (event) {
      state.draggedPhotoId = photo.id;
      card.classList.add('is-dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', photo.id);
    });
    card.addEventListener('dragend', function () {
      state.draggedPhotoId = null;
      card.classList.remove('is-dragging');
    });
    card.addEventListener('dragover', function (event) {
      if (!state.draggedPhotoId || state.draggedPhotoId === photo.id) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    });
    card.addEventListener('drop', function (event) {
      event.preventDefault();
      const draggedId = event.dataTransfer.getData('text/plain') || state.draggedPhotoId;
      movePhoto(draggedId, photo.id);
    });

    const thumb = document.createElement('div');
    thumb.className = 'photo-thumb';

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
      revokePhotoUrl(photo);
      state.photoTransforms.delete(photo.id);
      state.photos = state.photos.filter(function (item) { return item.id !== photo.id; });
      state.copyDirty = false;
      seedCoverText();
      renderAll();
    });

    thumb.append(img, chip, remove);
    card.append(thumb, createPhotoCropControls(photo));
    els.photoGrid.append(card);
  });
}

function createPhotoCropControls(photo) {
  const controls = document.createElement('div');
  controls.className = 'photo-crop-controls';
  controls.dataset.photoId = photo.id;
  controls.setAttribute('aria-label', '调整 ' + photo.fileName + ' 裁切');
  controls.addEventListener('pointerdown', stopPhotoCardControlEvent);
  controls.addEventListener('dragstart', stopPhotoCardControlEvent);

  const field = document.createElement('label');
  field.className = 'photo-crop-field';
  const labelRow = document.createElement('span');
  labelRow.className = 'photo-crop-label';
  const labelText = document.createElement('span');
  labelText.textContent = '裁切';
  const value = document.createElement('output');
  value.className = 'photo-crop-value';
  labelRow.append(labelText, value);

  const slider = document.createElement('input');
  slider.className = 'photo-crop-slider';
  slider.type = 'range';
  slider.min = '100';
  slider.max = '400';
  slider.step = '5';
  slider.setAttribute('aria-label', '调整 ' + photo.fileName + ' 裁切缩放');
  slider.addEventListener('input', function (event) {
    event.stopPropagation();
    setPhotoCropScale(photo.id, Number(slider.value) / 100);
    els.exportStatus.textContent = '图片裁切缩放至 ' + Math.round(getPhotoTransform(photo.id).scale * 100) + '%。';
  });
  field.append(labelRow, slider);

  controls.append(
    field,
    createPhotoCropButton(photo, 'zoom-out', '−', '缩小 ' + photo.fileName + ' 裁切'),
    createPhotoCropButton(photo, 'zoom-in', '+', '放大 ' + photo.fileName + ' 裁切'),
    createPhotoCropButton(photo, 'reset', '↺', '重置 ' + photo.fileName + ' 裁切'),
  );
  updatePhotoCropControls(controls, photo.id);
  return controls;
}

function createPhotoCropButton(photo, action, label, ariaLabel) {
  const button = document.createElement('button');
  button.className = 'photo-crop-button';
  button.type = 'button';
  button.textContent = label;
  button.setAttribute('data-crop-action', action);
  button.setAttribute('aria-label', ariaLabel);
  button.addEventListener('click', function (event) {
    event.preventDefault();
    event.stopPropagation();
    const transform = getPhotoTransform(photo.id);
    if (action === 'zoom-out') setPhotoCropScale(photo.id, transform.scale - 0.1);
    if (action === 'zoom-in') setPhotoCropScale(photo.id, transform.scale + 0.1);
    if (action === 'reset') resetPhotoTransform(photo.id);
    els.exportStatus.textContent = action === 'reset'
      ? '图片裁切已重置。'
      : '图片裁切缩放至 ' + Math.round(getPhotoTransform(photo.id).scale * 100) + '%。';
  });
  return button;
}

function stopPhotoCardControlEvent(event) {
  event.stopPropagation();
}

function updatePhotoCropControls(controls, photoId) {
  const transform = getPhotoTransform(photoId);
  const percent = Math.round(transform.scale * 100);
  const slider = controls.querySelector('.photo-crop-slider');
  const value = controls.querySelector('.photo-crop-value');
  const zoomOut = controls.querySelector('[data-crop-action="zoom-out"]');
  const reset = controls.querySelector('[data-crop-action="reset"]');
  if (slider) slider.value = String(percent);
  if (value) value.textContent = percent + '%';
  if (zoomOut) zoomOut.disabled = percent <= 100;
  if (reset) reset.disabled = percent <= 100 && transform.x === 0 && transform.y === 0;
}

function syncPhotoCropControls(photoId) {
  els.photoGrid.querySelectorAll('.photo-crop-controls[data-photo-id="' + cssEscape(photoId) + '"]').forEach(function (controls) {
    updatePhotoCropControls(controls, photoId);
  });
}

function movePhoto(sourceId, targetId) {
  if (!sourceId || !targetId || sourceId === targetId) return;
  const sourceIndex = state.photos.findIndex(function (photo) { return photo.id === sourceId; });
  const targetIndex = state.photos.findIndex(function (photo) { return photo.id === targetId; });
  if (sourceIndex === -1 || targetIndex === -1) return;
  const moved = state.photos.splice(sourceIndex, 1)[0];
  state.photos.splice(targetIndex, 0, moved);
  renderAll();
  els.exportStatus.textContent = '图片顺序已更新。';
}

function movePaletteColor(sourceIndex, targetIndex) {
  const from = Number(sourceIndex);
  const to = Number(targetIndex);
  const colors = getPaletteColors();
  if (!Number.isInteger(from) || !Number.isInteger(to) || from === to || from < 0 || to < 0 || from >= colors.length || to >= colors.length) return;
  const moved = colors.splice(from, 1)[0];
  colors.splice(to, 0, moved);
  state.paletteOrder = colors.map(normalizeHexColor).filter(Boolean);
  renderAll();
  els.exportStatus.textContent = '色块顺序已更新。';
}

function renderPalette() {
  els.paletteStrip.innerHTML = '';
  const colors = getPaletteColors();
  const summary = buildPaletteSummary(colors);
  els.averageColor.textContent = state.photos.length ? summary.average.hex.toUpperCase() : '等待图片';

  colors.slice(0, 6).forEach(function (hex, index) {
    const item = document.createElement('div');
    item.className = 'palette-swatch-item';

    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'palette-swatch';
    swatch.draggable = true;
    swatch.dataset.paletteIndex = String(index);
    swatch.setAttribute('aria-label', '拖拽调整色块位置，点击应用 ' + hex.toUpperCase());
    swatch.style.background = hex;
    swatch.style.color = getReadableTextColor(hex);
    swatch.style.flexGrow = String(getPaletteColorWeight(hex));
    swatch.innerHTML = '<strong>' + describeColor(hex) + '</strong><span>' + hex.toUpperCase() + '</span>';
    swatch.addEventListener('dragstart', function (event) {
      state.draggedColorIndex = index;
      swatch.classList.add('is-dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(index));
    });
    swatch.addEventListener('dragend', function () {
      state.draggedColorIndex = null;
      swatch.classList.remove('is-dragging');
    });
    swatch.addEventListener('dragover', function (event) {
      if (state.draggedColorIndex === null || state.draggedColorIndex === index) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    });
    swatch.addEventListener('drop', function (event) {
      event.preventDefault();
      const draggedIndex = event.dataTransfer.getData('text/plain') || state.draggedColorIndex;
      movePaletteColor(draggedIndex, index);
    });
    swatch.addEventListener('click', function () {
      state.customColor = hex;
      renderPreview();
      els.exportStatus.textContent = hex.toUpperCase() + ' 已应用为预览强调色。';
    });

    item.append(swatch, createPaletteSizeControls(hex));
    els.paletteStrip.append(item);
  });
}

function createPaletteSizeControls(hex) {
  const controls = document.createElement('div');
  controls.className = 'palette-size-controls';
  controls.setAttribute('aria-label', '调整 ' + hex.toUpperCase() + ' 色块尺寸');
  controls.append(
    createPaletteSizeButton(hex, 'smaller', '-', '缩小 ' + hex.toUpperCase() + ' 色块'),
    createPaletteSizeButton(hex, 'larger', '+', '放大 ' + hex.toUpperCase() + ' 色块'),
    createPaletteSizeButton(hex, 'reset', '1:1', '重置 ' + hex.toUpperCase() + ' 色块尺寸'),
  );
  return controls;
}

function createPaletteSizeButton(hex, action, label, ariaLabel) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'palette-size-button';
  button.textContent = label;
  button.setAttribute('data-palette-size-action', action);
  button.setAttribute('aria-label', ariaLabel);
  button.addEventListener('click', function (event) {
    event.preventDefault();
    event.stopPropagation();
    const current = getPaletteColorWeight(hex);
    if (action === 'smaller') setPaletteColorWeight(hex, current - 0.2);
    if (action === 'larger') setPaletteColorWeight(hex, current + 0.2);
    if (action === 'reset') setPaletteColorWeight(hex, 1);
  });
  return button;
}

function setPaletteColorWeight(hex, weight) {
  const key = normalizeHexColor(hex);
  if (!key) return;
  const next = Math.round(clamp(Number(weight) || 1, 0.5, 2) * 10) / 10;
  if (next === 1) delete state.paletteWeights[key];
  else state.paletteWeights[key] = next;
  renderAll();
  els.exportStatus.textContent = key.toUpperCase() + ' 色块占比已调整为 ' + next.toFixed(1) + '。';
}

function getPaletteColorWeight(hex) {
  const key = normalizeHexColor(hex);
  const weight = key ? Number(state.paletteWeights[key]) : 1;
  return Number.isFinite(weight) ? clamp(weight, 0.5, 2) : 1;
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
    scheduleDraftSave();
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
  scheduleDraftSave();
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
    swatch.style.flexGrow = String(getPaletteColorWeight(hex));
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
  applyPhotoTransformToPreviewInstances(photoId);
  syncPhotoCropControls(photoId);
  scheduleDraftSave();
}

function setPhotoCropScale(photoId, scale) {
  const transform = getPhotoTransform(photoId);
  setPhotoTransform(photoId, {
    scale,
    x: transform.x,
    y: transform.y,
  });
}

function resetPhotoTransform(photoId) {
  state.photoTransforms.delete(photoId);
  applyPhotoTransformToPreviewInstances(photoId);
  syncPhotoCropControls(photoId);
  scheduleDraftSave();
}

function applyPhotoTransformToPreviewInstances(photoId) {
  els.previewCanvas.querySelectorAll('.preview-image[data-photo-id="' + cssEscape(photoId) + '"]').forEach(function (element) {
    applyPhotoTransformToElement(element, photoId);
  });
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

function cssEscape(value) {
  if (window.CSS?.escape) return window.CSS.escape(String(value));
  const slash = String.fromCharCode(92);
  const quote = String.fromCharCode(34);
  return String(value).split(slash).join(slash + slash).split(quote).join(slash + quote);
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
  scheduleDraftSave();
}

function syncRangeValueOutputs() {
  els.fontSizeValue.textContent = state.style.fontSize + 'px';
}

function getMovieCardRatio() {
  const photo = state.photos[0];
  if (!photo) return 1;
  const colorWeight = clamp(state.style.ratio, 1, 99);
  const imageWeight = 100 - colorWeight;
  return photo.ratio * (imageWeight / colorWeight);
}

function stashDraft() {
  saveDraft(true);
}

function clearSavedDraft() {
  clearTimeout(draftSaveTimer);
  draftSaveTimer = 0;
  try {
    localStorage.removeItem(DRAFT_STORAGE_KEY);
    els.exportStatus.textContent = '本地草稿已清除，当前画布保留。';
  } catch (error) {
    els.exportStatus.textContent = '草稿清除失败，请检查浏览器存储权限。';
  }
}

function scheduleDraftSave() {
  if (state.restoringDraft) return;
  clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(function () { saveDraft(false); }, 250);
}

function saveDraft(showStatus) {
  try {
    localStorage.setItem(DRAFT_STORAGE_KEY, serializeDraft(getDraftSnapshot()));
    if (showStatus) els.exportStatus.textContent = '已保存当前图片、布局、文案和样式草稿。';
  } catch (error) {
    if (showStatus) els.exportStatus.textContent = '草稿保存失败，可能是图片过大导致浏览器存储空间不足。';
  }
}

function getDraftSnapshot() {
  return {
    selectedLayout: state.selectedLayout,
    activePanel: state.activePanel,
    coverText: els.coverTextInput.value,
    customColor: state.customColor,
    movieColorOnTop: state.movieColorOnTop,
    paletteOrder: state.paletteOrder,
    paletteWeights: state.paletteWeights,
    visionInsight: state.visionInsight,
    fields: {
      coverText: els.coverTextInput.value,
    },
    style: state.style,
    photos: state.photos.map(function (photo) {
      return {
        id: photo.id,
        fileName: photo.fileName,
        dataUrl: photo.dataUrl || photo.src,
        dominantColor: photo.dominantColor,
        textColor: photo.textColor,
        metadata: photo.metadata,
        naturalWidth: photo.naturalWidth,
        naturalHeight: photo.naturalHeight,
        ratio: photo.ratio,
        transform: getPhotoTransform(photo.id),
      };
    }),
  };
}

async function restoreDraft() {
  const draft = parseDraft(localStorage.getItem(DRAFT_STORAGE_KEY));
  if (!draft) return false;
  state.restoringDraft = true;
  try {
    state.selectedLayout = draft.selectedLayout;
    state.activePanel = draft.activePanel;
    state.customColor = draft.customColor;
    state.movieColorOnTop = draft.movieColorOnTop;
    state.paletteOrder = draft.paletteOrder;
    state.paletteWeights = draft.paletteWeights;
    state.visionInsight = draft.visionInsight;
    state.style = { ...state.style, ...draft.style };
    els.coverTextInput.value = draft.coverText || draft.fields.coverText;
    state.photos = [];
    state.photoTransforms.clear();
    for (const photo of draft.photos) {
      const image = await loadImage(photo.dataUrl);
      state.photos.push({ ...photo, src: photo.dataUrl, image });
      state.photoTransforms.set(photo.id, photo.transform);
    }
    renderPanelTabs();
    renderLayoutControls();
    renderRatioPresets();
    syncStyleInputs();
    applyCanvasViewport();
    return true;
  } catch (error) {
    localStorage.removeItem(DRAFT_STORAGE_KEY);
    return false;
  } finally {
    state.restoringDraft = false;
  }
}

function syncStyleInputs() {
  els.radiusInput.value = String(state.style.radius);
  els.paddingInput.value = String(state.style.padding);
  els.ratioInput.value = String(state.style.ratio);
  els.borderlessInput.checked = state.style.borderless;
  els.fontSizeInput.value = String(state.style.fontSize);
  els.fontSelect.value = state.style.font;
  applyStyleControls();
}

async function copyCurrentText() {
  const copied = await copyTextToClipboard(getCurrentCoverText());
  els.exportStatus.textContent = copied ? '文案已复制。' : '复制失败，请手动选择文本复制。';
}

async function copyTextToClipboard(text) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard_unavailable');
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    return copyTextWithSelectionFallback(text);
  }
}

function copyTextWithSelectionFallback(text) {
  if (typeof document.execCommand !== 'function') return false;

  const activeElement = document.activeElement;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.inset = '0 auto auto -9999px';
  document.body.append(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  try {
    return document.execCommand('copy');
  } catch (error) {
    return false;
  } finally {
    textarea.remove();
    if (activeElement && typeof activeElement.focus === 'function') activeElement.focus();
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
  canvas.height = getDomExportHeight(canvas.width);

  const ctx = canvas.getContext('2d');
  try {
    await drawPreviewDomToCanvas(ctx, canvas.width, canvas.height);
    if (isCanvasSnapshotSuspicious(ctx, canvas.width, canvas.height)) {
      drawExport(ctx, canvas.width, canvas.height);
    }
  } catch (error) {
    drawExport(ctx, canvas.width, canvas.height);
  }

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

function getDomExportHeight(width) {
  const rect = els.previewCanvas.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) return Math.round(width * (rect.height / rect.width));
  return state.selectedLayout === 'movie-poster' ? getMoviePosterExportHeight(width) : getOutputExportHeight(width);
}

function isCanvasSnapshotSuspicious(ctx, width, height) {
  const points = [
    [0.12, 0.12], [0.5, 0.12], [0.88, 0.12],
    [0.12, 0.5], [0.5, 0.5], [0.88, 0.5],
    [0.12, 0.88], [0.5, 0.88], [0.88, 0.88],
  ];
  return points.every(function (point) {
    const x = Math.min(width - 1, Math.max(0, Math.round(point[0] * width)));
    const y = Math.min(height - 1, Math.max(0, Math.round(point[1] * height)));
    const pixel = ctx.getImageData(x, y, 1, 1).data;
    return pixel[3] === 0 || (pixel[0] < 3 && pixel[1] < 3 && pixel[2] < 3);
  });
}

async function drawPreviewDomToCanvas(ctx, width, height) {
  const clone = clonePreviewForExport(width, height);
  const cssText = collectExportCssText();
  const serialized = new XMLSerializer().serializeToString(clone);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml"><style>' + cssText + '</style>' + serialized + '</div></foreignObject></svg>';
  const image = await loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
}

function clonePreviewForExport(width, height) {
  const clone = els.previewCanvas.cloneNode(true);
  clone.style.width = width + 'px';
  clone.style.height = height + 'px';
  clone.style.maxWidth = 'none';
  clone.style.maxHeight = 'none';
  clone.style.boxShadow = 'none';
  clone.style.transform = 'none';
  return clone;
}

function collectExportCssText() {
  return Array.from(document.styleSheets).map(function (sheet) {
    try {
      return Array.from(sheet.cssRules).map(function (rule) { return rule.cssText; }).join('\n');
    } catch {
      return '';
    }
  }).join('\n');
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
  getPaletteSizeSegments(colors, vertical ? h : w).forEach(function (segment) {
    ctx.fillStyle = segment.hex;
    if (vertical) ctx.fillRect(x, y + segment.offset, w, segment.size + 1);
    else ctx.fillRect(x + segment.offset, y, segment.size + 1, h);
  });
}

function getPaletteSizeSegments(colors, totalSize) {
  const weights = colors.map(getPaletteColorWeight);
  const totalWeight = weights.reduce(function (sum, weight) { return sum + weight; }, 0) || colors.length || 1;
  let offset = 0;
  return colors.map(function (hex, index) {
    const size = index === colors.length - 1 ? totalSize - offset : totalSize * (weights[index] / totalWeight);
    const segment = { hex, offset, size };
    offset += size;
    return segment;
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
  const colors = state.photos.length
    ? state.photos.map(function (photo) { return photo.dominantColor.hex; })
    : ['#f05f87', '#6aa9ff', '#82c784', '#f1c84b'];
  return applyPaletteOrder(colors.map(normalizeHexColor).filter(Boolean));
}

function applyPaletteOrder(colors) {
  if (!state.paletteOrder.length) return colors;
  const remaining = colors.slice();
  const ordered = [];
  state.paletteOrder.forEach(function (savedHex) {
    const hex = normalizeHexColor(savedHex);
    if (!hex) return;
    const index = remaining.findIndex(function (item) { return item.toLowerCase() === hex.toLowerCase(); });
    if (index !== -1) ordered.push(remaining.splice(index, 1)[0]);
  });
  return ordered.concat(remaining);
}

function normalizeHexColor(value) {
  const hex = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(hex) ? hex.toLowerCase() : '';

}

function getMainColorHex() {
  if (!state.photos.length) return '';
  return buildPaletteSummary(state.photos.map(function (photo) { return photo.dominantColor.hex; })).average.hex;
}

function fileToDataUrl(file) {
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onload = function () { resolve(String(reader.result || '')); };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
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
  state.photos.forEach(revokePhotoUrl);
  localStorage.removeItem(DRAFT_STORAGE_KEY);
  state.photos = [];
  state.photoTransforms.clear();
  state.paletteOrder = [];
  state.paletteWeights = {};
  state.imageGesture.activePhotoId = null;
  state.imageGesture.pointerId = null;
  state.imageGesture.pointers.clear();
  state.imageGesture.pinchStartDistance = 0;
  state.copyDirty = false;
  state.visionInsight = null;
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

function revokePhotoUrl(photo) {
  if (photo?.src && photo.src.startsWith('blob:')) URL.revokeObjectURL(photo.src);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, function (char) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char];
  });
}
