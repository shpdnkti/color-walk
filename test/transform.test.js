import test from 'node:test';
import assert from 'node:assert/strict';

import { clampCoverTransform, getCoverTransformBounds } from '../src/transform.js';

test('allows vertical dragging at 100% when cover image is taller than the frame', () => {
  const bounds = getCoverTransformBounds({ imageRatio: 1, frameRatio: 1.6, scale: 1 });

  assert.equal(bounds.x, 0);
  assert.equal(bounds.y, 0.3);

  assert.deepEqual(clampCoverTransform({ scale: 1, x: 0.2, y: 0.25 }, { imageRatio: 1, frameRatio: 1.6 }), {
    scale: 1,
    x: 0,
    y: 0.25,
  });
});

test('allows horizontal dragging at 100% when cover image is wider than the frame', () => {
  const bounds = getCoverTransformBounds({ imageRatio: 2, frameRatio: 1, scale: 1 });

  assert.equal(bounds.x, 0.5);
  assert.equal(bounds.y, 0);

  assert.deepEqual(clampCoverTransform({ scale: 1, x: 0.4, y: 0.2 }, { imageRatio: 2, frameRatio: 1 }), {
    scale: 1,
    x: 0.4,
    y: 0,
  });
});

test('keeps same-ratio images centered at 100% and opens both axes when zoomed', () => {
  assert.deepEqual(clampCoverTransform({ scale: 1, x: 0.4, y: -0.4 }, { imageRatio: 1.5, frameRatio: 1.5 }), {
    scale: 1,
    x: 0,
    y: 0,
  });

  assert.deepEqual(clampCoverTransform({ scale: 2, x: 0.9, y: -0.9 }, { imageRatio: 1.5, frameRatio: 1.5 }), {
    scale: 2,
    x: 0.5,
    y: -0.5,
  });
});
