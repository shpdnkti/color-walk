import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const testDir = dirname(fileURLToPath(import.meta.url));

function requireMiniprogramUtil(relativePath) {
  const filename = resolve(testDir, '..', relativePath);
  const source = readFileSync(filename, 'utf8');
  const module = { exports: {} };
  const wrapper = vm.runInThisContext(
    '(function (exports, require, module, __filename, __dirname) {' + source + '\n})',
    { filename },
  );
  wrapper(module.exports, require, module, filename, dirname(filename));
  return module.exports;
}

const color = requireMiniprogramUtil('miniprogram/utils/color.js');
const templates = requireMiniprogramUtil('miniprogram/utils/templates.js');
const geocode = requireMiniprogramUtil('miniprogram/utils/geocode.js');
const draft = requireMiniprogramUtil('miniprogram/utils/draft.js');
const transform = requireMiniprogramUtil('miniprogram/utils/transform.js');

test('miniprogram color utilities summarize colors and pick readable contrast', () => {
  const pixels = new Uint8ClampedArray([
    252, 252, 250, 255,
    4, 5, 6, 255,
    40, 170, 120, 255,
    40, 170, 120, 255,
    42, 172, 121, 255,
    200, 80, 60, 0,
  ]);

  assert.equal(color.rgbToHex({ r: 16, g: 160, b: 255 }), '#10a0ff');
  assert.equal(color.getReadableTextColor('#123456'), '#ffffff');
  assert.deepEqual(color.findDominantColor(pixels, 3, 2, {
    bucketSize: 8,
    ignoreNearWhite: true,
    ignoreNearBlack: true,
  }), {
    r: 40,
    g: 168,
    b: 120,
    hex: '#28a878',
    count: 3,
  });
  assert.deepEqual(color.buildPaletteSummary(['#ff0000', '#00ff00', '#0000ff']), {
    colors: ['#ff0000', '#00ff00', '#0000ff'],
    average: {
      r: 85,
      g: 85,
      b: 85,
      hex: '#555555',
      textColor: '#ffffff',
    },
  });
});

test('miniprogram templates generate Chinese and poster copy from place, date, time, and style', () => {
  const copy = templates.generateCopy({
    dominantColor: '#f48fb1',
    place: '武康路',
    date: '2026-07-06',
    style: 'city-walk',
  });

  assert.equal(copy.title, '武康路的粉色 Color Walk');
  assert.match(copy.body, /7月6日/);
  assert.match(copy.body, /城市的色彩线索/);
  assert.deepEqual(copy.tags, ['#ColorWalk', '#武康路', '#粉色', '#城市漫步']);
  assert.equal(templates.describeColor('#3498db'), '蓝色');
  assert.deepEqual(templates.panelDefinitions.map((panel) => panel.id), ['layout', 'palette', 'copy', 'style']);
  assert.deepEqual(templates.layoutDefinitions.map((layout) => layout.id), [
    'movie-poster',
    'grid9',
    'stacked',
    'magazine',
    'color-card-poster',
  ]);
  assert.deepEqual(templates.copyStyleDefinitions.map((style) => style.id), [
    'relaxed',
    'dopamine',
    'city-walk',
    'healing',
    'poster-english',
  ]);

  const posterCopy = templates.generatePosterCopy({
    dominantColor: '#2a4252',
    place: '梅里雪山，云南',
    time: '22:38',
  });

  assert.equal(posterCopy.title, 'Meili Snow Mountain, Yunnan - 10:38 PM');
  assert.match(posterCopy.body, /蓝色 tones/);
  assert.deepEqual(posterCopy.tags, ['#ColorWalk', '#PosterMood']);
});

