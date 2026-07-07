const config = require('../../config');
const {
  buildPaletteSummary,
  findDominantColor,
  getReadableTextColor,
} = require('../../utils/color');
const {
  copyStyleDefinitions,
  describeColor,
  generateCopy,
  layoutDefinitions,
  panelDefinitions,
} = require('../../utils/templates');
const {
  buildReverseGeocodeUrl,
  formatReverseGeocodeLabel,
} = require('../../utils/geocode');
const {
  parseDraft,
  serializeDraft,
} = require('../../utils/draft');
const {
  clamp,
  clampPhotoTransform,
  createDefaultPhotoTransform,
  getOutputExportHeight,
  outputRatioPresets,
} = require('../../utils/transform');
const {
  extractMetadataFromBuffer,
} = require('../../utils/exif');

const DRAFT_STORAGE_KEY = 'color-walk-draft';
const GEOCODE_CACHE_KEY = 'color-walk-geocode-cache';
const DEFAULT_COLOR = '#2a4252';

Page({
  data: createInitialData(),

  onLoad() {
    this.canvasGesture = null;
    this.photoGesture = null;
    this.restoreDraft();
  },

  async choosePhotos() {
    try {
      const result = await chooseMedia({
        count: Math.max(1, 9 - this.data.photos.length),
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['original'],
      });
      const files = (result.tempFiles || []).slice(0, 9 - this.data.photos.length);
      if (!files.length) return;
      this.setStatus('正在识别图片主色和照片信息...');
      const loaded = [];
      for (const file of files) {
        const photo = await this.createPhotoItem(file);
        if (photo) loaded.push(photo);
      }
      const photos = this.data.photos.concat(loaded).slice(0, 9);
      const customColor = getMainColorHex(photos) || this.data.customColor;
      this.setData({ photos, customColor, copyDirty: false });
      this.hydrateGlobalMetadata();
      this.seedCopy();
      this.refreshView();
      this.saveDraft();
      this.setStatus('已完成识别，可以继续调整文本和结构。');
    } catch (error) {
      if (!String(error?.errMsg || error?.message || '').includes('cancel')) {
        this.setStatus('选择图片失败，请检查相册权限后再试。');
      }
    }
  },

  async createPhotoItem(file) {
    const src = file.tempFilePath || file.path || '';
    if (!src) return null;
    const imageInfo = await getImageInfo(src).catch(function () { return {}; });
    const naturalWidth = imageInfo.width || file.width || 1;
    const naturalHeight = imageInfo.height || file.height || 1;
    const mimeType = getPhotoMimeType(file, imageInfo, src);
    const [dominantColor, metadata] = await Promise.all([
      this.extractDominantColorFromImage(src).catch(function () {
        return { r: 160, g: 160, b: 160, hex: '#a0a0a0' };
      }),
      readPhotoMetadata(src, file, imageInfo),
    ]);
    const savedSrc = await savePhotoFile(src);
    const id = String(Date.now()) + '-' + Math.random().toString(16).slice(2);
    const localSrc = savedSrc || src;
    return {
      id,
      fileName: file.name || src.split('/').pop() || 'photo',
      src: localSrc,
      dataUrl: localSrc,
      mimeType,
      dominantColor,
      textColor: getReadableTextColor(dominantColor.hex),
      metadata,
      naturalWidth,
      naturalHeight,
      ratio: naturalWidth / naturalHeight,
      transform: createDefaultPhotoTransform(),
      transformStyle: buildPhotoTransformStyle(createDefaultPhotoTransform()),
    };
  },

  async extractDominantColorFromImage(src) {
    const canvas = await this.selectCanvas('#sampleCanvas');
    const size = 72;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    await drawImageCoverOnCanvas(canvas, ctx, src, 0, 0, size, size);
    const imageData = ctx.getImageData(0, 0, size, size);
    return findDominantColor(imageData.data, size, size, {
      sampleStep: 2,
      bucketSize: 16,
      ignoreNearWhite: true,
      ignoreNearBlack: true,
    }) || { r: 160, g: 160, b: 160, hex: '#a0a0a0' };
  },

  hydrateGlobalMetadata() {
    const fields = { ...this.data.fields };
    const firstWithDate = this.data.photos.find(function (photo) { return photo.metadata.date; });
    const firstWithGps = this.data.photos.find(function (photo) { return photo.metadata.gpsLabel; });
    if (!fields.date && firstWithDate) fields.date = firstWithDate.metadata.date;
    if (!fields.time && firstWithDate) fields.time = firstWithDate.metadata.time || '';
    if (!fields.place && firstWithGps) fields.place = firstWithGps.metadata.gpsLabel;
    this.setData({ fields });
    if (firstWithGps) this.reverseGeocodePhoto(firstWithGps);
  },

  async reverseGeocodePhoto(photo) {
    const latitude = photo?.metadata?.latitude;
    const longitude = photo?.metadata?.longitude;
    if (latitude === null || latitude === undefined || longitude === null || longitude === undefined) return;
    if (!config.apiBaseUrl) {
      this.setStatus('已读取 GPS 坐标；配置 API 域名后可自动反查地点。');
      return;
    }
    const cacheKey = Number(latitude).toFixed(5) + ',' + Number(longitude).toFixed(5);
    const cache = wx.getStorageSync(GEOCODE_CACHE_KEY) || {};
    if (cache[cacheKey]) {
      this.applyReverseGeocodeLabel(cache[cacheKey]);
      return;
    }
    const url = buildReverseGeocodeUrl(config.apiBaseUrl + '/api/reverse-geocode', latitude, longitude);
    try {
      const response = await wxRequest({ url, method: 'GET' });
      const label = response.data?.label || formatReverseGeocodeLabel(response.data || {});
      if (!label) throw new Error('empty_label');
      cache[cacheKey] = label;
      wx.setStorageSync(GEOCODE_CACHE_KEY, cache);
      this.applyReverseGeocodeLabel(label);
      this.setStatus('已反查地点：' + label + '。');
    } catch (error) {
      this.setStatus('无法反查地点，请检查网络或稍后重试。');
    }
  },

  applyReverseGeocodeLabel(label) {
    const fields = { ...this.data.fields, place: label };
    this.setData({ fields, copyDirty: false });
    this.seedCopy();
    this.refreshView();
    this.saveDraft();
  },

  async analyzePhotosWithAI() {
    if (!this.data.photos.length) {
      this.setStatus('请先上传图片，再使用 AI 识图。');
      return;
    }
    if (!config.apiBaseUrl) {
      this.setStatus('AI 识图暂时不可用：请先配置小程序 API 域名。');
      return;
    }
    this.setStatus('AI 正在识别图片内容...');
    try {
      const images = [];
      for (const photo of this.data.photos.slice(0, 4)) {
        const dataUrl = String(photo.dataUrl || '').startsWith('data:image/')
          ? photo.dataUrl
          : await filePathToDataUrl(photo.src, photo.mimeType);
        images.push({
          dataUrl,
          fileName: photo.fileName,
        });
      }
      const response = await wxRequest({
        url: config.apiBaseUrl + '/api/analyze-image',
        method: 'POST',
        data: {
          images,
          context: {
            place: this.data.fields.place,
            date: this.data.fields.date,
            keywords: this.data.fields.keyword,
          },
        },
      });
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(response.data?.code || response.data?.error || 'analyze_failed');
      }
      this.applyVisionInsight(response.data?.insight || {});
    } catch (error) {
      this.setStatus(getAiErrorMessage(error));
    }
  },

  applyVisionInsight(insight) {
    const keywords = []
      .concat(insight.keywords || [])
      .concat(insight.subjects || [])
      .filter(Boolean);
    const tags = (insight.tags || []).filter(Boolean);
    const fields = { ...this.data.fields };
    fields.keyword = mergeTextList(fields.keyword, keywords);
    if (tags.length) fields.tags = mergeTextList(fields.tags, tags);
    this.setData({
      fields,
      visionInsight: insight,
      copyDirty: false,
    });
    this.seedCopy();
    this.refreshView();
    this.saveDraft();
    this.setStatus('AI 识图已应用到关键词和文案。');
  },

  seedCopy() {
    const mainColor = getMainColorHex(this.data.photos) || this.data.customColor || DEFAULT_COLOR;
    const copy = generateCopy({
      dominantColor: mainColor,
      place: this.data.fields.place,
      date: this.data.fields.date,
      time: this.data.fields.time,
      style: this.data.fields.copyStyle,
    });
    const fields = {
      ...this.data.fields,
      title: copy.title,
      body: copy.body,
      tags: copy.tags.join(' '),
    };
    this.setData({ fields });
    this.refreshView();
    this.saveDraft();
  },

  setActivePanel(event) {
    this.setData({ activePanel: event.currentTarget.dataset.panel });
  },

  setLayout(event) {
    const selectedLayout = event.currentTarget.dataset.layout;
    const fields = { ...this.data.fields };
    if (selectedLayout === 'movie-poster' && !this.data.copyDirty) {
      fields.copyStyle = 'poster-english';
    }
    this.setData({ selectedLayout, fields, copyDirty: false });
    this.seedCopy();
    this.refreshView();
    this.saveDraft();
  },

  setCopyStyle(event) {
    const index = Number(event.detail.value || 0);
    const style = copyStyleDefinitions[index] || copyStyleDefinitions[0];
    const fields = { ...this.data.fields, copyStyle: style.id };
    this.setData({ fields, copyStyleIndex: index, copyDirty: false });
    this.seedCopy();
  },

  updateField(event) {
    const field = event.currentTarget.dataset.field;
    if (!field) return;
    const fields = { ...this.data.fields, [field]: event.detail.value };
    const copyDirty = ['title', 'body', 'tags'].includes(field) ? true : this.data.copyDirty;
    this.setData({ fields, copyDirty });
    if (!copyDirty && !['title', 'body', 'tags'].includes(field)) this.seedCopy();
    else {
      this.refreshView();
      this.saveDraft();
    }
  },

  updateStyleNumber(event) {
    const key = event.currentTarget.dataset.style;
    if (!key) return;
    const style = { ...this.data.style, [key]: Number(event.detail.value) };
    if ((key === 'radius' || key === 'padding') && style[key] > 0) style.borderless = false;
    this.setData({ style });
    this.refreshView();
    this.saveDraft();
  },

  toggleBorderless(event) {
    const style = { ...this.data.style, borderless: Boolean(event.detail.value) };
    this.setData({ style });
    this.refreshView();
    this.saveDraft();
  },

  setEqualMovieRatio() {
    this.setData({ style: { ...this.data.style, ratio: 50 } });
    this.refreshView();
    this.saveDraft();
  },

  toggleMovieColorPosition() {
    this.setData({ movieColorOnTop: !this.data.movieColorOnTop });
    this.refreshView();
    this.saveDraft();
  },

  setOutputRatio(event) {
    const ratio = event.currentTarget.dataset.ratio;
    if (!outputRatioPresets.some(function (preset) { return preset.id === ratio; })) return;
    this.setData({ style: { ...this.data.style, outputRatio: ratio } });
    this.refreshView();
    this.saveDraft();
    this.setStatus('输出比例已切换为 ' + ratio + '。');
  },

  setCustomColor(event) {
    const customColor = event.currentTarget.dataset.color;
    this.setData({ customColor });
    this.refreshView();
    this.saveDraft();
  },

  nudgePhotoScale(event) {
    const photoId = event.currentTarget.dataset.photoId;
    const delta = Number(event.currentTarget.dataset.delta || 0);
    const transform = this.getPhotoTransform(photoId);
    this.setPhotoTransform(photoId, {
      scale: transform.scale + delta,
      x: transform.x,
      y: transform.y,
    });
  },

  removePhoto(event) {
    const photoId = event.currentTarget.dataset.photoId;
    const photos = this.data.photos.filter(function (photo) { return photo.id !== photoId; });
    this.setData({ photos, copyDirty: false });
    this.seedCopy();
    this.refreshView();
    this.saveDraft();
  },

  resetPhotoTransform(event) {
    const photoId = event.currentTarget.dataset.photoId;
    this.setPhotoTransform(photoId, createDefaultPhotoTransform());
  },

  getPhotoTransform(photoId) {
    const photo = this.data.photos.find(function (item) { return item.id === photoId; });
    return photo?.transform || createDefaultPhotoTransform();
  },

  setPhotoTransform(photoId, transform) {
    const nextTransform = clampPhotoTransform(transform);
    const photos = this.data.photos.map(function (photo) {
      if (photo.id !== photoId) return photo;
      return {
        ...photo,
        transform: nextTransform,
        transformStyle: buildPhotoTransformStyle(nextTransform),
      };
    });
    this.setData({ photos });
    this.refreshView();
    this.saveDraft();
  },

  handleCanvasTouchStart(event) {
    const touches = event.touches || [];
    if (touches.length === 2) {
      this.canvasGesture = {
        mode: 'pinch',
        startDistance: getTouchDistance(touches),
        startZoom: this.data.viewport.zoom,
      };
      return;
    }
    if (touches.length === 1) {
      this.canvasGesture = {
        mode: 'pan',
        x: touches[0].clientX,
        y: touches[0].clientY,
        panX: this.data.viewport.panX,
        panY: this.data.viewport.panY,
      };
    }
  },

  handleCanvasTouchMove(event) {
    if (!this.canvasGesture) return;
    const touches = event.touches || [];
    if (this.canvasGesture.mode === 'pinch' && touches.length === 2) {
      const zoom = this.canvasGesture.startZoom * (getTouchDistance(touches) / this.canvasGesture.startDistance);
      this.setCanvasZoom(zoom);
      return;
    }
    if (this.canvasGesture.mode === 'pan' && touches.length === 1) {
      this.setData({
        viewport: {
          ...this.data.viewport,
          panX: this.canvasGesture.panX + touches[0].clientX - this.canvasGesture.x,
          panY: this.canvasGesture.panY + touches[0].clientY - this.canvasGesture.y,
        },
      });
    }
  },

  handleCanvasTouchEnd() {
    this.canvasGesture = null;
  },

  handlePhotoTouchStart(event) {
    const photoId = event.currentTarget.dataset.photoId;
    if (!photoId) return;
    const touches = event.touches || [];
    if (touches.length === 2) {
      this.photoGesture = {
        photoId,
        mode: 'pinch',
        startDistance: getTouchDistance(touches),
        startTransform: this.getPhotoTransform(photoId),
      };
      return;
    }
    if (touches.length === 1) {
      this.photoGesture = {
        photoId,
        mode: 'pan',
        x: touches[0].clientX,
        y: touches[0].clientY,
        startTransform: this.getPhotoTransform(photoId),
      };
    }
  },

  handlePhotoTouchMove(event) {
    if (!this.photoGesture) return;
    const touches = event.touches || [];
    if (this.photoGesture.mode === 'pinch' && touches.length === 2) {
      const scale = this.photoGesture.startTransform.scale * (getTouchDistance(touches) / this.photoGesture.startDistance);
      this.setPhotoTransform(this.photoGesture.photoId, {
        ...this.photoGesture.startTransform,
        scale,
      });
      return;
    }
    if (this.photoGesture.mode === 'pan' && touches.length === 1) {
      const dx = (touches[0].clientX - this.photoGesture.x) / 240;
      const dy = (touches[0].clientY - this.photoGesture.y) / 240;
      this.setPhotoTransform(this.photoGesture.photoId, {
        scale: this.photoGesture.startTransform.scale,
        x: this.photoGesture.startTransform.x + dx,
        y: this.photoGesture.startTransform.y + dy,
      });
    }
  },

  handlePhotoTouchEnd() {
    this.photoGesture = null;
  },

  zoomOut() {
    this.setCanvasZoom(this.data.viewport.zoom - 0.1);
  },

  zoomIn() {
    this.setCanvasZoom(this.data.viewport.zoom + 0.1);
  },

  resetCanvasViewport() {
    this.setData({
      viewport: { zoom: 1, panX: 0, panY: 0 },
      zoomPercent: '100%',
    });
  },

  fitCanvasToViewport() {
    this.setData({
      viewport: { zoom: 0.86, panX: 0, panY: 0 },
      zoomPercent: '86%',
    });
  },

  setCanvasZoom(value) {
    const zoom = clamp(value, 0.25, 4);
    this.setData({
      viewport: { ...this.data.viewport, zoom },
      zoomPercent: Math.round(zoom * 100) + '%',
    });
  },

  saveDraft() {
    try {
      wx.setStorageSync(DRAFT_STORAGE_KEY, serializeDraft(this.getDraftSnapshot()));
      this.setStatus('已保存当前图片、布局、文案和样式草稿。');
    } catch (error) {
      this.setStatus('草稿保存失败，可能是图片过大导致小程序存储空间不足。');
    }
  },

  restoreDraft() {
    const draft = parseDraft(wx.getStorageSync(DRAFT_STORAGE_KEY));
    if (!draft) {
      this.seedCopy();
      this.refreshView();
      return false;
    }
    const photos = draft.photos.map(function (photo) {
      const localSrc = photo.dataUrl || photo.src;
      return {
        ...photo,
        src: localSrc,
        dataUrl: localSrc,
        mimeType: normalizeImageMimeType(photo.mimeType || photo.fileName || localSrc),
        transformStyle: buildPhotoTransformStyle(photo.transform),
      };
    });
    this.setData({
      selectedLayout: draft.selectedLayout,
      activePanel: draft.activePanel,
      movieColorOnTop: draft.movieColorOnTop,
      customColor: draft.customColor,
      paletteOrder: draft.paletteOrder,
      paletteWeights: draft.paletteWeights,
      visionInsight: draft.visionInsight,
      fields: draft.fields,
      style: draft.style,
      photos,
    });
    this.refreshView();
    return true;
  },

  clearSavedDraft() {
    wx.removeStorageSync(DRAFT_STORAGE_KEY);
    this.setStatus('本地草稿已清除，当前画布保留。');
  },

  getDraftSnapshot() {
    return {
      selectedLayout: this.data.selectedLayout,
      activePanel: this.data.activePanel,
      movieColorOnTop: this.data.movieColorOnTop,
      customColor: this.data.customColor,
      paletteOrder: this.data.paletteOrder,
      paletteWeights: this.data.paletteWeights,
      visionInsight: this.data.visionInsight,
      fields: this.data.fields,
      style: this.data.style,
      photos: this.data.photos.map(function (photo) {
        return {
          id: photo.id,
          fileName: photo.fileName,
          dataUrl: photo.dataUrl || photo.src,
          mimeType: photo.mimeType,
          dominantColor: photo.dominantColor,
          textColor: photo.textColor,
          metadata: photo.metadata,
          naturalWidth: photo.naturalWidth,
          naturalHeight: photo.naturalHeight,
          ratio: photo.ratio,
          transform: photo.transform,
        };
      }),
    };
  },

  copyCurrentText() {
    const text = [
      this.data.fields.title,
      this.data.fields.body,
      this.data.fields.tags,
    ].filter(Boolean).join('\n');
    wx.setClipboardData({
      data: text,
      success: () => this.setStatus('封面文字已复制。'),
      fail: () => this.setStatus('复制失败，请手动选择文本复制。'),
    });
  },

  async exportPng() {
    if (!this.data.photos.length) {
      this.setStatus('请先上传至少一张图片。');
      return;
    }
    this.setStatus('正在生成 PNG...');
    try {
      const width = 1080;
      const height = this.data.selectedLayout === 'movie-poster'
        ? getMoviePosterExportHeight(width, this.data)
        : getOutputExportHeight(width, this.data.style.outputRatio);
      const canvas = await this.selectCanvas('#exportCanvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      await this.drawExport(ctx, canvas, width, height);
      const tempFilePath = await canvasToTempFilePath({ canvas, width, height });
      await saveImageToPhotosAlbum(tempFilePath);
      this.setStatus('已导出 PNG 并保存到相册。');
    } catch (error) {
      this.setStatus(getExportErrorMessage(error));
    }
  },

  async drawExport(ctx, canvas, width, height) {
    const mainColor = getMainColorHex(this.data.photos) || this.data.customColor || DEFAULT_COLOR;
    ctx.clearRect(0, 0, width, height);
    if (this.data.selectedLayout === 'movie-poster') {
      await this.drawExportMoviePoster(ctx, canvas, width, height, mainColor);
      return;
    }
    ctx.fillStyle = this.data.selectedLayout === 'color-card-poster' ? mainColor : '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = this.data.selectedLayout === 'color-card-poster' ? 'rgba(255,255,255,0.92)' : '#191817';
    ctx.font = '700 54px sans-serif';
    wrapText(ctx, this.data.fields.title || '一场 Color Walk', 72, 96, 936, 66, 2);
    if (this.data.selectedLayout === 'grid9') await this.drawImageGrid(ctx, canvas, 72, 190, 936, 936, 3, 14);
    if (this.data.selectedLayout === 'stacked') await this.drawImageGrid(ctx, canvas, 72, 180, 936, 620, 1, 0);
    if (this.data.selectedLayout === 'magazine') {
      await this.drawImageGrid(ctx, canvas, 72, 180, 590, 760, 1, 0);
      await this.drawImageGrid(ctx, canvas, 694, 180, 314, 360, 1, 0);
    }
    if (this.data.selectedLayout === 'color-card-poster') await this.drawImageGrid(ctx, canvas, 138, 220, 804, 620, 1, 0);
    this.drawPalette(ctx, 72, height - 180, 936, 52);
    this.drawExportText(ctx, height);
  },

  async drawExportMoviePoster(ctx, canvas, width, height, mainColor) {
    const margin = this.data.style.borderless ? 0 : 72;
    const posterX = margin;
    const posterY = margin;
    const posterW = width - margin * 2;
    const posterH = height - margin * 2;
    const photo = this.data.photos[0];
    const imageH = photo ? Math.round(posterW / photo.ratio) : Math.round(posterH * 0.5);
    const colorH = posterH - imageH;
    const colorY = this.data.movieColorOnTop ? posterY : posterY + imageH;
    const imageY = this.data.movieColorOnTop ? posterY + colorH : posterY;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = mainColor;
    ctx.fillRect(posterX, colorY, posterW, colorH);
    if (photo) await drawPhotoContain(ctx, canvas, photo, posterX, imageY, posterW, imageH, '#111a24');
    ctx.fillStyle = getReadableTextColor(mainColor);
    ctx.font = Math.max(54, this.data.style.fontSize * 4) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    wrapCenteredText(ctx, this.data.fields.title || 'Color Walk', posterX + posterW / 2, colorY + colorH / 2, posterW - 120, Math.max(68, this.data.style.fontSize * 4.8), 3);
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  },

  async drawImageGrid(ctx, canvas, x, y, w, h, columns, gap) {
    const count = columns === 3 ? 9 : Math.min(this.data.photos.length, columns * columns);
    const rows = columns === 3 ? 3 : Math.max(1, Math.ceil(count / columns));
    const cellW = (w - gap * (columns - 1)) / columns;
    const cellH = columns === 1 ? h : (h - gap * (rows - 1)) / rows;
    for (let index = 0; index < count; index += 1) {
      const photo = this.data.photos[index % this.data.photos.length];
      const col = index % columns;
      const row = Math.floor(index / columns);
      const px = x + col * (cellW + gap);
      const py = y + row * (cellH + gap);
      await drawPhotoContain(ctx, canvas, photo, px, py, cellW, cellH, '#f3f4f6');
      ctx.fillStyle = photo.dominantColor.hex;
      ctx.fillRect(px, py + cellH - 18, cellW, 18);
    }
  },

  drawPalette(ctx, x, y, w, h) {
    const colors = this.getPaletteColors();
    const size = w / Math.max(1, colors.length);
    colors.forEach(function (hex, index) {
      ctx.fillStyle = hex;
      ctx.fillRect(x + index * size, y, size + 1, h);
    });
  },

  drawExportText(ctx, height) {
    ctx.fillStyle = '#191817';
    ctx.font = '400 32px sans-serif';
    wrapText(ctx, this.data.fields.body || '', 72, height - 110, 936, 44, 2);
    ctx.fillStyle = '#77736d';
    ctx.font = '700 28px sans-serif';
    wrapText(ctx, this.data.fields.tags || '#ColorWalk', 72, height - 48, 936, 38, 1);
  },

  getPaletteColors() {
    return getPaletteColors(this.data.photos, this.data.paletteOrder);
  },

  selectCanvas(selector) {
    return new Promise((resolve, reject) => {
      wx.createSelectorQuery()
        .in(this)
        .select(selector)
        .fields({ node: true, size: true })
        .exec((result) => {
          const canvas = result?.[0]?.node;
          if (canvas) resolve(canvas);
          else reject(new Error('canvas_not_found'));
        });
    });
  },

  refreshView() {
    const photos = this.data.photos.map(function (photo) {
      return {
        ...photo,
        transformStyle: buildPhotoTransformStyle(photo.transform || createDefaultPhotoTransform()),
      };
    });
    const palette = getPaletteColors(photos, this.data.paletteOrder);
    const average = buildPaletteSummary(palette).average;
    const mainColor = average?.hex || this.data.customColor || DEFAULT_COLOR;
    const layout = layoutDefinitions.find((item) => item.id === this.data.selectedLayout) || layoutDefinitions[0];
    const preset = outputRatioPresets.find((item) => item.id === this.data.style.outputRatio) || outputRatioPresets[2];
    const copyStyleIndex = Math.max(0, copyStyleDefinitions.findIndex((item) => item.id === this.data.fields.copyStyle));
    this.setData({
      photos,
      layoutHint: layout.label,
      previewClass: buildPreviewClass(this.data, photos),
      previewStyle: buildPreviewStyle(this.data, mainColor),
      previewSlots: buildPreviewSlots(this.data.selectedLayout, photos),
      paletteColors: palette.map(function (hex) {
        return { hex, name: describeColor(hex), textColor: getReadableTextColor(hex) };
      }),
      paletteSegments: palette.map((hex) => ({ hex, weight: this.data.paletteWeights[hex] || 1 })),
      primaryPhoto: photos[0] || null,
      averageColor: average ? average.hex.toUpperCase() : '等待图片',
      mainColorName: describeColor(mainColor),
      displayDate: formatDisplayDate(this.data.fields.date),
      ratioResolution: preset.id + ' (' + preset.width + 'x' + preset.height + ')',
      copyStyleIndex,
      copyStyleLabel: copyStyleDefinitions[copyStyleIndex]?.label || copyStyleDefinitions[0].label,
      zoomPercent: Math.round(this.data.viewport.zoom * 100) + '%',
    });
  },

  setStatus(exportStatus) {
    this.setData({ exportStatus });
  },
});

