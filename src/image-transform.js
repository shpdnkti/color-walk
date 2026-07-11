export function getPhotoFitRatios(photoRatio, frameRatio) {
  const safePhotoRatio = Number(photoRatio);
  const safeFrameRatio = Number(frameRatio);
  if (!Number.isFinite(safePhotoRatio) || safePhotoRatio <= 0 || !Number.isFinite(safeFrameRatio) || safeFrameRatio <= 0) {
    return { width: 1, height: 1 };
  }
  if (safePhotoRatio > safeFrameRatio) {
    return { width: 1, height: safeFrameRatio / safePhotoRatio };
  }
  if (safePhotoRatio < safeFrameRatio) {
    return { width: safePhotoRatio / safeFrameRatio, height: 1 };
  }
  return { width: 1, height: 1 };
}

export function calculatePhotoOffsetBounds(fitRatios, scale) {
  const width = Number(fitRatios?.width) || 1;
  const height = Number(fitRatios?.height) || 1;
  const safeScale = Number(scale) || 1;
  return {
    x: Math.max(0, (width * safeScale - 1) / 2),
    y: Math.max(0, (height * safeScale - 1) / 2),
  };
}

export function clampPhotoTransformToFit(transform, fitRatios) {
  const safeTransform = transform || {};
  const scale = clamp(Number(safeTransform.scale) || 1, 1, 4);
  const bounds = calculatePhotoOffsetBounds(fitRatios, scale);
  return {
    scale,
    x: bounds.x === 0 ? 0 : clamp(Number(safeTransform.x) || 0, -bounds.x, bounds.x),
    y: bounds.y === 0 ? 0 : clamp(Number(safeTransform.y) || 0, -bounds.y, bounds.y),
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
