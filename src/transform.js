export function getCoverTransformBounds({ imageRatio = 1, frameRatio = 1, scale = 1 } = {}) {
  const safeScale = positiveNumber(scale, 1);
  const safeImageRatio = positiveNumber(imageRatio, 1);
  const safeFrameRatio = positiveNumber(frameRatio, 1);
  const widthRatio = Math.max(1, safeImageRatio / safeFrameRatio) * safeScale;
  const heightRatio = Math.max(1, safeFrameRatio / safeImageRatio) * safeScale;

  return {
    x: roundTransformNumber(Math.max(0, (widthRatio - 1) / 2)),
    y: roundTransformNumber(Math.max(0, (heightRatio - 1) / 2)),
  };
}

export function clampCoverTransform(transform = {}, context = {}) {
  const scale = roundTransformNumber(clamp(positiveNumber(transform.scale, 1), 1, 4));
  const bounds = getCoverTransformBounds({
    imageRatio: context.imageRatio,
    frameRatio: context.frameRatio,
    scale,
  });

  return {
    scale,
    x: roundTransformNumber(clamp(number(transform.x, 0), -bounds.x, bounds.x)),
    y: roundTransformNumber(clamp(number(transform.y, 0), -bounds.y, bounds.y)),
  };
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roundTransformNumber(value) {
  const rounded = Math.round(value * 1000000) / 1000000;
  return Object.is(rounded, -0) ? 0 : rounded;
}