function createInitialData() {
  const fields = {
    place: '',
    date: '',
    time: '',
    keyword: '',
    copyStyle: 'poster-english',
    title: '',
    body: '',
    tags: '',
  };
  const style = {
    radius: 0,
    padding: 0,
    fontSize: 24,
    font: 'casual',
    ratio: 50,
    outputRatio: '9:16',
    borderless: true,
  };
  return {
    photos: [],
    primaryPhoto: null,
    selectedLayout: 'movie-poster',
    activePanel: 'style',
    customColor: DEFAULT_COLOR,
    movieColorOnTop: true,
    copyDirty: false,
    paletteOrder: [],
    paletteWeights: {},
    visionInsight: null,
    fields,
    style,
    viewport: { zoom: 1, panX: 0, panY: 0 },
    panelDefinitions,
    layoutDefinitions,
    copyStyleDefinitions,
    outputRatioPresets,
    copyStyleIndex: copyStyleDefinitions.findIndex(function (item) { return item.id === fields.copyStyle; }),
    copyStyleLabel: '英文海报',
    previewSlots: [],
    paletteColors: [],
    paletteSegments: [],
    averageColor: '等待图片',
    mainColorName: '灰色',
    layoutHint: '电影海报',
    previewClass: 'layout-movie-poster font-casual borderless',
    previewStyle: '',
    displayDate: '未设置日期',
    ratioResolution: '9:16 (1080x1920)',
    zoomPercent: '100%',
    exportStatus: '',
  };
}

