import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildVisionPrompt,
  buildVisionRequest,
  normalizeVisionInsight,
  parseVisionResponse,
} from '../server/vision.js';

test('builds a Responses API vision request with image inputs and structured JSON output', () => {
  const request = buildVisionRequest({
    model: 'gpt-5.5',
    images: [
      { dataUrl: 'data:image/png;base64,aaa', fileName: 'coffee.png' },
      { dataUrl: 'data:image/jpeg;base64,bbb', fileName: 'street.jpg' },
    ],
    context: { place: '上海 武康路', date: '2026-07-06', keywords: '咖啡' },
  });

  assert.equal(request.model, 'gpt-5.5');
  assert.equal(request.input[0].role, 'user');
  assert.equal(request.input[0].content[0].type, 'input_text');
  assert.equal(request.input[0].content[1].type, 'input_image');
  assert.equal(request.input[0].content[1].image_url, 'data:image/png;base64,aaa');
  assert.equal(request.input[0].content[2].image_url, 'data:image/jpeg;base64,bbb');
  assert.equal(request.text.format.type, 'json_schema');
  assert.equal(request.text.format.name, 'color_walk_image_insight');
  assert.equal(request.text.format.strict, true);
});

test('builds a prompt that asks for reusable Color Walk keywords', () => {
  const prompt = buildVisionPrompt({ place: '北京 东城', date: '2026-07-06', keywords: '花' });

  assert.match(prompt, /花/);
  assert.match(prompt, /咖啡|建筑|街景/);
  assert.match(prompt, /小红书/);
});

test('parses Responses API output_text JSON into normalized insight fields', () => {
  const insight = parseVisionResponse({
    output_text: JSON.stringify({
      keywords: ['咖啡', '街景', '建筑', '咖啡'],
      subjects: ['拿铁', '街角店铺'],
      scene: '城市街角',
      mood: '松弛',
      description: '阳光下的咖啡店和街边建筑。',
      tags: ['#咖啡', '#城市漫步'],
    }),
  });

  assert.deepEqual(insight.keywords, ['咖啡', '街景', '建筑']);
  assert.deepEqual(insight.subjects, ['拿铁', '街角店铺']);
  assert.equal(insight.scene, '城市街角');
  assert.equal(insight.description, '阳光下的咖啡店和街边建筑。');
});

test('normalizes weak or malformed model output without throwing', () => {
  assert.deepEqual(normalizeVisionInsight({ keywords: ['  ', '花', '花'], tags: ['色彩'] }), {
    keywords: ['花'],
    subjects: [],
    scene: '',
    mood: '',
    description: '',
    tags: ['#色彩'],
  });

  assert.deepEqual(parseVisionResponse({ output_text: 'not json' }), {
    keywords: [],
    subjects: [],
    scene: '',
    mood: '',
    description: '',
    tags: [],
  });
});
