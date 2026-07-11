import test from 'node:test';
import assert from 'node:assert/strict';

import { calculatePhotoOffsetBounds, clampPhotoTransformToFit, getPhotoFitRatios } from '../src/image-transform.js';

test('fits mismatched photo ratios inside the frame at the default crop', () => {
  assert.deepEqual(getPhotoFitRatios(6, 1.5), { width: 1, height: 0.25 });
  assert.deepEqual(getPhotoFitRatios(0.375, 1.5), { width: 0.25, height: 1 });
  assert.deepEqual(getPhotoFitRatios(1.5, 1.5), { width: 1, height: 1 });
  assert.deepEqual(getPhotoFitRatios(0, 1.5), { width: 1, height: 1 });
});

test('only allows panning after user zoom creates overflow on that axis', () => {
  const wideFit = getPhotoFitRatios(6, 1.5);
  const tallFit = getPhotoFitRatios(0.375, 1.5);

  assert.deepEqual(calculatePhotoOffsetBounds(wideFit, 1), { x: 0, y: 0 });
  assert.deepEqual(calculatePhotoOffsetBounds(tallFit, 1), { x: 0, y: 0 });
  assert.deepEqual(calculatePhotoOffsetBounds(wideFit, 2), { x: 0.5, y: 0 });
  assert.deepEqual(calculatePhotoOffsetBounds(tallFit, 2), { x: 0, y: 0.5 });
  assert.deepEqual(calculatePhotoOffsetBounds({ width: 1, height: 1 }, 4), { x: 1.5, y: 1.5 });
});

test('clamps persisted transforms against the current frame fit', () => {
  const wideFit = getPhotoFitRatios(6, 1.5);
  assert.deepEqual(clampPhotoTransformToFit({ scale: 9, x: 3, y: -3 }, wideFit), {
    scale: 4,
    x: 1.5,
    y: 0,
  });
});
