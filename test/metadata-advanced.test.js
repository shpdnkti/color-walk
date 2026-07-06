import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';

import { extractMetadataFromBuffer } from '../src/exif.js';

test('extracts PNG textual creation time and GPS metadata', async () => {
  const buffer = makePng([
    textChunk('Creation Time', '2026:05:04 03:02:01'),
    textChunk('GPSLatitude', '31.2300'),
    textChunk('GPSLongitude', '121.4728'),
  ]);

  const metadata = await extractMetadataFromBuffer(buffer, { type: 'image/png', name: 'walk.png' });

  assert.equal(metadata.date, '2026-05-04');
  assert.equal(metadata.displayDate, '2026.05.04');
  assert.equal(metadata.latitude, 31.23);
  assert.equal(metadata.longitude, 121.4728);
  assert.equal(metadata.gpsLabel, '31.2300, 121.4728');
});

test('extracts PNG compressed textual creation time and GPS metadata', async () => {
  const buffer = makePng([
    compressedTextChunk('Creation Time', '2026:08:09 10:11:12'),
    compressedTextChunk('GPSLatitude', '31.2300'),
    compressedTextChunk('GPSLongitude', '121.4728'),
  ]);

  const metadata = await extractMetadataFromBuffer(buffer, { type: 'image/png', name: 'compressed.png' });

  assert.equal(metadata.date, '2026-08-09');
  assert.equal(metadata.displayDate, '2026.08.09');
  assert.equal(metadata.latitude, 31.23);
  assert.equal(metadata.longitude, 121.4728);
  assert.equal(metadata.gpsLabel, '31.2300, 121.4728');
});

test('extracts PNG compressed international textual creation time and GPS metadata', async () => {
  const buffer = makePng([
    internationalTextChunk('Creation Time', '2026:09:10 11:12:13', { compressed: true }),
    internationalTextChunk('GPSLatitude', '31.2300', { compressed: true }),
    internationalTextChunk('GPSLongitude', '121.4728', { compressed: true }),
  ]);

  const metadata = await extractMetadataFromBuffer(buffer, { type: 'image/png', name: 'international.png' });

  assert.equal(metadata.date, '2026-09-10');
  assert.equal(metadata.displayDate, '2026.09.10');
  assert.equal(metadata.latitude, 31.23);
  assert.equal(metadata.longitude, 121.4728);
  assert.equal(metadata.gpsLabel, '31.2300, 121.4728');
});

test('extracts PNG XMP creation date and GPS metadata', async () => {
  const xmp = [
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '<rdf:Description xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:exif="http://ns.adobe.com/exif/1.0/" xmlns:tiff="http://ns.adobe.com/tiff/1.0/"',
    ' xmp:CreateDate="2026-10-11T12:13:14+08:00" exif:GPSLatitude="31,13.800000N" exif:GPSLongitude="121,28.368000E" tiff:Model="iPhone 16" />',
    '</rdf:RDF>',
    '</x:xmpmeta>',
  ].join('');
  const buffer = makePng([
    textChunk('XML:com.adobe.xmp', xmp),
  ]);

  const metadata = await extractMetadataFromBuffer(buffer, { type: 'image/png', name: 'xmp.png' });

  assert.equal(metadata.rawDate, '2026:10:11 12:13:14');
  assert.equal(metadata.date, '2026-10-11');
  assert.equal(metadata.displayDate, '2026.10.11');
  assert.equal(metadata.latitude, 31.23);
  assert.equal(metadata.longitude, 121.4728);
  assert.equal(metadata.gpsLabel, '31.2300, 121.4728');
  assert.equal(metadata.camera, 'iPhone 16');
});

test('extracts PNG eXIf TIFF dates', async () => {
  const buffer = makePng([
    chunk('eXIf', makeTiffWithDate('2026:06:07 08:09:10')),
  ]);

  const metadata = await extractMetadataFromBuffer(buffer, { type: 'image/png', name: 'camera.png' });

  assert.equal(metadata.rawDate, '2026:06:07 08:09:10');
  assert.equal(metadata.date, '2026-06-07');
});

test('extracts HEIC metadata from embedded TIFF payloads', async () => {
  const prefix = new Uint8Array([
    0, 0, 0, 24, 102, 116, 121, 112, 104, 101, 105, 99,
    0, 0, 0, 0, 104, 101, 105, 99, 109, 105, 102, 49,
  ]);
  const tiff = makeTiffWithDate('2026:07:08 09:10:11');
  const buffer = joinBytes(prefix, new Uint8Array([0, 0, 0, 8, 102, 114, 101, 101]), tiff).buffer;

  const metadata = await extractMetadataFromBuffer(buffer, { type: 'image/heic', name: 'IMG_0001.HEIC' });

  assert.equal(metadata.date, '2026-07-08');
  assert.equal(metadata.displayDate, '2026.07.08');
});

test('uses file lastModified as a date fallback when embedded metadata is unavailable', async () => {
  const metadata = await extractMetadataFromBuffer(new ArrayBuffer(0), {
    type: 'image/png',
    name: 'compressed.png',
    lastModified: Date.UTC(2026, 4, 4, 3, 2, 1),
  });

  assert.equal(metadata.date, '2026-05-04');
  assert.equal(metadata.displayDate, '2026.05.04');
  assert.equal(metadata.rawDate, 'file:lastModified');
});

function makePng(chunks) {
  return joinBytes(
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    ...chunks,
    chunk('IEND', new Uint8Array()),
  ).buffer;
}

function textChunk(keyword, value) {
  return chunk('tEXt', ascii(keyword + '\0' + value));
}

function compressedTextChunk(keyword, value) {
  return chunk('zTXt', joinBytes(
    ascii(keyword + '\0'),
    new Uint8Array([0]),
    deflateSync(Buffer.from(value, 'utf8')),
  ));
}

function internationalTextChunk(keyword, value, options = {}) {
  const compressed = options.compressed === true;
  const text = Buffer.from(value, 'utf8');
  return chunk('iTXt', joinBytes(
    ascii(keyword + '\0'),
    new Uint8Array([compressed ? 1 : 0, 0]),
    ascii('zh-CN\0'),
    ascii('metadata\0'),
    compressed ? deflateSync(text) : text,
  ));
}

function chunk(type, data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const result = new Uint8Array(12 + bytes.length);
  const view = new DataView(result.buffer);
  view.setUint32(0, bytes.length);
  result.set(ascii(type), 4);
  result.set(bytes, 8);
  view.setUint32(8 + bytes.length, 0);
  return result;
}

function makeTiffWithDate(date) {
  const dateBytes = ascii(date + '\0');
  const result = new Uint8Array(8 + 2 + 12 + 4 + dateBytes.length);
  const view = new DataView(result.buffer);
  result.set(ascii('II'), 0);
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);
  view.setUint16(8, 1, true);
  view.setUint16(10, 0x0132, true);
  view.setUint16(12, 2, true);
  view.setUint32(14, dateBytes.length, true);
  view.setUint32(18, 26, true);
  view.setUint32(22, 0, true);
  result.set(dateBytes, 26);
  return result;
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
