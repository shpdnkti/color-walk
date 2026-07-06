import test from 'node:test';
import assert from 'node:assert/strict';

import {
  describeColor,
  generateCoverText,
  layoutDefinitions,
  panelDefinitions,
} from '../src/templates.js';

test('generates a single low-volume cover text from location, EXIF, and colors', () => {
  const coverText = generateCoverText({
    dominantColor: '#f48fb1',
    paletteColors: ['#f48fb1', '#3498db', '#2ecc71', '#e67e22'],
    locationLabel: '深圳',
    metadata: {
      displayDate: '2026.04.14',
      time: '09:08',
      camera: 'Canon EOS R6',
      aperture: 'f/2.8',
      shutter: '1/125s',
      iso: 'ISO 200',
      focalLength: '35mm',
    },
  });

  assert.equal(coverText, [
    '深圳 color walk',
    '一种很新的记录方式｜2026.04.14 09:08',
    'Canon EOS R6 · f/2.8 · 1/125s · ISO 200 · 35mm',
    '用一种很 color 的方式整理旅行照片：粉色 / 蓝色 / 绿色 / 橙色',
  ].join('\n'));
});

test('omits unavailable EXIF and location details without placeholders', () => {
  const coverText = generateCoverText({
    dominantColor: '#4caf50',
    paletteColors: [],
    metadata: {},
  });

  assert.equal(coverText, [
    'Color Walk',
    '一种很新的记录方式',
    '用一种很 color 的方式整理旅行照片：绿色 / 蓝色 / 橙色 / 红色',
  ].join('\n'));
  assert.doesNotMatch(coverText, /undefined|null|NaN/);
});

test('provides layout definitions with required fields', () => {
  assert.ok(Array.isArray(layoutDefinitions));
  assert.equal(layoutDefinitions.length, 4);

  for (const layout of layoutDefinitions) {
    assert.equal(typeof layout.id, 'string');
    assert.equal(typeof layout.label, 'string');
    assert.equal(typeof layout.description, 'string');
    assert.equal(typeof layout.className, 'string');
    assert.ok(layout.id.length > 0);
    assert.ok(layout.label.length > 0);
    assert.ok(layout.description.length > 0);
    assert.ok(layout.className.length > 0);
  }

  assert.deepEqual(
    layoutDefinitions.map((layout) => layout.label),
    ['纯九宫格', '上下结构', '杂志拼贴', '色卡海报'],
  );

  assert.ok(layoutDefinitions.every((layout) => typeof layout.icon === 'string' && layout.icon.length > 0));
  assert.ok(!layoutDefinitions.some((layout) => layout.id === 'movie-poster' || layout.label === '电影海报'));
});

test('provides bottom editor panel definitions from the design spec', () => {
  assert.deepEqual(
    panelDefinitions.map((panel) => panel.id),
    ['layout', 'palette', 'copy', 'style'],
  );

  assert.deepEqual(
    panelDefinitions.map((panel) => panel.label),
    ['布局', '色盘', '文案', '样式'],
  );

  assert.ok(panelDefinitions.every((panel) => typeof panel.icon === 'string' && panel.icon.length > 0));
});

test('falls back to Chinese color names from HEX values', () => {
  assert.equal(describeColor('#f8a5c2'), '粉色');
  assert.equal(describeColor('#2ecc71'), '绿色');
  assert.equal(describeColor('#3498db'), '蓝色');
  assert.equal(describeColor('#f1c40f'), '黄色');
  assert.equal(describeColor('#9b59b6'), '紫色');
  assert.equal(describeColor('#e74c3c'), '红色');
  assert.equal(describeColor('#e67e22'), '橙色');
  assert.equal(describeColor('#95a5a6'), '灰色');
});
