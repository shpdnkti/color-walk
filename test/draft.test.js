import test from 'node:test';
import assert from 'node:assert/strict';

import { parseDraft, serializeDraft } from '../src/draft.js';

test('serializes editable fields, style, photos, and transforms into a local draft', () => {
  const json = serializeDraft({
    selectedLayout: 'grid9',
    activePanel: 'copy',
    movieColorOnTop: false,
    customColor: '#123456',
    fields: {
      place: '上海 武康路',
      date: '2026-05-04',
      time: '09:30',
      keyword: '咖啡, 街景',
      copyStyle: 'city-walk',
      title: '标题',
      body: '正文',
      tags: '#ColorWalk',
    },
    style: { radius: 8, padding: 12, fontSize: 24, font: 'casual', ratio: 48, outputRatio: '4:5', borderless: false },
    photos: [
      {
        id: 'p1',
        fileName: 'walk.jpg',
        dataUrl: 'data:image/jpeg;base64,abc',
        dominantColor: { r: 10, g: 20, b: 30, hex: '#0a141e' },
        textColor: '#ffffff',
        metadata: { date: '2026-05-04' },
        naturalWidth: 1200,
        naturalHeight: 800,
        ratio: 1.5,
        transform: { scale: 1.4, x: 0.1, y: -0.1 },
      },
    ],
  });

  const draft = parseDraft(json);

  assert.equal(draft.version, 1);
  assert.equal(draft.selectedLayout, 'grid9');
  assert.equal(draft.fields.place, '上海 武康路');
  assert.equal(draft.photos[0].dataUrl, 'data:image/jpeg;base64,abc');
  assert.deepEqual(draft.photos[0].transform, { scale: 1.4, x: 0.1, y: -0.1 });
});

test('serializes a draft when AI insight has not been generated yet', () => {
  const draft = parseDraft(serializeDraft({ visionInsight: null, photos: [] }));

  assert.deepEqual(draft.visionInsight, {
    keywords: [],
    subjects: [],
    scene: '',
    mood: '',
    description: '',
    tags: [],
  });
});

test('parseDraft rejects invalid payloads without throwing', () => {
  assert.equal(parseDraft('not json'), null);
  assert.equal(parseDraft('{"version":99}'), null);
});

test('serializes palette swatch order for local draft restore', () => {
  const draft = parseDraft(serializeDraft({
    paletteOrder: ['#ffeeaa', ' #123456 ', 'not-a-color', '#abcdef'],
  }));

  assert.deepEqual(draft.paletteOrder, ['#ffeeaa', '#123456', '#abcdef']);
});
