import test from 'node:test';
import assert from 'node:assert/strict';

import {
  copyStyleDefinitions,
  describeColor,
  generateCopy,
  layoutDefinitions,
  panelDefinitions,
} from '../src/templates.js';

test('generates title, body, and tags from color, place, date, and style', () => {
  const copy = generateCopy({
    dominantColor: '#f48fb1',
    place: '武康路',
    date: '2026-07-06',
    style: 'city-walk',
  });

  assert.equal(copy.title, '武康路的粉色 Color Walk');
  assert.match(copy.body, /7月6日/);
  assert.match(copy.body, /武康路/);
  assert.match(copy.body, /粉色/);
  assert.match(copy.body, /城市的色彩线索/);
  assert.deepEqual(copy.tags, ['#ColorWalk', '#武康路', '#粉色', '#城市漫步']);
});

test('uses natural fallback copy when place or date is missing', () => {
  const copy = generateCopy({
    dominantColor: '#4caf50',
    style: 'relaxed',
  });

  assert.equal(copy.title, '一场绿色 Color Walk');
  assert.match(copy.body, /这一天/);
  assert.match(copy.body, /路过的地方/);
  assert.match(copy.body, /绿色/);
  assert.deepEqual(copy.tags, ['#ColorWalk', '#绿色', '#色彩记录']);
});

test('provides layout definitions with required fields', () => {
  assert.ok(Array.isArray(layoutDefinitions));
  assert.equal(layoutDefinitions.length, 5);

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
    ['🎬 电影海报', '纯九宫格', '上下结构', '杂志拼贴', '色卡海报'],
  );
});

test('provides bottom editor panel definitions from the design spec', () => {
  assert.deepEqual(
    panelDefinitions.map((panel) => panel.id),
    ['layout', 'palette', 'copy', 'style'],
  );

  assert.deepEqual(
    panelDefinitions.map((panel) => panel.label),
    ['📐 布局', '🎨 色盘', '✍️ 文案', '⚙️ 样式'],
  );
});

test('provides copy style definitions for the copy panel', () => {
  assert.deepEqual(
    copyStyleDefinitions.map((style) => style.id),
    ['relaxed', 'dopamine', 'city-walk', 'healing', 'poster-english'],
  );

  assert.deepEqual(
    copyStyleDefinitions.map((style) => style.label),
    ['松弛', '多巴胺', '城市漫步', '情绪疗愈', '英文海报'],
  );
});


test('formats poster copy as single-line English place and time', () => {
  const copy = generateCopy({
    dominantColor: '#2a4252',
    place: '梅里雪山，云南',
    time: '22:38',
    style: 'poster-english',
  });

  assert.equal(copy.title, 'Meili Snow Mountain, Yunnan - 10:38 PM');
  assert.match(copy.body, /Meili Snow Mountain/);
  assert.match(copy.body, /#PosterMood/);
});


test('title-cases lowercase poster place text', () => {
  const copy = generateCopy({
    dominantColor: '#2a4252',
    place: 'meili snow mountain, yunnan',
    time: '22:38',
    style: 'poster-english',
  });

  assert.equal(copy.title, 'Meili Snow Mountain, Yunnan - 10:38 PM');
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