function chooseMedia(options) {
  return new Promise((resolve, reject) => {
    wx.chooseMedia({ ...options, success: resolve, fail: reject });
  });
}

function getImageInfo(src) {
  return new Promise((resolve, reject) => {
    wx.getImageInfo({ src, success: resolve, fail: reject });
  });
}

function wxRequest(options) {
  return new Promise((resolve, reject) => {
    wx.request({ ...options, success: resolve, fail: reject });
  });
}

function readPhotoFileBuffer(filePath) {
  const fs = wx.getFileSystemManager();
  return new Promise((resolve, reject) => {
    fs.readFile({
      filePath,
      success(result) {
        resolve(result.data);
      },
      fail: reject,
    });
  });
}

function savePhotoFile(tempFilePath) {
  return new Promise((resolve) => {
    wx.saveFile({
      tempFilePath,
      success(result) {
        resolve(result.savedFilePath || tempFilePath);
      },
      fail() {
        resolve(tempFilePath);
      },
    });
  });
}

function filePathToDataUrl(filePath, mimeType) {
  const fs = wx.getFileSystemManager();
  const normalizedMimeType = normalizeImageMimeType(mimeType || filePath);
  if (normalizedMimeType === 'image/heic' || normalizedMimeType === 'image/heif') {
    return Promise.reject(new Error('unsupported_image_type'));
  }
  return new Promise((resolve, reject) => {
    fs.readFile({
      filePath,
      encoding: 'base64',
      success(result) {
        resolve('data:' + normalizedMimeType + ';base64,' + result.data);
      },
      fail: reject,
    });
  });
}

