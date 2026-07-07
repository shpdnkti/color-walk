import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const testDir = dirname(fileURLToPath(import.meta.url));

function requireMiniprogramUtil(relativePath) {
  const filename = resolve(testDir, '..', relativePath);
  const source = readFileSync(filename, 'utf8');
  const module = { exports: {} };
  const wrapper = vm.runInThisContext(
    '(function (exports, require, module, __filename, __dirname) {' + source + '\n})',
    { filename },
  );
  wrapper(module.exports, require, module, filename, dirname(filename));
  return module.exports;
}

const exif = requireMiniprogramUtil('miniprogram/utils/exif.js');

test('miniprogram EXIF utility formats dates and GPS rationals', () => {
  assert.deepEqual(exif.formatExifDate('2026:04:14 09:08:07'), {
    raw: '2026:04:14 09:08:07',
    date: '2026-04-14',
    display: '2026.04.14',
  });

  assert.equal(exif.gpsToDecimal([
    { numerator: 31, denominator: 1 },
    { numerator: 13, denominator: 1 },
    { numerator: 48, denominator: 1 },
  ], 'N'), 31.23);
  assert.equal(exif.gpsToDecimal([
    { numerator: 121, denominator: 1 },
    { numerator: 28, denominator: 1 },
    { numerator: 22, denominator: 1 },
  ], 'E'), 121.472778);
});

test('miniprogram EXIF utility extracts JPEG date, GPS, and camera metadata', async () => {
  const metadata = await exif.extractMetadataFromBuffer(makeJpegWithExif(), {
    name: 'walk.jpg',
    type: 'image/jpeg',
    lastModified: Date.UTC(2026, 0, 1),
  });

  assert.equal(metadata.rawDate, '2026:05:04 03:02:01');
  assert.equal(metadata.date, '2026-05-04');
  assert.equal(metadata.displayDate, '2026.05.04');
  assert.equal(metadata.latitude, 31.23);
  assert.equal(metadata.longitude, 121.472778);
  assert.equal(metadata.gpsLabel, '31.2300, 121.4728');
  assert.equal(metadata.camera, 'Pixel Test');
});

function makeJpegWithExif() {
  const payload = joinBytes(ascii('Exif\0\0'), makeTiffWithDateGpsAndCamera());
  const segmentLength = payload.byteLength + 2;
  return joinBytes(
    new Uint8Array([0xff, 0xd8, 0xff, 0xe1, segmentLength >> 8, segmentLength & 0xff]),
    payload,
    new Uint8Array([0xff, 0xd9]),
  ).buffer;
}

function makeTiffWithDateGpsAndCamera() {
  const dateBytes = ascii('2026:05:04 03:02:01\0');
  const modelBytes = ascii('Pixel Test\0');
  const rootEntryCount = 3;
  const rootStart = 8;
  const rootDataStart = rootStart + 2 + rootEntryCount * 12 + 4;
  const dateOffset = rootDataStart;
  const modelOffset = dateOffset + dateBytes.byteLength;
  const gpsIfdOffset = modelOffset + modelBytes.byteLength;
  const gpsEntryCount = 4;
  const gpsDataStart = gpsIfdOffset + 2 + gpsEntryCount * 12 + 4;
  const latitudeOffset = gpsDataStart;
  const longitudeOffset = latitudeOffset + 24;
  const total = longitudeOffset + 24;
  const result = new Uint8Array(total);
  const view = new DataView(result.buffer);

  result.set(ascii('II'), 0);
  view.setUint16(2, 42, true);
  view.setUint32(4, rootStart, true);
  view.setUint16(rootStart, rootEntryCount, true);
  writeIfdEntry(view, rootStart + 2, 0x0132, 2, dateBytes.byteLength, dateOffset);
  writeIfdEntry(view, rootStart + 14, 0x0110, 2, modelBytes.byteLength, modelOffset);
  writeIfdEntry(view, rootStart + 26, 0x8825, 4, 1, gpsIfdOffset);
  view.setUint32(rootStart + 2 + rootEntryCount * 12, 0, true);
  result.set(dateBytes, dateOffset);
  result.set(modelBytes, modelOffset);

  view.setUint16(gpsIfdOffset, gpsEntryCount, true);
  writeIfdEntry(view, gpsIfdOffset + 2, 0x0001, 2, 2, asciiInline('N'));
  writeIfdEntry(view, gpsIfdOffset + 14, 0x0002, 5, 3, latitudeOffset);
  writeIfdEntry(view, gpsIfdOffset + 26, 0x0003, 2, 2, asciiInline('E'));
  writeIfdEntry(view, gpsIfdOffset + 38, 0x0004, 5, 3, longitudeOffset);
  view.setUint32(gpsIfdOffset + 2 + gpsEntryCount * 12, 0, true);
  writeRationals(view, latitudeOffset, [[31, 1], [13, 1], [48, 1]]);
  writeRationals(view, longitudeOffset, [[121, 1], [28, 1], [22, 1]]);

  return result;
}

function writeIfdEntry(view, offset, tag, type, count, value) {
  view.setUint16(offset, tag, true);
  view.setUint16(offset + 2, type, true);
  view.setUint32(offset + 4, count, true);
  view.setUint32(offset + 8, value, true);
}

function writeRationals(view, offset, values) {
  values.forEach(([numerator, denominator], index) => {
    view.setUint32(offset + index * 8, numerator, true);
    view.setUint32(offset + index * 8 + 4, denominator, true);
  });
}

function asciiInline(value) {
  const bytes = ascii(value + '\0');
  return bytes[0] + (bytes[1] << 8) + ((bytes[2] || 0) << 16) + ((bytes[3] || 0) << 24);
}

function ascii(value) {
  return Uint8Array.from(String(value), (char) => char.charCodeAt(0));
}

function joinBytes(...parts) {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  parts.forEach((part) => {
    const bytes = part instanceof Uint8Array ? part : new Uint8Array(part);
    result.set(bytes, offset);
    offset += bytes.byteLength;
  });
  return result;
}
