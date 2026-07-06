const TAG_DATE_TIME = 0x0132;
const TAG_MODEL = 0x0110;
const TAG_EXIF_IFD = 0x8769;
const TAG_GPS_IFD = 0x8825;
const TAG_DATE_ORIGINAL = 0x9003;
const TAG_DATE_DIGITIZED = 0x9004;

export function formatExifDate(value) {
  const match = String(value || '').match(/^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!match) {
    return { raw: '', date: '', display: '' };
  }

  const year = match[1];
  const month = match[2];
  const day = match[3];
  return {
    raw: value,
    date: year + '-' + month + '-' + day,
    display: year + '.' + month + '.' + day,
  };
}

export function gpsToDecimal(values, ref = '') {
  if (!Array.isArray(values) || values.length < 3) return null;
  const degrees = rationalToNumber(values[0]);
  const minutes = rationalToNumber(values[1]);
  const seconds = rationalToNumber(values[2]);
  if (![degrees, minutes, seconds].every(Number.isFinite)) return null;

  const sign = ['S', 'W'].includes(String(ref).toUpperCase()) ? -1 : 1;
  const decimal = degrees + minutes / 60 + seconds / 3600;
  return Number((decimal * sign).toFixed(6));
}

export async function extractPhotoMetadata(file) {
  if (!file || typeof file.arrayBuffer !== 'function') return emptyMetadata();

  try {
    const buffer = await file.arrayBuffer();
    return extractMetadataFromBuffer(buffer, file);
  } catch {
    return emptyMetadata();
  }
}

export async function extractMetadataFromBuffer(buffer, fileInfo = {}) {
  if (!buffer) return metadataWithFallback(null, fileInfo);
  const parsed = await parseMetadata(buffer, fileInfo);
  return metadataWithFallback(parsed, fileInfo);
}

function emptyMetadata() {
  return {
    rawDate: '',
    date: '',
    displayDate: '',
    latitude: null,
    longitude: null,
    gpsLabel: '',
    camera: '',
  };
}

function metadataWithFallback(parsed, fileInfo) {
  const metadata = parsed ? metadataFromParsed(parsed) : emptyMetadata();

  if (!metadata.date && Number.isFinite(fileInfo.lastModified) && fileInfo.lastModified > 0) {
    const date = new Date(fileInfo.lastModified);
    if (!Number.isNaN(date.getTime())) {
      const isoDate = date.toISOString().slice(0, 10);
      return {
        ...metadata,
        rawDate: 'file:lastModified',
        date: isoDate,
        displayDate: isoDate.replace(/-/g, '.'),
      };
    }
  }

  return metadata;
}

function metadataFromParsed(parsed) {
  const dateInfo = formatExifDate(parsed.dateTimeOriginal || parsed.dateTime || '');
  const latitude = readLatitude(parsed);
  const longitude = readLongitude(parsed);

  return {
    rawDate: dateInfo.raw,
    date: dateInfo.date,
    displayDate: dateInfo.display,
    latitude,
    longitude,
    gpsLabel: latitude !== null && longitude !== null ? latitude.toFixed(4) + ', ' + longitude.toFixed(4) : '',
    camera: parsed.camera || '',
  };
}

function readLatitude(parsed) {
  if (parsed.gpsLatitudeDecimal !== undefined) return normalizeDecimalCoordinate(parsed.gpsLatitudeDecimal, 90);
  return gpsToDecimal(parsed.gpsLatitude, parsed.gpsLatitudeRef);
}

function readLongitude(parsed) {
  if (parsed.gpsLongitudeDecimal !== undefined) return normalizeDecimalCoordinate(parsed.gpsLongitudeDecimal, 180);
  return gpsToDecimal(parsed.gpsLongitude, parsed.gpsLongitudeRef);
}

