export const panelDefinitions = [
  {
    id: 'layout',
    label: '布局',
    icon: 'layout',
  },
  {
    id: 'palette',
    label: '色盘',
    icon: 'palette',
  },
  {
    id: 'copy',
    label: '文案',
    icon: 'copy',
  },
  {
    id: 'style',
    label: '样式',
    icon: 'sliders',
  },
];

export const layoutDefinitions = [
  {
    id: 'grid9',
    label: '纯九宫格',
    icon: 'grid',
    description: '九张图片等分排列，适合完整记录一次 Color Walk。',
    className: 'layout-grid9',
  },
  {
    id: 'stacked',
    label: '上下结构',
    icon: 'stacked',
    description: '主图在上、信息在下，保留手机海报的纵向节奏。',
    className: 'layout-stacked',
  },
  {
    id: 'magazine',
    label: '杂志拼贴',
    icon: 'magazine',
    description: '主图、辅图和色条错落组合，适合更有编辑感的拼贴。',
    className: 'layout-magazine',
  },
  {
    id: 'color-card-poster',
    label: '色卡海报',
    icon: 'swatches',
    description: '以单张大图、EXIF 信息、色盘和文案生成小红书封面。',
    className: 'layout-color-card-poster',
  },
];

export function generateCoverText({
  metadata = {},
  locationLabel,
  dominantColor,
  paletteColors,
} = {}) {
  const location = normalizeText(locationLabel || metadata.locationLabel);
  const title = location ? location + ' color walk' : 'Color Walk';
  const dateTime = [metadata.displayDate, metadata.time].map(normalizeText).filter(Boolean).join(' ');
  const note = ['一种很新的记录方式', dateTime].filter(Boolean).join('｜');
  const cameraLine = [metadata.camera, metadata.aperture, metadata.shutter, metadata.iso, metadata.focalLength]
    .map(normalizeText)
    .filter(Boolean)
    .join(' · ');
  const colorTags = formatColorTags({ paletteColors, dominantColor });
  const colorLine = '用一种很 color 的方式整理旅行照片：' + colorTags;

  return [title, note, cameraLine, colorLine].filter(Boolean).join('\n');
}

function formatColorTags({ paletteColors, dominantColor }) {
  const defaults = ['蓝色', '橙色', '绿色', '红色'];
  const colors = Array.isArray(paletteColors) ? paletteColors : [];
  const names = [];

  colors.forEach(function (hex) {
    names.push(describeColor(hex));
  });
  names.push(describeColor(dominantColor));
  names.push(...defaults);

  return uniqueNonEmpty(names).slice(0, 4).join(' / ');
}

function uniqueNonEmpty(values) {
  const seen = new Set();
  return values.filter(function (value) {
    const text = normalizeText(value);
    if (!text || seen.has(text)) return false;
    seen.add(text);
    return true;
  });
}

export function describeColor(hex) {
  const rgb = parseHexColor(hex);

  if (!rgb) {
    return '灰色';
  }

  const { hue, saturation, lightness } = rgbToHsl(rgb);

  if (saturation < 0.12) {
    return '灰色';
  }

  if ((hue >= 330 || hue < 15) && lightness >= 0.64) {
    return '粉色';
  }

  if (hue < 18 || hue >= 345) {
    return '红色';
  }

  if (hue < 42) {
    return '橙色';
  }

  if (hue < 72) {
    return '黄色';
  }

  if (hue < 165) {
    return '绿色';
  }

  if (hue < 255) {
    return '蓝色';
  }

  if (hue < 330) {
    return '紫色';
  }

  return '粉色';
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseHexColor(hex) {
  const text = normalizeText(hex).replace(/^#/, '');
  const fullHex = text.length === 3
    ? text.split('').map((char) => char + char).join('')
    : text;

  if (!/^[\da-f]{6}$/i.test(fullHex)) {
    return null;
  }

  return {
    red: Number.parseInt(fullHex.slice(0, 2), 16),
    green: Number.parseInt(fullHex.slice(2, 4), 16),
    blue: Number.parseInt(fullHex.slice(4, 6), 16),
  };
}

function rgbToHsl({ red, green, blue }) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const lightness = (max + min) / 2;

  if (delta === 0) {
    return { hue: 0, saturation: 0, lightness };
  }

  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue;

  if (max === r) {
    hue = 60 * (((g - b) / delta) % 6);
  } else if (max === g) {
    hue = 60 * ((b - r) / delta + 2);
  } else {
    hue = 60 * ((r - g) / delta + 4);
  }

  return {
    hue: hue < 0 ? hue + 360 : hue,
    saturation,
    lightness,
  };
}
