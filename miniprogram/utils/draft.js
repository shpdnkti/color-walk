const DRAFT_VERSION = 1;
const MAX_DRAFT_PHOTOS = 9;

function serializeDraft(input) {
  const safeInput = input || {};
  return JSON.stringify({
    version: DRAFT_VERSION,
    savedAt: new Date().toISOString(),
    selectedLayout: safeInput.selectedLayout || 'movie-poster',
    activePanel: safeInput.activePanel || 'style',
    movieColorOnTop: safeInput.movieColorOnTop !== false,
    customColor: safeInput.customColor || '#2a4252',
    paletteOrder: normalizePaletteOrder(safeInput.paletteOrder),
    paletteWeights: normalizePaletteWeights(safeInput.paletteWeights),
    visionInsight: normalizeVisionInsight(safeInput.visionInsight),
    fields: normalizeFields(safeInput.fields),
    style: normalizeStyle(safeInput.style),
    photos: normalizePhotos(safeInput.photos),
  });
}

function parseDraft(value) {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || parsed.version !== DRAFT_VERSION) return null;
    return {
      version: DRAFT_VERSION,
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : '',
      selectedLayout: text(parsed.selectedLayout) || 'movie-poster',
      activePanel: text(parsed.activePanel) || 'style',
      movieColorOnTop: parsed.movieColorOnTop !== false,
      customColor: text(parsed.customColor) || '#2a4252',
      paletteOrder: normalizePaletteOrder(parsed.paletteOrder),
      paletteWeights: normalizePaletteWeights(parsed.paletteWeights),
      visionInsight: normalizeVisionInsight(parsed.visionInsight),
      fields: normalizeFields(parsed.fields),
      style: normalizeStyle(parsed.style),
      photos: normalizePhotos(parsed.photos),
    };
  } catch (error) {
    return null;
  }
}

function normalizeVisionInsight(insight) {
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

function normalizeFields(fields) {
  const safeFields = fields || {};
  return {
    place: text(safeFields.place),
    date: text(safeFields.date),
    time: text(safeFields.time),
    keyword: text(safeFields.keyword),
    copyStyle: text(safeFields.copyStyle) || 'poster-english',
    title: text(safeFields.title),
    body: text(safeFields.body),
    tags: text(safeFields.tags),
  };
}

function normalizeStyle(style) {
  const safeStyle = style || {};
  return {
    radius: number(safeStyle.radius, 0),
    padding: number(safeStyle.padding, 0),
    fontSize: number(safeStyle.fontSize, 24),
    font: text(safeStyle.font) || 'casual',
    ratio: number(safeStyle.ratio, 50),
    outputRatio: text(safeStyle.outputRatio) || '9:16',
    borderless: safeStyle.borderless !== false,
  };
}

function normalizePaletteOrder(paletteOrder) {
  return Array.isArray(paletteOrder)
    ? paletteOrder.map(text).filter(isHexColor).slice(0, MAX_DRAFT_PHOTOS)
    : [];
}

function normalizePaletteWeights(paletteWeights) {
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

function normalizePhotos(photos) {
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
    mimeType: normalizeImageMimeType(photo.mimeType || photo.fileName || photo.dataUrl),
    dominantColor: photo.dominantColor || { r: 160, g: 160, b: 160, hex: '#a0a0a0' },
    textColor: text(photo.textColor) || '#111111',
    metadata: photo.metadata || {},
    naturalWidth: number(photo.naturalWidth, 1),
    naturalHeight: number(photo.naturalHeight, 1),
    ratio: number(photo.ratio, 1),
    transform: normalizeTransform(photo.transform),
  };
}

function normalizeTransform(transform) {
  const safeTransform = transform || {};
  return {
    scale: number(safeTransform.scale, 1),
    x: number(safeTransform.x, 0),
    y: number(safeTransform.y, 0),
  };
}

function textList(value, limit) {
  return Array.isArray(value)
    ? value.map(text).filter(Boolean).filter(function (item, index, list) {
      return list.indexOf(item) === index;
    }).slice(0, limit)
    : [];
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeImageMimeType(value) {
  const input = text(value).toLowerCase();
  const dataMatch = /^data:(image\/[a-z0-9.+-]+);/i.exec(input);
  const direct = dataMatch ? dataMatch[1] : input;

  if (direct.startsWith('image/')) {
    if (direct === 'image/jpg' || direct === 'image/pjpeg') return 'image/jpeg';
    if (['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'].includes(direct)) return direct;
  }

  const extensionMatch = /\.([a-z0-9]+)(?:[?#].*)?$/.exec(input);
  const extension = (extensionMatch ? extensionMatch[1] : direct.replace(/^\./, '')).toLowerCase();
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'gif') return 'image/gif';
  if (extension === 'heic') return 'image/heic';
  if (extension === 'heif') return 'image/heif';
  return 'image/jpeg';
}

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

module.exports = {
  DRAFT_VERSION,
  MAX_DRAFT_PHOTOS,
  serializeDraft,
  parseDraft,
};