function normalizeDecimalCoordinate(value, limit) {
  const number = Number(value);
  const coordinate = Number.isFinite(number) ? number : parseCoordinateText(value);
  if (!Number.isFinite(coordinate) || coordinate < -limit || coordinate > limit) return null;
  return Number(coordinate.toFixed(6));
}

function parseCoordinateText(value) {
  const text = String(value || '').trim();
  if (!text) return Number.NaN;

  const refMatch = text.match(/[NSEW]$/i);
  const ref = refMatch ? refMatch[0].toUpperCase() : '';
  const cleaned = text.replace(/[NSEW]$/i, '').trim();
  const parts = cleaned
    .replace(/[^0-9.+-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(Number);

  if (!parts.length || parts.some(function (part) { return !Number.isFinite(part); })) return Number.NaN;
  const sign = cleaned.startsWith('-') || ref === 'S' || ref === 'W' ? -1 : 1;
  const degrees = Math.abs(parts[0]);
  const minutes = parts[1] || 0;
  const seconds = parts[2] || 0;
  return sign * (degrees + minutes / 60 + seconds / 3600);
}

async function parseMetadata(buffer, fileInfo = {}) {
  const view = buffer instanceof DataView ? buffer : new DataView(buffer);
  return parseJpegExif(view) || await parsePngMetadata(view) || parseHeicMetadata(view, fileInfo) || null;
}

function parseJpegExif(view) {
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;

  let offset = 2;
  while (offset + 4 < view.byteLength) {
    if (view.getUint8(offset) !== 0xff) break;
    const marker = view.getUint8(offset + 1);
    const segmentLength = view.getUint16(offset + 2, false);
    const segmentStart = offset + 4;

    if (marker === 0xe1 && hasExifHeader(view, segmentStart)) {
      return readTiff(view, segmentStart + 6);
    }

    offset += 2 + segmentLength;
  }

  return null;
}

async function parsePngMetadata(view) {
  if (!hasPngSignature(view)) return null;

  let offset = 8;
  const textEntries = {};
  let exif = null;

  while (offset + 12 <= view.byteLength) {
    const length = view.getUint32(offset, false);
    const type = readAscii(view, offset + 4, 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > view.byteLength) break;

    if (type === 'eXIf') {
      exif = readTiff(view, dataStart);
    } else if (type === 'tEXt') {
      Object.assign(textEntries, readPngTextChunk(view, dataStart, length));
    } else if (type === 'zTXt') {
      Object.assign(textEntries, await readPngCompressedTextChunk(view, dataStart, length));
    } else if (type === 'iTXt') {
      Object.assign(textEntries, await readPngInternationalTextChunk(view, dataStart, length));
    }

    offset = dataEnd + 4;
  }

  return mergeParsedMetadata(exif, pngTextToParsed(textEntries));
}

function parseHeicMetadata(view, fileInfo) {
  if (!looksLikeHeic(view, fileInfo)) return null;
  const tiffStart = findTiffHeader(view);
  if (tiffStart !== -1) return readTiff(view, tiffStart);

  const xmpPacket = findEmbeddedXmpPacket(view);
  if (!xmpPacket) return null;
  const parsed = xmpTextToParsed({ xmp: xmpPacket });
  return hasParsedMetadata(parsed) ? parsed : null;
}

function findEmbeddedXmpPacket(view) {
  const text = decodeUtf8(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  const start = text.indexOf('<x:xmpmeta') !== -1 ? text.indexOf('<x:xmpmeta') : text.indexOf('<rdf:RDF');
  if (start === -1) return '';

  const xmpEnd = text.indexOf('</x:xmpmeta>', start);
  if (xmpEnd !== -1) return text.slice(start, xmpEnd + '</x:xmpmeta>'.length);

  const rdfEnd = text.indexOf('</rdf:RDF>', start);
  return rdfEnd === -1 ? '' : text.slice(start, rdfEnd + '</rdf:RDF>'.length);
}

function hasExifHeader(view, offset) {
  return offset + 6 <= view.byteLength &&
    view.getUint8(offset) === 0x45 &&
    view.getUint8(offset + 1) === 0x78 &&
    view.getUint8(offset + 2) === 0x69 &&
    view.getUint8(offset + 3) === 0x66 &&
    view.getUint8(offset + 4) === 0 &&
    view.getUint8(offset + 5) === 0;
}

function hasPngSignature(view) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  return view.byteLength >= signature.length && signature.every(function (byte, index) {
    return view.getUint8(index) === byte;
  });
}

function readPngTextChunk(view, offset, length) {
  const text = readAscii(view, offset, length);
  const separator = text.indexOf('\0');
  if (separator === -1) return {};
  return { [text.slice(0, separator)]: text.slice(separator + 1) };
}

async function readPngCompressedTextChunk(view, offset, length) {
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, length);
  const separator = bytes.indexOf(0);
  if (separator === -1 || separator + 2 > bytes.length) return {};

  const compressionMethod = bytes[separator + 1];
  if (compressionMethod !== 0) return {};

  const inflated = await inflateBytes(bytes.slice(separator + 2));
  if (!inflated) return {};

  return {
    [decodeUtf8(bytes.slice(0, separator))]: decodeUtf8(inflated),
  };
}

async function inflateBytes(bytes) {
  if (typeof DecompressionStream === 'function' && typeof Blob === 'function' && typeof Response === 'function') {
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
      // Fall through to the Node test/runtime fallback when available.
    }
  }

  if (typeof window === 'undefined') {
    try {
      const zlib = await import('node:zlib');
      return new Uint8Array(zlib.inflateSync(bytes));
    } catch {
      return null;
    }
  }

  return null;
}

