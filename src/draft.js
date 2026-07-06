export const DRAFT_VERSION = 1;
export const MAX_DRAFT_PHOTOS = 9;

export function serializeDraft(input = {}) {
  return JSON.stringify({
    version: DRAFT_VERSION,
    savedAt: new Date().toISOString(),
    selectedLayout: input.selectedLayout || 'movie-poster',
    activePanel: input.activePanel || 'style',
    movieColorOnTop: input.movieColorOnTop !== false,
    customColor: input.customColor || '#2a4252',
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
      selectedLayout: text(draft.selectedLayout) || 'movie-poster',
      activePanel: text(draft.activePanel) || 'style',
      movieColorOnTop: draft.movieColorOnTop !== false,
      customColor: text(draft.customColor) || '#2a4252',
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
    font: text(style.font) || 'casual',
    ratio: number(style.ratio, 50),
    outputRatio: text(style.outputRatio) || '9:16',
    borderless: style.borderless !== false,
  };
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
