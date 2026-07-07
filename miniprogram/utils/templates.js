const panelDefinitions = [
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

const layoutDefinitions = [
  {
    id: 'movie-poster',
    label: '电影海报',
    icon: 'film',
    description: '纯色字卡与无边距满铺大图上下拼接，适合电影感旅行封面。',
    className: 'layout-movie-poster',
  },
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

const copyStyleDefinitions = [
  {
    id: 'relaxed',
    label: '松弛',
    closing: '慢慢走、慢慢看，把照片、色块和心情一起收好。',
    placeTag: '#城市漫步',
    fallbackTag: '#色彩记录',
  },
  {
    id: 'dopamine',
    label: '多巴胺',
    closing: '这组颜色像把快乐调亮了一格，连日常都变得更鲜活。',
    placeTag: '#多巴胺穿搭',
    fallbackTag: '#色彩灵感',
  },
  {
    id: 'city-walk',
    label: '城市漫步',
    closing: '城市的色彩线索很轻盈，把照片、色块和心情一起拼成这次 Color Walk。',
    placeTag: '#城市漫步',
    fallbackTag: '#色彩记录',
  },
  {
    id: 'healing',
    label: '情绪疗愈',
    closing: '这些颜色像一段温柔的缓冲，把今天的情绪慢慢安放下来。',
    placeTag: '#治愈时刻',
    fallbackTag: '#情绪色卡',
  },
  {
    id: 'poster-english',
    label: '英文海报',
    closing: 'A cinematic Color Walk frame for the mood board. #PosterMood',
    placeTag: '#PosterMood',
    fallbackTag: '#PosterMood',
  },
];

const styleCopy = copyStyleDefinitions.reduce(function (result, style) {
  result[style.id] = style;
  return result;
}, {});

function generateCopy(options) {
  const safeOptions = options || {};
  const dominantColor = safeOptions.dominantColor;
  const resolvedColorName = normalizeColorName(safeOptions.colorName) || describeColor(dominantColor);
  const resolvedPlace = normalizeText(safeOptions.place);
  const resolvedDate = formatDisplayDate(safeOptions.date);
  const style = safeOptions.style || 'city-walk';
  const template = styleCopy[style] || styleCopy['city-walk'];

  if (style === 'poster-english') {
    return generatePosterCopy({
      dominantColor,
      place: resolvedPlace,
      time: safeOptions.time,
    });
  }

  const title = resolvedPlace
    ? resolvedPlace + '的' + resolvedColorName + ' Color Walk'
    : '一场' + resolvedColorName + ' Color Walk';
  const bodyPlace = resolvedPlace || '路过的地方';
  const bodyDate = resolvedDate || '这一天';
  const body = bodyDate + '，在' + bodyPlace + '收集到一组' + resolvedColorName + '碎片。' + template.closing;
  const tags = resolvedPlace
    ? ['#ColorWalk', toHashTag(resolvedPlace), toHashTag(resolvedColorName), template.placeTag]
    : ['#ColorWalk', toHashTag(resolvedColorName), template.fallbackTag];

  return { title, body, tags };
}

function generatePosterCopy(options) {
  const safeOptions = options || {};
  const placeLine = formatPosterPlace(safeOptions.place) || 'Color Walk';
  const timeLine = formatPosterTime(safeOptions.time);
  const title = timeLine ? placeLine + ' - ' + timeLine : placeLine;
  const body = placeLine + ' in ' + describeColor(safeOptions.dominantColor) + ' tones. ' + styleCopy['poster-english'].closing;

  return {
    title,
    body,
    tags: ['#ColorWalk', '#PosterMood'],
  };
}

function describeColor(hex) {
  const rgb = parseHexColor(hex);

  if (!rgb) return '灰色';

  const hsl = rgbToHsl(rgb);

  if (hsl.saturation < 0.12) return '灰色';
  if ((hsl.hue >= 330 || hsl.hue < 15) && hsl.lightness >= 0.64) return '粉色';
  if (hsl.hue < 18 || hsl.hue >= 345) return '红色';
  if (hsl.hue < 42) return '橙色';
  if (hsl.hue < 72) return '黄色';
  if (hsl.hue < 165) return '绿色';
  if (hsl.hue < 255) return '蓝色';
  if (hsl.hue < 330) return '紫色';
  return '粉色';
}

function formatPosterPlace(place) {
  const text = normalizeText(place).replace(/，/g, ',');
  if (!text) return '';

  return text
    .split(',')
    .map(function (part) {
      const trimmed = part.trim();
      return posterPlaceDictionary[trimmed] || titleCaseAscii(trimmed);
    })
    .filter(Boolean)
    .join(', ');
}

function formatPosterTime(value) {
  const text = normalizeText(value);
  const match = /^(\d{1,2})(?::|点)(\d{1,2})/.exec(text);
  if (!match) return '';

  const hour24 = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour24) || !Number.isFinite(minute)) return '';

  const suffix = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 || 12;
  return hour12 + ':' + String(minute).padStart(2, '0') + ' ' + suffix;
}

function titleCaseAscii(value) {
  return value
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(^|\s)[a-z]/g, function (match) {
      return match.toUpperCase();
    });
}

const posterPlaceDictionary = {
  '梅里雪山': 'Meili Snow Mountain',
  '云南': 'Yunnan',
  '武康路': 'Wukang Road',
  '校园': 'Campus',
  '海边': 'Seaside',
};

function normalizeColorName(colorName) {
  const text = normalizeText(colorName);
  if (!text) return '';
  return text.endsWith('色') ? text : text + '色';
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function formatDisplayDate(value) {
  const text = normalizeText(value);
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (!match) return text;
  return Number(match[2]) + '月' + Number(match[3]) + '日';
}

function toHashTag(value) {
  return '#' + String(value).replace(/\s+/g, '');
}

function parseHexColor(hex) {
  const text = normalizeText(hex).replace(/^#/, '');
  const fullHex = text.length === 3
    ? text.split('').map(function (char) { return char + char; }).join('')
    : text;

  if (!/^[\da-f]{6}$/i.test(fullHex)) return null;

  return {
    red: Number.parseInt(fullHex.slice(0, 2), 16),
    green: Number.parseInt(fullHex.slice(2, 4), 16),
    blue: Number.parseInt(fullHex.slice(4, 6), 16),
  };
}

function rgbToHsl(rgb) {
  const r = rgb.red / 255;
  const g = rgb.green / 255;
  const b = rgb.blue / 255;
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

module.exports = {
  panelDefinitions,
  layoutDefinitions,
  copyStyleDefinitions,
  describeColor,
  generateCopy,
  generatePosterCopy,
  formatPosterPlace,
  formatPosterTime,
};
