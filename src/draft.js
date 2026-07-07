export const DRAFT_VERSION = 1;
export const MAX_DRAFT_PHOTOS = 9;

export function serializeDraft(input = {}) {
  return JSON.stringify({
    version: DRAFT_VERSION,
    savedAt: new Date().toISOString(),
    selectedLayout: input.selectedLayout || 'grid9',
    activePanel: input.activePanel || 'copy',
    customColor: input.customColor || '#2a4252',
    paletteOrder: normalizePaletteOrder(input.paletteOrder),
    paletteWeights: normalizePaletteWeights(input.paletteWeights),
    visionInsight: normalizeVisionInsight(input.visionInsight),
    fields: normalizeFields(input.fields),
    style: normalizeStyle(input.style),
    photos: normalizePhotos(input.photos),
  });
}

export function parseDraft(value) {
  try {
    const draft = JSON.parse(value);
    if (!draft || draft.version !== DRAFT_VERSION) return null;
    return {
      version: DRAFT_VERSION,
      savedAt: typeof draft.savedAt === 'string' ? draft.savedAt : '',
      selectedLayout: text(draft.selectedLayout) || 'grid9',
      activePanel: text(draft.activePanel) || 'copy',
      customColor: text(draft.customColor) || '#2a4252',
      paletteOrder: normalizePaletteOrder(draft.paletteOrder),
      paletteWeights: normalizePaletteWeights(draft.paletteWeights),
      visionInsight: normalizeVisionInsight(draft.visionInsight),
      fields: normalizeFields(draft.fields),
      style: normalizeStyle(draft.style),
      photos: normalizePhotos(draft.photos),
    };
  } catch {
    return null;
  }
}

function normalizeVisionInsight(insight = {}) {
  const safeInsight = insight && typeof insight === 'object' ? insight : {};
  return {
    keywords: textList(safeInsight.keywords, 8),
    subjects: textList(safeInsight.subjects, 6),
    scene: text(safeInsight.scene),
    mood: text(safeInsight.mood),
    description: text(safeInsight.description),
    tags: textList(safeInsight.tags, 8),
  };
}

function normalizeFields(fields = {}) {
  return {
    coverText: text(fields.coverText),
    place: text(fields.place),
    date: text(fields.date),
    time: text(fields.time),
    keyword: text(fields.keyword),
    copyStyle: text(fields.copyStyle) || 'poster-english',
    title: text(fields.title),
    body: text(fields.body),
    tags: text(fields.tags),
  };
}

function normalizeStyle(style = {}) {
  return {
    radius: number(style.radius, 0),
    padding: number(style.padding, 0),
    fontSize: number(style.fontSize, 24),
    font: text(style.font) || 'system',
    outputRatio: text(style.outputRatio) || '3:4',
  };
}

function normalizePaletteOrder(paletteOrder = []) {
  return Array.isArray(paletteOrder)
    ? paletteOrder.map(text).filter(isHexColor).slice(0, MAX_DRAFT_PHOTOS)
    : [];
}

function normalizePaletteWeights(paletteWeights = {}) {
  if (!paletteWeights || typeof paletteWeights !== 'object' || Array.isArray(paletteWeights)) return {};
  return Object.entries(paletteWeights).slice(0, MAX_DRAFT_PHOTOS).reduce(function (result, entry) {
    const hex = text(entry[0]).toLowerCase();
    if (!isHexColor(hex)) return result;
    const weight = Math.round(clamp(number(entry[1], 1), 0.5, 2) * 10) / 10;
    if (weight !== 1) result[hex] = weight;
    return result;
  }, {});
}

function isHexColor(value) {
  return /^#[0-9a-f]{6}$/i.test(value);
}

function normalizePhotos(photos = []) {
  return Array.isArray(photos)
    ? photos.slice(0, MAX_DRAFT_PHOTOS).map(normalizePhoto).filter(Boolean)
    : [];
}

function normalizePhoto(photo) {
  if (!photo || !text(photo.dataUrl)) return null;
  return {
    id: text(photo.id),
    fileName: text(photo.fileName) || 'restored-photo',
    dataUrl: text(photo.dataUrl),
    dominantColor: photo.dominantColor || { r: 160, g: 160, b: 160, hex: '#a0a0a0' },
    textColor: text(photo.textColor) || '#111111',
    metadata: photo.metadata || {},
    naturalWidth: number(photo.naturalWidth, 1),
    naturalHeight: number(photo.naturalHeight, 1),
    ratio: number(photo.ratio, 1),
    transform: normalizeTransform(photo.transform),
  };
}

function normalizeTransform(transform = {}) {
  return {
    scale: number(transform.scale, 1),
    x: number(transform.x, 0),
    y: number(transform.y, 0),
  };
}

function textList(value, limit) {
  return Array.isArray(value)
    ? value.map(text).filter(Boolean).filter(function (item, index, list) { return list.indexOf(item) === index; }).slice(0, limit)
    : [];
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
