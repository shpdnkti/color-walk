import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildUploadStatusMessage,
  isHeicFile,
  normalizeUploadFile,
} from '../src/upload.js';

function makeFile({ name = 'photo.jpg', type = 'image/jpeg', bytes = [1, 2, 3], lastModified = 1234 } = {}) {
  const data = new Uint8Array(bytes);
  return {
    name,
    type,
    lastModified,
    async arrayBuffer() {
      return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    },
  };
}

function heicBytes(brand = 'heic') {
  return [
    0, 0, 0, 24,
    102, 116, 121, 112,
    ...Array.from(brand).map(function (char) { return char.charCodeAt(0); }),
    0, 0, 0, 0,
  ];
}

function pngDataUrl() {
  return 'data:image/png;base64,cG5n';
}

async function loadMockImage(src) {
  return {
    src,
    naturalWidth: src.includes('jpeg') ? 1200 : 800,
    naturalHeight: src.includes('jpeg') ? 900 : 600,
  };
}

test('detects HEIC files by MIME type, extension, and ftyp brand', async () => {
  assert.equal(await isHeicFile(makeFile({ name: 'camera.jpg', type: 'image/heic' })), true);
  assert.equal(await isHeicFile(makeFile({ name: 'IMG_0001.HEIF', type: '' })), true);
  assert.equal(await isHeicFile(makeFile({ name: 'IMG_0002.hif', type: '' })), true);
  assert.equal(await isHeicFile(makeFile({ name: 'unknown.bin', type: '', bytes: heicBytes('mif1') })), true);
  assert.equal(await isHeicFile(makeFile({ name: 'walk.jpg', type: 'image/jpeg', bytes: [255, 216, 255] })), false);
});

test('normalizes regular image uploads without conversion', async () => {
  const file = makeFile({ name: 'walk.png', type: 'image/png' });
  const normalized = await normalizeUploadFile(file, {
    readAsDataUrl: async () => pngDataUrl(),
    loadImage: loadMockImage,
    extractMetadata: async () => ({ date: '2026-07-07' }),
  });

  assert.equal(normalized.fileName, 'walk.png');
  assert.equal(normalized.dataUrl, pngDataUrl());
  assert.equal(normalized.src, pngDataUrl());
  assert.equal(normalized.metadata.date, '2026-07-07');
  assert.equal(normalized.naturalWidth, 800);
  assert.equal(normalized.naturalHeight, 600);
  assert.equal(normalized.convertedFromHeic, false);
});

test('converts HEIC uploads to JPEG while keeping original metadata source', async () => {
  const heicFile = makeFile({ name: 'IMG_0001.HEIC', type: 'image/heic', bytes: heicBytes() });
  const metadataCalls = [];
  const normalized = await normalizeUploadFile(heicFile, {
    readAsDataUrl: async () => {
      throw new Error('HEIC should not be read directly as preview data URL');
    },
    convertHeicToJpeg: async (file, options) => {
      assert.equal(file, heicFile);
      assert.deepEqual(options, { quality: 0.92 });
      return 'data:image/jpeg;base64,anBlZw==';
    },
    loadImage: loadMockImage,
    extractMetadata: async (file) => {
      metadataCalls.push(file);
      return { date: '2026-07-08', rawDate: '2026:07:08 09:10:11' };
    },
  });

  assert.equal(normalized.fileName, 'IMG_0001.HEIC');
  assert.equal(normalized.dataUrl, 'data:image/jpeg;base64,anBlZw==');
  assert.equal(normalized.metadata.date, '2026-07-08');
  assert.equal(normalized.naturalWidth, 1200);
  assert.equal(normalized.naturalHeight, 900);
  assert.equal(normalized.convertedFromHeic, true);
  assert.deepEqual(metadataCalls, [heicFile]);
});

test('falls back to native HEIC decode and JPEG transcode when conversion fails', async () => {
  const calls = [];
  const normalized = await normalizeUploadFile(makeFile({ name: 'iphone.HEIC', type: 'image/heic', bytes: heicBytes() }), {
    readAsDataUrl: async () => 'data:image/heic;base64,aGVpYw==',
    convertHeicToJpeg: async () => {
      throw new Error('worker conversion failed');
    },
    loadImage: async (src) => {
      calls.push(src);
      return { src, naturalWidth: 1600, naturalHeight: 1200 };
    },
    transcodeImageToJpeg: async (image, options) => {
      assert.equal(image.src, 'data:image/heic;base64,aGVpYw==');
      assert.deepEqual(options, { quality: 0.92 });
      return 'data:image/jpeg;base64,bmF0aXZl';
    },
    extractMetadata: async () => ({ date: '2026-07-09' }),
  });

  assert.equal(normalized.ok, true);
  assert.equal(normalized.fileName, 'iphone.HEIC');
  assert.equal(normalized.dataUrl, 'data:image/jpeg;base64,bmF0aXZl');
  assert.equal(normalized.metadata.date, '2026-07-09');
  assert.equal(normalized.convertedFromHeic, true);
  assert.deepEqual(calls, ['data:image/heic;base64,aGVpYw==', 'data:image/jpeg;base64,bmF0aXZl']);
});

test('normalizing a failed HEIC conversion returns a skipped result', async () => {
  const result = await normalizeUploadFile(makeFile({ name: 'bad.HEIC', type: 'image/heic', bytes: heicBytes() }), {
    convertHeicToJpeg: async () => {
      throw new Error('decode failed');
    },
    extractMetadata: async () => ({ date: '2026-07-08' }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.fileName, 'bad.HEIC');
  assert.equal(result.reason, 'heic_conversion_failed');
});

test('builds upload status copy for complete, partial, and failed batches', () => {
  assert.equal(buildUploadStatusMessage({ loaded: 2, failed: 0 }), '已完成识别，可以继续调整文本和结构。');
  assert.equal(buildUploadStatusMessage({ loaded: 2, failed: 1 }), '已完成 2 张图片识别，1 张 HEIC 转换失败已跳过。');
  assert.equal(buildUploadStatusMessage({ loaded: 0, failed: 2 }), 'HEIC 转换失败，请先转为 JPEG 或 PNG 后重试。');
});
