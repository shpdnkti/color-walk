const outputRatioPresets = [
  { id: '3:4', width: 1080, height: 1440 },
  { id: '4:5', width: 1080, height: 1350 },
  { id: '9:16', width: 1080, height: 1920 },
  { id: '2:3', width: 1080, height: 1620 },
  { id: '1:2', width: 1080, height: 2160 },
];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function createDefaultPhotoTransform() {
  return {
    scale: 1,
    x: 0,
    y: 0,
  };
}

function clampPhotoTransform(transform) {
  const safeTransform = transform || {};
  const scale = clamp(safeTransform.scale || 1, 1, 4);
  const maxOffset = scale <= 1 ? 0 : Math.min(0.48, (scale - 1) / (scale * 2) + 0.08);

  return {
    scale,
    x: scale <= 1 ? 0 : clamp(safeTransform.x || 0, -maxOffset, maxOffset),
    y: scale <= 1 ? 0 : clamp(safeTransform.y || 0, -maxOffset, maxOffset),
  };
}

function getOutputExportHeight(width, outputRatio) {
  const preset = getRatioPreset(outputRatio);
  return Math.round(width * (preset.height / preset.width));
}

function getRatioPreset(outputRatio) {
  return outputRatioPresets.find(function (preset) {
    return preset.id === outputRatio;
  }) || outputRatioPresets[2];
}

module.exports = {
  clamp,
  clampPhotoTransform,
  createDefaultPhotoTransform,
  getOutputExportHeight,
  outputRatioPresets,
};
