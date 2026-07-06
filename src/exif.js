const TAG_MAKE = 0x010f;
const TAG_MODEL = 0x0110;
const TAG_DATE_TIME = 0x0132;
const TAG_EXIF_IFD = 0x8769;
const TAG_GPS_IFD = 0x8825;
const TAG_EXPOSURE_TIME = 0x829a;
const TAG_F_NUMBER = 0x829d;
const TAG_ISO_SPEED = 0x8827;
const TAG_PHOTOGRAPHIC_SENSITIVITY = 0x8833;
const TAG_DATE_ORIGINAL = 0x9003;
const TAG_DATE_DIGITIZED = 0x9004;
const TAG_FOCAL_LENGTH = 0x920a;

export function formatExifDate(value) {
  const match = String(value || '').match(/^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!match) {
    return { raw: '', date: '', display: '', time: '' };
  }

  const year = match[1];
  const month = match[2];
  const day = match[3];
  const hour = match[4];
  const minute = match[5];
  return {
    raw: value,
    date: year + '-' + month + '-' + day,
    display: year + '.' + month + '.' + day,
    time: hour + ':' + minute,
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

export function formatAperture(value) {
  const number = rationalToNumber(Array.isArray(value) ? value[0] : value);
  if (!Number.isFinite(number) || number <= 0) return '';
  return 'f/' + trimNumber(number, 1);
}

export function formatShutterSpeed(value) {
  const number = rationalToNumber(Array.isArray(value) ? value[0] : value);
  if (!Number.isFinite(number) || number <= 0) return '';
  if (number >= 1) return trimNumber(number, 1) + 's';

  const denominator = Math.round(1 / number);
  if (!Number.isFinite(denominator) || denominator <= 0) return '';
  return '1/' + denominator + 's';
}

export function formatIso(value) {
  const number = Array.isArray(value) ? value[0] : value;
  if (!Number.isFinite(number) || number <= 0) return '';
  return 'ISO ' + Math.round(number);
}

export function formatFocalLength(value) {
  const number = rationalToNumber(Array.isArray(value) ? value[0] : value);
  if (!Number.isFinite(number) || number <= 0) return '';
  return trimNumber(number, 1) + 'mm';
}

export async function extractPhotoMetadata(file) {
  const empty = createEmptyMetadata();

  if (!file || typeof file.arrayBuffer !== 'function') return empty;

  try {
    const buffer = await file.arrayBuffer();
    const parsed = parseExif(buffer);
    if (!parsed) return empty;

    const dateInfo = formatExifDate(parsed.dateTimeOriginal || parsed.dateTime || '');
    const latitude = gpsToDecimal(parsed.gpsLatitude, parsed.gpsLatitudeRef);
    const longitude = gpsToDecimal(parsed.gpsLongitude, parsed.gpsLongitudeRef);

    return {
      rawDate: dateInfo.raw,
      date: dateInfo.date,
      displayDate: dateInfo.display,
      time: dateInfo.time,
      latitude,
      longitude,
      gpsLabel: latitude !== null && longitude !== null ? latitude.toFixed(4) + ', ' + longitude.toFixed(4) : '',
      camera: formatCamera(parsed.make, parsed.model),
      aperture: formatAperture(parsed.aperture),
      shutter: formatShutterSpeed(parsed.shutter),
      iso: formatIso(parsed.iso),
      focalLength: formatFocalLength(parsed.focalLength),
    };
  } catch {
    return empty;
  }
}

function createEmptyMetadata() {
  return {
    rawDate: '',
    date: '',
    displayDate: '',
    time: '',
    latitude: null,
    longitude: null,
    gpsLabel: '',
    camera: '',
    aperture: '',
    shutter: '',
    iso: '',
    focalLength: '',
  };
}

function parseExif(buffer) {
  const view = new DataView(buffer);
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

function hasExifHeader(view, offset) {
  return offset + 6 <= view.byteLength &&
    view.getUint8(offset) === 0x45 &&
    view.getUint8(offset + 1) === 0x78 &&
    view.getUint8(offset + 2) === 0x69 &&
    view.getUint8(offset + 3) === 0x66 &&
    view.getUint8(offset + 4) === 0 &&
    view.getUint8(offset + 5) === 0;
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
    make: root[TAG_MAKE] || '',
    model: root[TAG_MODEL] || '',
    aperture: exif[TAG_F_NUMBER],
    shutter: exif[TAG_EXPOSURE_TIME],
    iso: exif[TAG_PHOTOGRAPHIC_SENSITIVITY] || exif[TAG_ISO_SPEED],
    focalLength: exif[TAG_FOCAL_LENGTH],
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
    const values = Array.from({ length: count }, function (_, index) {
      return {
        numerator: view.getUint32(inlineOffset + index * 8, littleEndian),
        denominator: view.getUint32(inlineOffset + index * 8 + 4, littleEndian),
      };
    });
    return count === 1 ? values[0] : values;
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

function trimNumber(value, digits) {
  return Number(value.toFixed(digits)).toString();
}

function formatCamera(make, model) {
  const parts = [make, model].map(function (value) { return String(value || '').trim(); }).filter(Boolean);
  if (parts.length === 2 && parts[1].toLowerCase().startsWith(parts[0].toLowerCase())) return parts[1];
  return parts.join(' ');
}