async function readPngInternationalTextChunk(view, offset, length) {
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, length);
  const firstNull = bytes.indexOf(0);
  if (firstNull === -1 || firstNull + 3 > bytes.length) return {};

  const keyword = decodeUtf8(bytes.slice(0, firstNull));
  const compressionFlag = bytes[firstNull + 1];
  const compressionMethod = bytes[firstNull + 2];
  const textStart = findInternationalTextValueOffset(bytes, firstNull + 1);
  if (textStart === -1) return {};

  let textBytes = bytes.slice(textStart);
  if (compressionFlag === 1) {
    if (compressionMethod !== 0) return {};
    textBytes = await inflateBytes(textBytes);
    if (!textBytes) return {};
  } else if (compressionFlag !== 0) {
    return {};
  }

  return { [keyword]: decodeUtf8(textBytes) };
}

function findInternationalTextValueOffset(bytes, offset) {
  let cursor = offset + 2;
  for (let index = 0; index < 2; index += 1) {
    const nextNull = bytes.indexOf(0, cursor);
    if (nextNull === -1) return -1;
    cursor = nextNull + 1;
  }
  return cursor;
}

function decodeUtf8(bytes) {
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder('utf-8').decode(bytes).replace(/\0+$/, '').trim();
  }
  return Array.from(bytes, function (byte) { return String.fromCharCode(byte); }).join('').replace(/\0+$/, '').trim();
}

function pngTextToParsed(entries) {
  const xmp = xmpTextToParsed(entries);
  const dateTime = firstText(entries, ['DateTimeOriginal', 'DateTime', 'Creation Time', 'CreationTime', 'date:create']) || xmp.dateTime;
  const gpsLatitudeDecimal = firstText(entries, ['GPSLatitude', 'Latitude', 'latitude']) || xmp.gpsLatitudeDecimal;
  const gpsLongitudeDecimal = firstText(entries, ['GPSLongitude', 'Longitude', 'longitude']) || xmp.gpsLongitudeDecimal;
  const camera = firstText(entries, ['Model', 'Camera', 'Device']) || xmp.camera;

  if (!dateTime && !gpsLatitudeDecimal && !gpsLongitudeDecimal && !camera) return null;

  return {
    dateTime,
    gpsLatitudeDecimal,
    gpsLongitudeDecimal,
    camera,
  };
}

