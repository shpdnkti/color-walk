import { buildPaletteSummary, findDominantColor, getReadableTextColor } from './color.js';
import { parseDraft, serializeDraft } from './draft.js';
import { extractPhotoMetadata } from './exif.js';
import { buildReverseGeocodeUrl, formatReverseGeocodeLabel } from './geocode.js';
import {
  copyStyleDefinitions,
  describeColor,
  generateCopy,
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
  selectedLayout: 'movie-poster',
  activePanel: 'style',
  customColor: '#2a4252',
  movieColorOnTop: true,
  copyDirty: false,
  restoringDraft: false,
  draggedPhotoId: null,
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
    fontSize: 24,
    font: 'casual',
    ratio: 50,
    outputRatio: '9:16',
    borderless: true,
  },
};

const els = {
  fileInput: document.querySelector('#fileInput'),
  resetButton: document.querySelector('#resetButton'),
  stashButton: document.querySelector('#stashButton'),
  placeInput: document.querySelector('#placeInput'),
  dateInput: document.querySelector('#dateInput'),
  timeInput: document.querySelector('#timeInput'),
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
  copyStyleSelect: document.querySelector('#copyStyleSelect'),
  customColorButton: document.querySelector('#customColorButton'),
  customColorInput: document.querySelector('#customColorInput'),
  keywordInput: document.querySelector('#keywordInput'),
  titleInput: document.querySelector('#titleInput'),
  bodyInput: document.querySelector('#bodyInput'),
  tagsInput: document.querySelector('#tagsInput'),
  radiusInput: document.querySelector('#radiusInput'),
  paddingInput: document.querySelector('#paddingInput'),
  ratioInput: document.querySelector('#ratioInput'),
  ratioPresetBar: document.querySelector('#ratioPresetBar'),
  ratioResolution: document.querySelector('#ratioResolution'),
  equalRatioButton: document.querySelector('#equalRatioButton'),
  borderlessInput: document.querySelector('#borderlessInput'),
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

async function init() {
  renderPanelTabs();
  renderLayoutControls();
  renderCopyStyleOptions();
  renderRatioPresets();
  bindEvents();
  applyStyleControls();
  applyCanvasViewport();
  const restored = await restoreDraft();
  if (!restored) seedCopy(true);
  renderAll();
  if (restored) els.exportStatus.textContent = '已恢复上次草稿。';
}

function bindEvents() {
  els.fileInput.addEventListener('change', handleFiles);
  els.resetButton.addEventListener('click', handleResetUpload);
  els.stashButton.addEventListener('click', stashDraft);
  els.aiAnalyzeButton.addEventListener('click', analyzePhotosWithAI);
  els.copyGenerateButton.addEventListener('click', function () {
    state.copyDirty = false;
    seedCopy(true);
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

  [els.placeInput, els.dateInput, els.timeInput, els.keywordInput, els.copyStyleSelect].forEach(function (input) {
    input.addEventListener('input', function () {
      if (!state.copyDirty) seedCopy();
      renderPreview();
    });
  });

  [els.titleInput, els.bodyInput, els.tagsInput].forEach(function (input) {
    input.addEventListener('input', function () {
      state.copyDirty = true;
      renderPreview();
    });
  });

  [els.radiusInput, els.paddingInput, els.ratioInput, els.fontSizeInput].forEach(function (input) {
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
  });

  els.fontSelect.addEventListener('input', function () {
    state.style.font = els.fontSelect.value;
    applyStyleControls();
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
  els.exportStatus.textContent = '已设为上下等大。';
}

async function handleFiles(event) {
  const files = Array.from(event.target.files || []).slice(0, 9 - state.photos.length);
  if (!files.length) return;
  els.exportStatus.textContent = '正在识别图片主色和照片信息...';

  const loaded = await Promise.all(files.map(createPhotoItem));
  state.photos.push(...loaded.filter(Boolean));
  hydrateGlobalMetadata();
  state.customColor = getMainColorHex() || state.customColor;
  state.copyDirty = false;
  seedCopy();
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

function hydrateGlobalMetadata() {
  const firstWithDate = state.photos.find(function (photo) { return photo.metadata.date; });
  const firstWithGps = state.photos.find(function (photo) { return photo.metadata.gpsLabel; });
  if (!els.dateInput.value && firstWithDate) els.dateInput.value = firstWithDate.metadata.date;
  if (!els.placeInput.value && firstWithGps) els.placeInput.value = firstWithGps.metadata.gpsLabel;
  if (firstWithGps) reverseGeocodePhoto(firstWithGps);
}

async function reverseGeocodePhoto(photo) {
  const latitude = photo?.metadata?.latitude;
  const longitude = photo?.metadata?.longitude;
  if (latitude === null || latitude === undefined || longitude === null || longitude === undefined) return;

  const cacheKey = Number(latitude).toFixed(5) + ',' + Number(longitude).toFixed(5);
  const cache = readGeocodeCache();
  if (cache[cacheKey]) {
    applyReverseGeocodeLabel(cache[cacheKey], photo);
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
      cache[cacheKey] = label;
      writeGeocodeCache(cache);
      applyReverseGeocodeLabel(label, photo);
      els.exportStatus.textContent = '已反查地点：' + label + '。地点数据来自 OpenStreetMap/Nominatim。';
      return;
    } catch (error) {
      // Try the next configured endpoint; the coordinate label remains usable offline.
    }
  }
}

function applyReverseGeocodeLabel(label, photo) {
  photo.metadata.placeLabel = label;
  if (!els.placeInput.value || els.placeInput.value === photo.metadata.gpsLabel) {
    els.placeInput.value = label;
    state.copyDirty = false;
    seedCopy();
    renderPreview();
  }
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
          place: els.placeInput.value,
          date: els.dateInput.value,
          keywords: els.keywordInput.value,
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
  return 'AI 识图失败，请稍后再试或继续手动输入关键词。';
}

function applyVisionInsight(insight) {
  const normalized = normalizeClientVisionInsight(insight);
  state.visionInsight = normalized;

  const keywordText = mergeKeywordText(els.keywordInput.value, normalized.keywords.concat(normalized.subjects));
  if (keywordText) els.keywordInput.value = keywordText;

  state.copyDirty = false;
  seedCopy(true);

  if (normalized.description) {
    els.bodyInput.value = appendSentence(els.bodyInput.value, normalized.description);
  }

  const tagText = mergeTags(els.tagsInput.value, normalized.tags).join(' ');
  if (tagText) els.tagsInput.value = tagText;

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
    tags: mergeTags('', insight.tags).slice(0, 8),
  };
}

function mergeKeywordText(existing, additions) {
  return normalizeTextList(splitKeywordText(existing).concat(additions || []), 14).join('、');
}

function splitKeywordText(value) {
  return String(value || '').split(/[、,，/|\s]+/u).map(cleanPlainText).filter(Boolean);
}

function normalizeTextList(value, limit) {
  return Array.isArray(value)
    ? value.map(cleanPlainText).filter(Boolean).filter(function (item, index, list) { return list.indexOf(item) === index; }).slice(0, limit)
    : [];
}

function mergeTags(existing, additions) {
  const parts = String(existing || '').split(/[\s,，]+/u).concat(additions || []);
  return parts.map(normalizeTag).filter(Boolean).filter(function (item, index, list) { return list.indexOf(item) === index; }).slice(0, 12);
}

function normalizeTag(value) {
  const cleaned = cleanPlainText(value).replace(/^#+/, '');
  return cleaned ? '#' + cleaned : '';
}

function appendSentence(body, sentence) {
  const cleanBody = String(body || '').trim();
  if (!cleanBody) return sentence;
  if (cleanBody.includes(sentence)) return cleanBody;
  return cleanBody + ' ' + sentence;
}

function cleanPlainText(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function seedCopy(force) {
  const mainColor = getMainColorHex();
  const colorName = mainColor ? describeColor(mainColor) : '粉色';
  const keywordText = els.keywordInput.value.trim();
  const copy = generateCopy({
    dominantColor: mainColor || '#f05f87',
    colorName,
    place: els.placeInput.value,
    date: els.dateInput.value,
    time: els.timeInput.value,
    style: els.copyStyleSelect.value,
  });

  if (keywordText) {
    copy.body += ' 这组照片里最想留下的是' + keywordText + '。';
  }

  if (force || !els.titleInput.value || !state.copyDirty) {
    els.titleInput.value = copy.title;
    els.bodyInput.value = copy.body;
    els.tagsInput.value = copy.tags.join(' ');
  }
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

function renderCopyStyleOptions() {
  els.copyStyleSelect.innerHTML = '';
  copyStyleDefinitions.forEach(function (style) {
    const option = document.createElement('option');
    option.value = style.id;
    option.textContent = style.label;
    els.copyStyleSelect.append(option);
  });
  els.copyStyleSelect.value = 'poster-english';
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
      if (layout.id === 'movie-poster' && !state.copyDirty) {
        els.copyStyleSelect.value = 'poster-english';
        seedCopy(true);
      }
      renderLayoutControls();
      renderPreview();
    });
    if (layout.id === state.selectedLayout) button.classList.add('active');
    els.layoutControls.append(button);
  });
}

function getLayoutGlyph(id) {
  const glyphs = {
    grid9: '<i></i><i></i><i></i><i></i><i></i><i></i>',
    stacked: '<i class="wide"></i><i class="wide small"></i>',
    magazine: '<i class="tall"></i><i></i><i></i>',
    'color-card-poster': '<i class="wide"></i><i class="swatch"></i><i class="wide small"></i>',
    'movie-poster': '<i class="wide swatch"></i><i class="wide"></i>',
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
    event.preventDefault();
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
      seedCopy();
      renderAll();
    });

    card.append(img, chip, remove);
    els.photoGrid.append(card);
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
  const isBorderless = state.selectedLayout === 'movie-poster' && state.style.borderless;
  const hasMoviePhoto = state.selectedLayout === 'movie-poster' && Boolean(state.photos[0]);
  els.layoutHint.textContent = layout.label;
  els.previewCanvas.className = 'poster-card collage-preview ' + layout.className + ' font-' + state.style.font + (isBorderless ? ' borderless' : '') + (hasMoviePhoto ? ' has-photo' : '');
  applyOutputRatioVars();
  const resolvedPadding = isBorderless ? 0 : state.style.padding;
  const resolvedRadius = isBorderless ? 0 : state.style.radius;
  setPreviewVar('--preview-color', previewColor);
  setPreviewVar('--movie-text-color', getReadableTextColor(previewColor));
  setPreviewVar('--movie-color-ratio', state.style.ratio + '%');
  setPreviewVar('--image-radius', resolvedRadius + 'px');
  setPreviewVar('--image-padding', resolvedPadding + 'px');
  setPreviewVar('--text-font-size', state.style.fontSize + 'px');
  setPreviewVar('--movie-card-ratio', String(getMovieCardRatio()));
  els.previewCanvas.innerHTML = '';

  const inner = document.createElement('div');
  inner.className = state.selectedLayout === 'movie-poster' ? 'movie-poster-inner' : 'preview-inner';
  if (hasMoviePhoto) inner.classList.add('has-photo');

  if (layout.id === 'movie-poster') {
    renderMoviePoster(inner);
    els.previewCanvas.append(inner);
    scheduleDraftSave();
    return;
  }

  const meta = document.createElement('div');
  meta.className = 'preview-meta';
  meta.innerHTML = '<span>' + escapeHtml(getDisplayDate()) + '</span><span>' + escapeHtml(els.placeInput.value || '未设置地点') + '</span><span>' + escapeHtml(describeColor(getMainColorHex() || '#f05f87')) + '</span>';

  const swatches = document.createElement('div');
  swatches.className = 'preview-swatches';
  getPaletteColors().slice(0, 6).forEach(function (hex) {
    const swatch = document.createElement('div');
    swatch.className = 'preview-swatch';
    swatch.style.background = hex;
    swatches.append(swatch);
  });

  const copy = document.createElement('div');
  copy.className = 'preview-copy';
  copy.innerHTML = '<h3>' + escapeHtml(els.titleInput.value || '一场 Color Walk') + '</h3><p>' + escapeHtml(els.bodyInput.value || '上传图片后生成拼贴文案。') + '</p><p>' + escapeHtml(els.tagsInput.value || '#ColorWalk') + '</p>';

  if (layout.id === 'grid9') {
    inner.append(createPreviewGallery(9), meta, swatches, copy);
  } else if (layout.id === 'stacked') {
    inner.append(createPreviewGallery(1), meta, swatches, copy);
  } else if (layout.id === 'magazine') {
    inner.append(createPreviewGallery(Math.min(Math.max(state.photos.length, 3), 4)), meta, swatches, copy);
  } else {
    inner.append(createPreviewGallery(1), meta, swatches, copy);
  }

  els.previewCanvas.append(inner);
  scheduleDraftSave();
}

function renderMoviePoster(inner) {
  inner.classList.toggle('color-top', state.movieColorOnTop);
  inner.classList.toggle('color-bottom', !state.movieColorOnTop);

  const colorCard = document.createElement('section');
  colorCard.className = 'movie-color-card';
  const title = document.createElement('p');
  title.className = 'movie-title';
  title.textContent = els.titleInput.value || 'Meili Snow Mountain, Yunnan - 10:38 PM';
  colorCard.append(title);

  const image = createPreviewImage();
  image.classList.add('movie-photo');

  if (state.movieColorOnTop) inner.append(colorCard, image);
  else inner.append(image, colorCard);
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
  scheduleDraftSave();
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
  scheduleDraftSave();
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
    movieColorOnTop: state.movieColorOnTop,
    customColor: state.customColor,
    visionInsight: state.visionInsight,
    fields: {
      place: els.placeInput.value,
      date: els.dateInput.value,
      time: els.timeInput.value,
      keyword: els.keywordInput.value,
      copyStyle: els.copyStyleSelect.value,
      title: els.titleInput.value,
      body: els.bodyInput.value,
      tags: els.tagsInput.value,
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
    state.movieColorOnTop = draft.movieColorOnTop;
    state.customColor = draft.customColor;
    state.visionInsight = draft.visionInsight;
    state.style = { ...state.style, ...draft.style };
    els.placeInput.value = draft.fields.place;
    els.dateInput.value = draft.fields.date;
    els.timeInput.value = draft.fields.time;
    els.keywordInput.value = draft.fields.keyword;
    els.copyStyleSelect.value = draft.fields.copyStyle;
    els.titleInput.value = draft.fields.title;
    els.bodyInput.value = draft.fields.body;
    els.tagsInput.value = draft.fields.tags;
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
  els.fontSizeInput.value = String(state.style.fontSize);
  els.fontSelect.value = state.style.font;
  els.borderlessInput.checked = state.style.borderless;
  applyStyleControls();
}

async function copyCurrentText() {
  const text = [els.titleInput.value, els.bodyInput.value, els.tagsInput.value].filter(Boolean).join('\n');
  try {
    await navigator.clipboard.writeText(text);
    els.exportStatus.textContent = '文案已复制。';
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
  canvas.height = getDomExportHeight(canvas.width);
  const ctx = canvas.getContext('2d');
  try {
    await drawPreviewDomToCanvas(ctx, canvas.width, canvas.height);
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
      return Array.from(sheet.cssRules).map(function (rule) { return rule.cssText; }).join('\\n');
    } catch {
      return '';
    }
  }).join('\\n');
}

function getMoviePosterExportHeight(width) {
  const photo = state.photos[0];
  if (!photo) return getOutputExportHeight(width);
  const margin = state.style.borderless ? 0 : 72;
  const posterW = width - margin * 2;
  const imageH = posterW / photo.ratio;
  const colorH = imageH * (state.style.ratio / (100 - state.style.ratio));
  return Math.ceil(imageH + colorH + margin * 2);
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

  ctx.fillStyle = layout === 'color-card-poster' ? 'rgba(255,255,255,0.92)' : '#191817';
  ctx.font = '700 54px system-ui, sans-serif';
  wrapText(ctx, els.titleInput.value || '一场 Color Walk', 72, 96, 936, 66, 2);

  if (layout === 'grid9') drawExportGrid(ctx);
  if (layout === 'stacked') drawExportStacked(ctx);
  if (layout === 'magazine') drawExportMagazine(ctx);
  if (layout === 'color-card-poster') drawExportPoster(ctx, mainColor);

  drawExportText(ctx, layout === 'color-card-poster');
}


function drawExportMoviePoster(ctx, width, height, mainColor) {
  const margin = state.style.borderless ? 0 : 72;
  const posterX = margin;
  const posterY = margin;
  const posterW = width - margin * 2;
  const posterH = height - margin * 2;
  const photo = state.photos[0];
  const imageH = photo ? Math.round(posterW / photo.ratio) : posterH - Math.round(posterH * (state.style.ratio / 100));
  const colorH = photo ? posterH - imageH : Math.round(posterH * (state.style.ratio / 100));
  const colorY = state.movieColorOnTop ? posterY : posterY + imageH;
  const imageY = state.movieColorOnTop ? posterY + colorH : posterY;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = mainColor;
  ctx.fillRect(posterX, colorY, posterW, colorH);

  ctx.save();
  if (photo) drawPhotoContain(ctx, photo, posterX, imageY, posterW, imageH, '#111a24');
  else {
    ctx.fillStyle = '#f3f4f6';
    ctx.fillRect(posterX, imageY, posterW, imageH);
  }
  ctx.restore();

  ctx.fillStyle = getReadableTextColor(mainColor);
  ctx.font = `${Math.max(54, state.style.fontSize * 4)}px ${getExportFontFamily()}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  wrapCenteredText(ctx, els.titleInput.value || 'Meili Snow Mountain, Yunnan - 10:38 PM', posterX + posterW / 2, colorY + colorH / 2, posterW - 120, Math.max(68, state.style.fontSize * 4.8), 3);
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
}

function drawExportGrid(ctx) {
  drawImageGrid(ctx, 72, 190, 936, 936, 3, 14);
  drawPalette(ctx, 72, 1150, 936, 52);
}

function drawExportStacked(ctx) {
  drawImageGrid(ctx, 72, 180, 936, 620, 1, 0);
  drawPalette(ctx, 72, 832, 936, 68);
}

function drawExportMagazine(ctx) {
  drawImageGrid(ctx, 72, 180, 590, 760, 1, 0);
  drawImageGrid(ctx, 694, 180, 314, 360, 1, 0);
  drawPalette(ctx, 694, 574, 314, 366, true);
}

function drawExportPoster(ctx, mainColor) {
  ctx.fillStyle = '#ffffff';
  roundedRect(ctx, 108, 190, 864, 680, 32);
  ctx.fill();
  drawImageGrid(ctx, 138, 220, 804, 620, 1, 0);
  ctx.fillStyle = mainColor;
  roundedRect(ctx, 108, 906, 864, 86, 24);
  ctx.fill();
  drawPalette(ctx, 140, 930, 800, 38);
}

function drawExportText(ctx, onTint) {
  const y = state.selectedLayout === 'grid9' ? 1236 : 1048;
  const bodyLines = state.selectedLayout === 'grid9' ? 2 : 3;
  ctx.fillStyle = onTint ? 'rgba(255,255,255,0.92)' : '#191817';
  ctx.font = '400 32px system-ui, sans-serif';
  wrapText(ctx, els.bodyInput.value || '', 72, y, 936, 44, bodyLines);
  ctx.fillStyle = onTint ? 'rgba(255,255,255,0.86)' : '#77736d';
  ctx.font = '700 28px system-ui, sans-serif';
  wrapText(ctx, els.tagsInput.value || '#ColorWalk', 72, 1300, 936, 38, 1);
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
  return state.photos.length ? state.photos.map(function (photo) { return photo.dominantColor.hex; }) : ['#f05f87', '#6aa9ff', '#82c784', '#f1c84b'];
}

function getMainColorHex() {
  if (!state.photos.length) return '';
  return buildPaletteSummary(state.photos.map(function (photo) { return photo.dominantColor.hex; })).average.hex;
}

function getDisplayDate() {
  if (!els.dateInput.value) return '未设置日期';
  const match = /^(?<year>\d{4})-(?<month>\d{1,2})-(?<day>\d{1,2})$/.exec(els.dateInput.value);
  if (!match?.groups) return els.dateInput.value;
  return Number(match.groups.month) + '月' + Number(match.groups.day) + '日';
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
  state.imageGesture.activePhotoId = null;
  state.imageGesture.pointerId = null;
  state.imageGesture.pointers.clear();
  state.imageGesture.pinchStartDistance = 0;
  state.copyDirty = false;
  state.visionInsight = null;
  state.customColor = '#2a4252';
  state.movieColorOnTop = true;
  state.style.outputRatio = '9:16';
  state.viewport.zoom = 1;
  state.viewport.panX = 0;
  state.viewport.panY = 0;
  state.viewport.isPanning = false;
  state.viewport.pointerId = null;
  state.selectedLayout = 'movie-poster';
  state.activePanel = 'style';
  els.placeInput.value = '';
  els.dateInput.value = '';
  els.keywordInput.value = '';
  els.timeInput.value = '';
  renderPanelTabs();
  renderLayoutControls();
  renderRatioPresets();
  applyCanvasViewport();
  seedCopy(true);
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
