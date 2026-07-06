const DEFAULT_SAMPLE_STEP = 1;
const DEFAULT_BUCKET_SIZE = 16;
const NEAR_WHITE_THRESHOLD = 245;
const NEAR_BLACK_THRESHOLD = 10;

export function rgbToHex(red, green, blue) {
  const { r, g, b } = readRgb(red, green, blue);

  return `#${toHexPair(r)}${toHexPair(g)}${toHexPair(b)}`;
}

export function getReadableTextColor(color) {
  const { r, g, b } = parseColor(color);
  const luminance = getRelativeLuminance(r, g, b);

  return luminance > 0.179 ? '#111111' : '#ffffff';
}

export function findDominantColor(rgba, width, height, options = {}) {
  assertRgbaData(rgba);

  const sampleStep = normalizePositiveInteger(options.sampleStep, DEFAULT_SAMPLE_STEP);
  const bucketSize = normalizePositiveInteger(options.bucketSize, DEFAULT_BUCKET_SIZE);
  const pixelLimit = getPixelLimit(rgba, width, height);
  const buckets = new Map();
  let dominant = null;

  for (let pixelIndex = 0; pixelIndex < pixelLimit; pixelIndex += sampleStep) {
    const offset = pixelIndex * 4;
    const alpha = rgba[offset + 3];

    if (alpha === 0) {
      continue;
    }

    const r = rgba[offset];
    const g = rgba[offset + 1];
    const b = rgba[offset + 2];

    if (options.ignoreNearWhite && isNearWhite(r, g, b)) {
      continue;
    }

    if (options.ignoreNearBlack && isNearBlack(r, g, b)) {
      continue;
    }

    const bucket = {
      r: quantizeChannel(r, bucketSize),
      g: quantizeChannel(g, bucketSize),
      b: quantizeChannel(b, bucketSize),
    };
    const key = `${bucket.r},${bucket.g},${bucket.b}`;
    const count = (buckets.get(key)?.count ?? 0) + 1;
    const next = { ...bucket, count };

    buckets.set(key, next);

    if (!dominant || next.count > dominant.count) {
      dominant = next;
    }
  }

  if (!dominant) {
    return null;
  }

  return {
    r: dominant.r,
    g: dominant.g,
    b: dominant.b,
    hex: rgbToHex(dominant),
    count: dominant.count,
  };
}

export function buildPaletteSummary(colors) {
  if (!Array.isArray(colors)) {
    throw new TypeError('colors must be an array');
  }

  const parsed = colors.map(parseColor);
  const palette = parsed.map((color) => rgbToHex(color));

  if (parsed.length === 0) {
    return {
      colors: [],
      average: null,
    };
  }

  const total = parsed.reduce((sum, color) => ({
    r: sum.r + color.r,
    g: sum.g + color.g,
    b: sum.b + color.b,
  }), { r: 0, g: 0, b: 0 });
  const average = {
    r: Math.round(total.r / parsed.length),
    g: Math.round(total.g / parsed.length),
    b: Math.round(total.b / parsed.length),
  };

  return {
    colors: palette,
    average: {
      ...average,
      hex: rgbToHex(average),
      textColor: getReadableTextColor(average),
    },
  };
}

function assertRgbaData(rgba) {
  if (!rgba || typeof rgba.length !== 'number') {
    throw new TypeError('rgba must be an array-like RGBA buffer');
  }

  if (rgba.length % 4 !== 0) {
    throw new RangeError('rgba length must be divisible by 4');
  }
}

function getPixelLimit(rgba, width, height) {
  const availablePixels = rgba.length / 4;

  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return availablePixels;
  }

  return Math.min(availablePixels, Math.max(0, Math.floor(width) * Math.floor(height)));
}

function normalizePositiveInteger(value, fallback) {
  if (value === undefined) {
    return fallback;
  }

  const integer = Math.floor(Number(value));

  if (!Number.isFinite(integer) || integer < 1) {
    return fallback;
  }

  return integer;
}

function quantizeChannel(value, bucketSize) {
  return clampChannel(Math.floor(value / bucketSize) * bucketSize);
}

function toHexPair(value) {
  return clampChannel(value).toString(16).padStart(2, '0');
}

function clampChannel(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(255, Math.max(0, Math.round(value)));
}

function isNearWhite(r, g, b) {
  return r >= NEAR_WHITE_THRESHOLD && g >= NEAR_WHITE_THRESHOLD && b >= NEAR_WHITE_THRESHOLD;
}

function isNearBlack(r, g, b) {
  return r <= NEAR_BLACK_THRESHOLD && g <= NEAR_BLACK_THRESHOLD && b <= NEAR_BLACK_THRESHOLD;
}

function readRgb(red, green, blue) {
  if (typeof red === 'object' && red !== null) {
    return {
      r: clampChannel(red.r),
      g: clampChannel(red.g),
      b: clampChannel(red.b),
    };
  }

  return {
    r: clampChannel(red),
    g: clampChannel(green),
    b: clampChannel(blue),
  };
}

function parseColor(color) {
  if (typeof color === 'string') {
    return parseHexColor(color);
  }

  return readRgb(color);
}

function parseHexColor(color) {
  const normalized = color.trim().replace(/^#/, '');

  if (/^[0-9a-fA-F]{3}$/.test(normalized)) {
    const [r, g, b] = normalized.split('').map((part) => parseInt(`${part}${part}`, 16));
    return { r, g, b };
  }

  if (/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return {
      r: parseInt(normalized.slice(0, 2), 16),
      g: parseInt(normalized.slice(2, 4), 16),
      b: parseInt(normalized.slice(4, 6), 16),
    };
  }

  throw new TypeError(`Invalid hex color: ${color}`);
}

function getRelativeLuminance(r, g, b) {
  const [red, green, blue] = [r, g, b].map((channel) => {
    const value = clampChannel(channel) / 255;

    return value <= 0.03928
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}