function xmpTextToParsed(entries) {
  const packet = findXmpPacket(entries);
  if (!packet) return {};

  return {
    dateTime: normalizeXmpDate(firstXmpValue(packet, ['xmp:CreateDate', 'xmp:ModifyDate', 'photoshop:DateCreated', 'exif:DateTimeOriginal'])),
    gpsLatitudeDecimal: firstXmpValue(packet, ['exif:GPSLatitude']),
    gpsLongitudeDecimal: firstXmpValue(packet, ['exif:GPSLongitude']),
    camera: firstXmpValue(packet, ['tiff:Model', 'exif:LensModel']),
  };
}

function hasParsedMetadata(parsed) {
  return Boolean(parsed?.dateTime || parsed?.dateTimeOriginal || parsed?.gpsLatitudeDecimal || parsed?.gpsLongitudeDecimal || parsed?.camera);
}

function findXmpPacket(entries) {
  for (const key of Object.keys(entries)) {
    const name = key.toLowerCase();
    const value = String(entries[key] || '');
    if (name.includes('xmp') || value.includes('<x:xmpmeta') || value.includes('<rdf:RDF')) return value;
  }
  return '';
}

function firstXmpValue(packet, names) {
  for (const name of names) {
    const escaped = escapeRegExp(name);
    const doubleAttribute = new RegExp('(?:^|[\\s<])' + escaped + '\\s*=\\s*"([^"]*)"', 'i').exec(packet);
    if (doubleAttribute) return decodeXmlEntities(doubleAttribute[1]);

    const singleAttribute = new RegExp("(?:^|[\\s<])" + escaped + "\\s*=\\s*'([^']*)'", 'i').exec(packet);
    if (singleAttribute) return decodeXmlEntities(singleAttribute[1]);

    const element = new RegExp('<' + escaped + '[^>]*>([\\s\\S]*?)<\\/' + escaped + '>', 'i').exec(packet);
    if (element) return decodeXmlEntities(element[1]);
  }
  return '';
}

function normalizeXmpDate(value) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) return value || '';
  return match[1] + ':' + match[2] + ':' + match[3] + ' ' + (match[4] || '00') + ':' + (match[5] || '00') + ':' + (match[6] || '00');
}

function decodeXmlEntities(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}

function firstText(entries, keys) {
  for (const key of keys) {
    if (entries[key]) return entries[key];
  }
  return '';
}

function mergeParsedMetadata(primary, fallback) {
  if (!primary) return fallback;
  if (!fallback) return primary;
  return {
    ...fallback,
    ...primary,
    dateTime: primary.dateTime || fallback.dateTime,
    dateTimeOriginal: primary.dateTimeOriginal || fallback.dateTimeOriginal,
    gpsLatitudeDecimal: primary.gpsLatitudeDecimal ?? fallback.gpsLatitudeDecimal,
    gpsLongitudeDecimal: primary.gpsLongitudeDecimal ?? fallback.gpsLongitudeDecimal,
    camera: primary.camera || fallback.camera,
  };
}

function looksLikeHeic(view, fileInfo = {}) {
  const name = String(fileInfo.name || '').toLowerCase();
  const type = String(fileInfo.type || '').toLowerCase();
  if (name.endsWith('.heic') || name.endsWith('.heif') || type.includes('heic') || type.includes('heif')) return true;
  if (view.byteLength < 12 || readAscii(view, 4, 4) !== 'ftyp') return false;
  const major = readAscii(view, 8, 4);
  return ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(major);
}

function findTiffHeader(view) {
  for (let offset = 0; offset + 4 <= view.byteLength; offset += 1) {
    const little = view.getUint8(offset) === 0x49 &&
      view.getUint8(offset + 1) === 0x49 &&
      view.getUint16(offset + 2, true) === 42;
    const big = view.getUint8(offset) === 0x4d &&
      view.getUint8(offset + 1) === 0x4d &&
      view.getUint16(offset + 2, false) === 42;
    if (little || big) return offset;
  }
  return -1;
}