function canvasToTempFilePath({ canvas, width, height }) {
  return new Promise((resolve, reject) => {
    wx.canvasToTempFilePath({
      canvas,
      x: 0,
      y: 0,
      width,
      height,
      destWidth: width,
      destHeight: height,
      fileType: 'png',
      success(result) {
        resolve(result.tempFilePath);
      },
      fail: reject,
    });
  });
}

function saveImageToPhotosAlbum(filePath) {
  return new Promise((resolve, reject) => {
    wx.saveImageToPhotosAlbum({ filePath, success: resolve, fail: reject });
  });
}

async function readPhotoMetadata(src, file, imageInfo) {
  try {
    const buffer = await readPhotoFileBuffer(src);
    const metadata = await extractMetadataFromBuffer(buffer, file || {});
    return mergePhotoMetadata(metadata, createPhotoMetadata(file, imageInfo));
  } catch (error) {
    return createPhotoMetadata(file, imageInfo);
  }
}

function mergePhotoMetadata(metadata, fallback) {
  const latitude = metadata.latitude !== null && metadata.latitude !== undefined ? metadata.latitude : fallback.latitude;
  const longitude = metadata.longitude !== null && metadata.longitude !== undefined ? metadata.longitude : fallback.longitude;
  return {
    rawDate: metadata.rawDate || fallback.rawDate,
    date: metadata.date || fallback.date,
    displayDate: metadata.displayDate || fallback.displayDate,
    time: metadata.time || fallback.time,
    latitude,
    longitude,
    gpsLabel: latitude !== null && latitude !== undefined && longitude !== null && longitude !== undefined
      ? Number(latitude).toFixed(4) + ', ' + Number(longitude).toFixed(4)
      : (metadata.gpsLabel || fallback.gpsLabel),
    camera: metadata.camera || fallback.camera,
    aperture: metadata.aperture || fallback.aperture,
    shutter: metadata.shutter || fallback.shutter,
    iso: metadata.iso || fallback.iso,
    focalLength: metadata.focalLength || fallback.focalLength,
  };
}

