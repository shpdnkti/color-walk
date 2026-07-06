import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPaletteSummary,
  findDominantColor,
  getReadableTextColor,
  rgbToHex,
} from '../src/color.js';

test('findDominantColor finds the most common RGBA color and ignores transparent pixels', () => {
  const pixels = new Uint8ClampedArray([
    250, 10, 20, 255,
    250, 10, 20, 255,
    30, 80, 200, 255,
    30, 80, 200, 0,
  ]);

  assert.deepEqual(findDominantColor(pixels, 2, 2, { bucketSize: 1 }), {
    r: 250,
    g: 10,
    b: 20,
    hex: '#fa0a14',
    count: 2,
  });
});

test('findDominantColor filters near-white and near-black noise', () => {
  const pixels = [
    252, 252, 250, 255,
    4, 5, 6, 255,
    40, 170, 120, 255,
    40, 170, 120, 255,
    40, 170, 120, 255,
    42, 172, 121, 255,
  ];

  assert.deepEqual(findDominantColor(pixels, 3, 2, {
    bucketSize: 8,
    ignoreNearWhite: true,
    ignoreNearBlack: true,
  }), {
    r: 40,
    g: 168,
    b: 120,
    hex: '#28a878',
    count: 4,
  });
});

test('rgbToHex pads single-digit channels', () => {
  assert.equal(rgbToHex(0, 7, 15), '#00070f');
  assert.equal(rgbToHex({ r: 16, g: 160, b: 255 }), '#10a0ff');
});

test('getReadableTextColor chooses black or white text for contrast', () => {
  assert.equal(getReadableTextColor('#ffffff'), '#111111');
  assert.equal(getReadableTextColor({ r: 12, g: 30, b: 50 }), '#ffffff');
});

test('buildPaletteSummary creates an overall palette and average representative color', () => {
  const summary = buildPaletteSummary([
    { r: 255, g: 0, b: 0 },
    { r: 0, g: 255, b: 0 },
    { r: 0, g: 0, b: 255 },
    '#0a141e',
  ]);

  assert.deepEqual(summary, {
    colors: ['#ff0000', '#00ff00', '#0000ff', '#0a141e'],
    average: {
      r: 66,
      g: 69,
      b: 71,
      hex: '#424547',
      textColor: '#ffffff',
    },
  });
});