function readTiff(view, tiffStart) {
  const byteOrder = readAscii(view, tiffStart, 2);
  const littleEndian = byteOrder === 'II';
  if (!littleEndian && byteOrder !== 'MM') return null;
  if (view.getUint16(tiffStart + 2, littleEndian) !== 42) return null;

  const firstIfdOffset = view.getUint32(tiffStart + 4, littleEndian);
  const root = readIfd(view, tiffStart, tiffStart + firstIfdOffset, littleEndian);
  const exif = root[TAG_EXIF_IFD] ? readIfd(view, tiffStart, tiffStart + root[TAG_EXIF_IFD], littleEndian) : {};
  const gps = root[TAG_GPS_IFD] ? readIfd(view, tiffStart, tiffStart + root[TAG_GPS_IFD], littleEndian) : {};

  return {
    dateTime: root[TAG_DATE_TIME],
    dateTimeOriginal: exif[TAG_DATE_ORIGINAL] || exif[TAG_DATE_DIGITIZED],
    camera: root[TAG_MODEL] || '',
    gpsLatitudeRef: gps[0x0001],
    gpsLatitude: gps[0x0002],
    gpsLongitudeRef: gps[0x0003],
    gpsLongitude: gps[0x0004],
  };
}

function readIfd(view, tiffStart, ifdOffset, littleEndian) {
  if (ifdOffset < 0 || ifdOffset + 2 > view.byteLength) return {};
  const entryCount = view.getUint16(ifdOffset, littleEndian);
  const entries = {};

  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = ifdOffset + 2 + index * 12;
    if (entryOffset + 12 > view.byteLength) break;
    const tag = view.getUint16(entryOffset, littleEndian);
    const type = view.getUint16(entryOffset + 2, littleEndian);
    const count = view.getUint32(entryOffset + 4, littleEndian);
    entries[tag] = readValue(view, tiffStart, entryOffset + 8, type, count, littleEndian);
  }

  return entries;
}

function readValue(view, tiffStart, valueOffset, type, count, littleEndian) {
  const bytes = typeSize(type) * count;
  const inlineOffset = bytes <= 4 ? valueOffset : tiffStart + view.getUint32(valueOffset, littleEndian);
  if (inlineOffset < 0 || inlineOffset + Math.max(bytes, 0) > view.byteLength) return null;

  if (type === 2) {
    return readAscii(view, inlineOffset, count).replace(/\0+$/, '').trim();
  }

  if (type === 3) {
    return count === 1
      ? view.getUint16(inlineOffset, littleEndian)
      : Array.from({ length: count }, function (_, index) { return view.getUint16(inlineOffset + index * 2, littleEndian); });
  }

  if (type === 4) {
    return count === 1
      ? view.getUint32(inlineOffset, littleEndian)
      : Array.from({ length: count }, function (_, index) { return view.getUint32(inlineOffset + index * 4, littleEndian); });
  }

  if (type === 5) {
    return Array.from({ length: count }, function (_, index) {
      return {
        numerator: view.getUint32(inlineOffset + index * 8, littleEndian),
        denominator: view.getUint32(inlineOffset + index * 8 + 4, littleEndian),
      };
    });
  }

  return null;
}

function typeSize(type) {
  return ({ 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 })[type] || 0;
}

function readAscii(view, offset, length) {
  let result = '';
  for (let index = 0; index < length && offset + index < view.byteLength; index += 1) {
    result += String.fromCharCode(view.getUint8(offset + index));
  }
  return result;
}

function rationalToNumber(value) {
  if (typeof value === 'number') return value;
  if (!value || !value.denominator) return Number.NaN;
  return value.numerator / value.denominator;
}