function createPhotoMetadata(file, imageInfo) {
  const timestamp = file.lastModified || Date.now();
  const date = new Date(timestamp);
  const validDate = Number.isFinite(date.getTime());
  const latitude = numberOrNull(imageInfo.latitude);
  const longitude = numberOrNull(imageInfo.longitude);
  return {
    rawDate: '',
    date: validDate ? date.toISOString().slice(0, 10) : '',
    displayDate: validDate ? date.toISOString().slice(0, 10).replace(/-/g, '.') : '',
    time: validDate ? String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0') : '',
    latitude,
    longitude,
    gpsLabel: latitude !== null && longitude !== null ? latitude.toFixed(4) + ', ' + longitude.toFixed(4) : '',
    camera: '',
    aperture: '',
    shutter: '',
    iso: '',
    focalLength: '',
  };
}

function getPhotoMimeType(file, imageInfo, src) {
  return normalizeImageMimeType(file?.type || file?.mimeType || imageInfo?.type || imageInfo?.mimeType || src || file?.name);
}

function normalizeImageMimeType(value) {
  const text = String(value || '').trim().toLowerCase();
  if (text.startsWith('data:image/')) {
    const dataMatch = /^data:(image\/[a-z0-9.+-]+);/i.exec(text);
    return normalizeImageMimeType(dataMatch ? dataMatch[1] : '');
  }
  if (text.startsWith('image/')) {
    if (text === 'image/jpg' || text === 'image/pjpeg') return 'image/jpeg';
    if (['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'].includes(text)) return text;
  }

  const extensionMatch = /\.([a-z0-9]+)(?:[?#].*)?$/.exec(text);
  const extension = (extensionMatch ? extensionMatch[1] : text.replace(/^\./, '')).toLowerCase();
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'gif') return 'image/gif';
  if (extension === 'heic') return 'image/heic';
  if (extension === 'heif') return 'image/heif';
  return 'image/jpeg';
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getMainColorHex(photos) {
  if (!photos.length) return '';
  return buildPaletteSummary(photos.map(function (photo) { return photo.dominantColor.hex; })).average.hex;
}

function getPaletteColors(photos, paletteOrder) {
  if (!photos.length) return ['#3498db', '#e67e22', '#2ecc71', '#e74c3c'];
  const current = photos.map(function (photo) { return photo.dominantColor.hex; });
  const ordered = (paletteOrder || []).filter(function (hex) { return current.includes(hex); });
  return ordered.concat(current.filter(function (hex) { return !ordered.includes(hex); }));
}

function buildPreviewSlots(layout, photos) {
  const slots = layout === 'grid9' ? 9 : layout === 'magazine' ? Math.min(Math.max(photos.length, 3), 4) : 1;
  return Array.from({ length: slots }, function (_, index) {
    return {
      slotId: 'slot-' + index,
      photo: photos[index % Math.max(photos.length, 1)] || null,
    };
  });
}

function buildPreviewClass(data, photos) {
  const parts = ['layout-' + data.selectedLayout, 'font-' + data.style.font];
  if (data.selectedLayout === 'movie-poster' && data.style.borderless) parts.push('borderless');
  if (data.selectedLayout === 'movie-poster' && photos.length) parts.push('has-photo');
  return parts.join(' ');
}

function buildPreviewStyle(data, mainColor) {
  const textColor = getReadableTextColor(mainColor);
  const padding = data.selectedLayout === 'movie-poster' && data.style.borderless ? 0 : data.style.padding;
  const radius = data.selectedLayout === 'movie-poster' && data.style.borderless ? 0 : data.style.radius;
  return [
    '--preview-color: ' + mainColor,
    '--movie-text-color: ' + textColor,
    '--movie-color-ratio: ' + data.style.ratio + '%',
    '--image-radius: ' + radius + 'px',
    '--image-padding: ' + padding + 'px',
    '--text-font-size: ' + data.style.fontSize + 'px',
  ].join(';');
}

function buildPhotoTransformStyle(transform) {
  const safe = clampPhotoTransform(transform || createDefaultPhotoTransform());
  return 'transform: translate(' + Math.round(safe.x * 100) + '%, ' + Math.round(safe.y * 100) + '%) scale(' + safe.scale.toFixed(3) + ');';
}

function mergeTextList(existing, values) {
  const current = String(existing || '').split(/[,\s]+/).filter(Boolean);
  return current.concat(values || [])
    .map(function (item) { return String(item || '').trim(); })
    .filter(Boolean)
    .filter(function (item, index, list) { return list.indexOf(item) === index; })
    .slice(0, 12)
    .join(' ');
}

function formatDisplayDate(value) {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(value || ''));
  if (!match) return '未设置日期';
  return Number(match[2]) + '月' + Number(match[3]) + '日';
}

function getTouchDistance(touches) {
  if (!touches || touches.length < 2) return 1;
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.max(1, Math.hypot(dx, dy));
}

function getAiErrorMessage(error) {
  if (error?.message === 'openai_api_key_missing') return 'AI 识图暂时不可用：缺少 OpenAI API Key。';
  if (error?.message === 'insufficient_quota') return 'AI 识图暂时不可用：OpenAI 额度不足。';
  if (error?.message === 'unsupported_image_type') return 'AI 识图暂不支持 HEIC/HEIF，请先转换为 JPG 或 PNG 后再试。';
  return 'AI 识图失败，请稍后再试或继续手动输入关键词。';
}

function getExportErrorMessage(error) {
  const message = String(error?.errMsg || error?.message || '');
  if (message.includes('auth') || message.includes('authorize')) {
    return '保存失败，请在微信设置中允许保存到相册。';
  }
  return '导出失败，请再试一次。';
}

function getMoviePosterExportHeight(width, data) {
  const photo = data.photos[0];
  if (!photo) return getOutputExportHeight(width, data.style.outputRatio);
  const margin = data.style.borderless ? 0 : 72;
  const posterW = width - margin * 2;
  const imageH = posterW / photo.ratio;
  const colorH = imageH * (data.style.ratio / (100 - data.style.ratio));
  return Math.ceil(imageH + colorH + margin * 2);
}

async function drawImageCoverOnCanvas(canvas, ctx, src, x, y, w, h) {
  const image = await loadCanvasImage(canvas, src);
  const naturalWidth = image.width || w;
  const naturalHeight = image.height || h;
  const scale = Math.max(w / naturalWidth, h / naturalHeight);
  const dw = naturalWidth * scale;
  const dh = naturalHeight * scale;
  ctx.drawImage(image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

async function drawPhotoContain(ctx, canvas, photo, x, y, w, h, background) {
  ctx.fillStyle = background || '#f3f4f6';
  ctx.fillRect(x, y, w, h);
  const image = await loadCanvasImage(canvas, photo.src);
  const transform = clampPhotoTransform(photo.transform || createDefaultPhotoTransform());
  const scale = Math.min(w / photo.naturalWidth, h / photo.naturalHeight) * transform.scale;
  const dw = photo.naturalWidth * scale;
  const dh = photo.naturalHeight * scale;
  const dx = x + (w - dw) / 2 + transform.x * w;
  const dy = y + (h - dh) / 2 + transform.y * h;
  ctx.drawImage(image, dx, dy, dw, dh);
}

function loadCanvasImage(canvas, src) {
  return new Promise((resolve, reject) => {
    const image = canvas.createImage();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const chars = String(text || '').split('');
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

function wrapCenteredText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const chars = String(text || '').split('');
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