test('miniprogram geocode utilities format Chinese labels and build absolute URLs', () => {
  assert.equal(geocode.normalizeCoordinate('31.2300014', 'lat'), 31.230001);
  assert.equal(geocode.normalizeCoordinate('181', 'lon'), null);
  assert.equal(geocode.formatReverseGeocodeLabel({
    display_name: '武康路, 湖南路街道, 徐汇区, 上海市, 中国',
    address: {
      road: '武康路',
      suburb: '湖南路街道',
      city: '上海市',
      country: '中国',
    },
  }), '上海 武康路');

  assert.equal(
    geocode.buildReverseGeocodeUrl('https://example.com/api/reverse', 31.2300014, 121.4727784, 'zh-CN'),
    'https://example.com/api/reverse?lat=31.230001&lon=121.472778&lang=zh-CN',
  );
});

test('miniprogram drafts serialize and parse photos, transforms, and palette weights', () => {
  const parsed = draft.parseDraft(draft.serializeDraft({
    selectedLayout: 'grid9',
    activePanel: 'copy',
    movieColorOnTop: false,
    customColor: '#123456',
    paletteOrder: ['#ffeeaa', ' #123456 ', 'invalid'],
    paletteWeights: {
      '#ffeeaa': 1.4,
      '#123456': 0.6,
      '#abcdef': 5,
      invalid: 1.2,
    },
    fields: {
      place: '上海 武康路',
      date: '2026-05-04',
      time: '09:30',
      copyStyle: 'city-walk',
    },
    style: {
      radius: 8,
      padding: 12,
      fontSize: 24,
      font: 'casual',
      ratio: 48,
      outputRatio: '4:5',
      borderless: false,
    },
    photos: [
      {
        id: 'p1',
        fileName: 'walk.jpg',
        dataUrl: 'data:image/jpeg;base64,abc',
        mimeType: 'image/jpeg',
        dominantColor: { r: 10, g: 20, b: 30, hex: '#0a141e' },
        textColor: '#ffffff',
        metadata: { date: '2026-05-04' },
        naturalWidth: 1200,
        naturalHeight: 800,
        ratio: 1.5,
        transform: { scale: 1.4, x: 0.1, y: -0.1 },
      },
    ],
  }));

  assert.equal(draft.DRAFT_VERSION, 1);
  assert.equal(draft.MAX_DRAFT_PHOTOS, 9);
  assert.equal(parsed.selectedLayout, 'grid9');
  assert.equal(parsed.fields.place, '上海 武康路');
  assert.deepEqual(parsed.paletteOrder, ['#ffeeaa', '#123456']);
  assert.deepEqual(parsed.paletteWeights, {
    '#ffeeaa': 1.4,
    '#123456': 0.6,
    '#abcdef': 2,
  });
  assert.equal(parsed.photos[0].mimeType, 'image/jpeg');
  assert.deepEqual(parsed.photos[0].transform, { scale: 1.4, x: 0.1, y: -0.1 });
});

test('miniprogram drafts infer photo MIME type from filenames for older saved drafts', () => {
  const parsed = draft.parseDraft(draft.serializeDraft({
    photos: [
      {
        id: 'p1',
        fileName: 'palette.png',
        dataUrl: 'wxfile://saved-photo-without-extension',
        dominantColor: { r: 10, g: 20, b: 30, hex: '#0a141e' },
        naturalWidth: 1200,
        naturalHeight: 800,
        ratio: 1.5,
      },
    ],
  }));

  assert.equal(parsed.photos[0].mimeType, 'image/png');
});

test('miniprogram transform utilities clamp crop transforms and compute output height', () => {
  assert.equal(transform.clamp(12, 0, 10), 10);
  assert.deepEqual(transform.createDefaultPhotoTransform(), { scale: 1, x: 0, y: 0 });
  assert.deepEqual(transform.clampPhotoTransform({ scale: 5, x: 2, y: -2 }), {
    scale: 4,
    x: 0.455,
    y: -0.455,
  });
  assert.equal(transform.getOutputExportHeight(1080, '9:16'), 1920);
  assert.deepEqual(transform.outputRatioPresets.map((preset) => preset.id), ['3:4', '4:5', '9:16', '2:3', '1:2']);
});
