import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { chromium } from 'playwright';

import { createColorWalkServer } from '../server.js';

const app = createColorWalkServer();
const port = await listenOnLocalhost(app);
let browser;

try {
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1024, height: 900 }, deviceScaleFactor: 1 });
  await page.addInitScript(function () {
    const createObjectURL = URL.createObjectURL.bind(URL);
    window.__NativeXMLSerializer = window.XMLSerializer;
    window.__aspectExportCount = 0;
    URL.createObjectURL = function (blob) {
      if (blob?.type === 'image/png') window.__aspectExportCount += 1;
      return createObjectURL(blob);
    };
  });
  await page.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(function () { localStorage.clear(); });
  await page.reload({ waitUntil: 'domcontentloaded' });

  const widePng = await createMarkedImage(page, 300, 100, 'wide-marked.png');
  await page.setInputFiles('#fileInput', widePng);
  await waitForUpload(page);
  await page.waitForFunction(function () {
    const frame = document.querySelector('.movie-photo.has-photo');
    return Number(frame?.style.getPropertyValue('--image-contain-height') || 1) < 0.99;
  });
  assert.equal(
    await page.locator('.photo-thumb img').evaluate(function (image) { return getComputedStyle(image).objectFit; }),
    'cover',
    'upload-management thumbnails should retain their square cover crop'
  );

  const probe = await readPreviewGeometry(page);
  assert.equal(probe.naturalWidth, 300);
  assert.equal(probe.naturalHeight, 100);
  assert.equal(probe.scale, '1.000');
  assert.ok(Math.abs(probe.imageRatio - 3) < 0.02, 'wide image ratio should remain 3:1, got ' + probe.imageRatio);
  assert.ok(probe.imageLeft >= probe.frameLeft - 1, 'wide image left edge should remain visible');
  assert.ok(probe.imageRight <= probe.frameRight + 1, 'wide image right edge should remain visible');
  assert.ok(probe.imageTop > probe.frameTop + 1, 'wide image should use top letterboxing in the poster frame');
  assert.ok(probe.imageBottom < probe.frameBottom - 1, 'wide image should use bottom letterboxing in the poster frame');

  await assertMarkedExport(page, probe, false);
  await assertMarkedExport(page, probe, true);

  await resetEditor(page);
  const jpeg = await createMarkedImage(page, 320, 180, 'wide-marked.jpg', 'image/jpeg');
  await page.setInputFiles('#fileInput', jpeg);
  await waitForUpload(page);
  assertContainedGeometry(await readPreviewGeometry(page), 16 / 9, 'JPEG preview');

  await resetEditor(page);
  const portraitPng = await createMarkedImage(page, 100, 300, 'portrait-marked.png');
  await page.setInputFiles('#fileInput', portraitPng);
  await waitForUpload(page);
  await page.waitForFunction(function () {
    const frame = document.querySelector('.movie-photo.has-photo');
    return Number(frame?.style.getPropertyValue('--image-contain-width') || 1) < 0.99;
  });

  for (const outputRatio of ['3:4', '4:5', '9:16', '2:3', '1:2']) {
    await page.click('button[data-ratio="' + outputRatio + '"]');
    for (const colorRatio of [35, 50, 65]) {
      await page.locator('#ratioInput').evaluate(function (input, value) {
        input.value = String(value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, colorRatio);
      await page.evaluate(function () {
        return new Promise(function (resolveFrame) {
          requestAnimationFrame(function () { requestAnimationFrame(resolveFrame); });
        });
      });
      assertContainedGeometry(await readPreviewGeometry(page), 1 / 3, 'portrait ' + outputRatio + ' at ' + colorRatio + '%');
    }
  }

  const portraitProbe = await readPreviewGeometry(page);
  await assertMarkedExport(page, portraitProbe, false);
  await assertMarkedExport(page, portraitProbe, true);

  await resetEditor(page);
  await page.click('button[data-ratio="3:4"]');
  await page.locator('#ratioInput').evaluate(function (input) {
    input.value = '50';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const squarePng = await createMarkedImage(page, 200, 200, 'square-marked.png');
  await page.setInputFiles('#fileInput', squarePng);
  await waitForUpload(page);
  await page.waitForFunction(function () {
    const frame = document.querySelector('.movie-photo.has-photo');
    return Number(frame?.style.getPropertyValue('--image-contain-width') || 1) < 0.99;
  });
  assertContainedGeometry(await readPreviewGeometry(page), 1, 'square preview');

  await page.locator('.photo-crop-slider').evaluate(function (input) {
    input.value = '200';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(function () {
    return document.querySelector('.movie-photo')?.style.getPropertyValue('--image-scale').trim() === '2.000';
  });
  const beforeDrag = await readPreviewGeometry(page);
  await dragMoviePhoto(page, 48, 32);
  const transformed = await readPreviewGeometry(page);
  assert.ok(Math.abs(transformed.imageRatio - 1) < 0.02, 'zoom and drag must preserve the square ratio');
  assert.notEqual(transformed.translateX, beforeDrag.translateX, 'zoomed image should support horizontal focus adjustment');
  assert.notEqual(transformed.translateY, beforeDrag.translateY, 'zoomed image should support vertical focus adjustment');

  const domTransformGrid = await readExportGrid(page, false);
  const canvasTransformGrid = await readExportGrid(page, true);
  assertPixelGridsNear(canvasTransformGrid, domTransformGrid, 'Canvas fallback should match the transformed DOM snapshot');

  await page.locator('#ratioInput').evaluate(function (input) {
    input.value = '65';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const switched = await readPreviewGeometry(page);
  assert.equal(switched.translateX, '0px', 'ratio changes should clamp an unavailable horizontal focus offset');
  const switchedDomGrid = await readExportGrid(page, false);
  const switchedCanvasGrid = await readExportGrid(page, true);
  assertPixelGridsNear(
    switchedCanvasGrid,
    switchedDomGrid,
    'Canvas fallback should match the DOM snapshot after clamping a transform for a new ratio'
  );

  await page.click('#stashButton');
  await page.waitForFunction(function () {
    return document.querySelector('#exportStatus')?.textContent === '已保存当前图片、布局、文案和样式草稿。';
  });
  const savedTransform = await page.evaluate(function () {
    return JSON.parse(localStorage.getItem('color-walk-draft')).photos[0].transform;
  });
  assert.equal(savedTransform.x, 0, 'draft state should store the transform clamped for the current ratio');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(function () {
    return document.querySelector('#exportStatus')?.textContent === '已恢复上次草稿。'
      && document.querySelector('.movie-photo.has-photo img');
  });
  await page.waitForFunction(function () {
    return document.querySelector('.movie-photo')?.style.getPropertyValue('--image-scale').trim() === '2.000';
  });
  const restored = await readPreviewGeometry(page);
  assert.equal(restored.scale, switched.scale);
  assert.equal(restored.translateX, switched.translateX);
  assert.equal(restored.translateY, switched.translateY);
  assert.ok(Math.abs(restored.imageRatio - 1) < 0.02, 'draft restore must preserve the square ratio');

  await resetEditor(page);
  const sourceHeic = readFileSync(resolve('test/fixtures/upload.heic'));
  await page.setInputFiles('#fileInput', {
    name: 'orientation-source.heic',
    mimeType: 'image/heic',
    buffer: sourceHeic,
  });
  await waitForUpload(page);
  const sourceOrientation = await readImageCorners(page);
  assert.equal(sourceOrientation.width, 96);
  assert.equal(sourceOrientation.height, 72);

  await resetEditor(page);
  await page.setInputFiles('#fileInput', {
    name: 'orientation-rotated.heic',
    mimeType: 'image/heic',
    buffer: addHeicRotation(sourceHeic, 1),
  });
  await waitForUpload(page);
  await page.waitForFunction(function () {
    const image = document.querySelector('.movie-photo.has-photo img');
    return image?.naturalWidth === 72 && image?.naturalHeight === 96;
  });
  const oriented = await readImageCorners(page);
  assert.equal(oriented.width, 72);
  assert.equal(oriented.height, 96);
  assertPixelNear(oriented.topLeft, sourceOrientation.topRight, 'HEIC irot=1 should rotate the top-right marker to top-left');
  assertPixelNear(oriented.topRight, sourceOrientation.bottomRight, 'HEIC irot=1 should rotate the bottom-right marker to top-right');
  assertPixelNear(oriented.bottomLeft, sourceOrientation.topLeft, 'HEIC irot=1 should rotate the top-left marker to bottom-left');
  assertPixelNear(oriented.bottomRight, sourceOrientation.bottomLeft, 'HEIC irot=1 should rotate the bottom-left marker to bottom-right');
  assertContainedGeometry(await readPreviewGeometry(page), 72 / 96, 'oriented HEIC preview');

  console.log('PASS image aspect regression: ratios, orientation, exports, transforms, and draft restore remain consistent.');
} finally {
  if (browser) await browser.close();
  await closeServer(app);
}

async function createMarkedImage(page, width, height, name, mimeType = 'image/png') {
  const bytes = await page.evaluate(async function ({ imageWidth, imageHeight, imageMimeType }) {
    const canvas = document.createElement('canvas');
    canvas.width = imageWidth;
    canvas.height = imageHeight;
    const context = canvas.getContext('2d');
    context.fillStyle = '#8d99a6';
    context.fillRect(0, 0, imageWidth, imageHeight);
    context.fillStyle = '#e53935';
    context.fillRect(0, 0, imageWidth * 0.2, imageHeight * 0.2);
    context.fillStyle = '#43a047';
    context.fillRect(imageWidth * 0.8, 0, imageWidth * 0.2, imageHeight * 0.2);
    context.fillStyle = '#1e88e5';
    context.fillRect(0, imageHeight * 0.8, imageWidth * 0.2, imageHeight * 0.2);
    context.fillStyle = '#fdd835';
    context.fillRect(imageWidth * 0.8, imageHeight * 0.8, imageWidth * 0.2, imageHeight * 0.2);
    const blob = await new Promise(function (resolveBlob) { canvas.toBlob(resolveBlob, imageMimeType, 0.95); });
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  }, { imageWidth: width, imageHeight: height, imageMimeType: mimeType });
  return { name, mimeType, buffer: Buffer.from(bytes) };
}

async function waitForUpload(page) {
  await page.waitForFunction(function () {
    const status = document.querySelector('#exportStatus')?.textContent || '';
    return status === '已完成识别，可以继续调整文本和结构。'
      || status.includes('读取失败');
  });
  assert.equal(
    await page.textContent('#exportStatus'),
    '已完成识别，可以继续调整文本和结构。'
  );
}

function readPreviewGeometry(page) {
  return page.evaluate(function () {
    const frame = document.querySelector('.movie-photo.has-photo');
    const image = frame.querySelector('img');
    const canvasRect = document.querySelector('#previewCanvas').getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    const imageRect = image.getBoundingClientRect();
    return {
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      scale: frame.style.getPropertyValue('--image-scale').trim(),
      translateX: frame.style.getPropertyValue('--image-translate-x').trim(),
      translateY: frame.style.getPropertyValue('--image-translate-y').trim(),
      imageRatio: imageRect.width / imageRect.height,
      frameLeft: frameRect.left,
      frameRight: frameRect.right,
      frameTop: frameRect.top,
      frameBottom: frameRect.bottom,
      imageLeft: imageRect.left,
      imageRight: imageRect.right,
      imageTop: imageRect.top,
      imageBottom: imageRect.bottom,
      normalized: {
        frameLeft: (frameRect.left - canvasRect.left) / canvasRect.width,
        frameRight: (frameRect.right - canvasRect.left) / canvasRect.width,
        frameTop: (frameRect.top - canvasRect.top) / canvasRect.height,
        frameBottom: (frameRect.bottom - canvasRect.top) / canvasRect.height,
        imageLeft: (imageRect.left - canvasRect.left) / canvasRect.width,
        imageRight: (imageRect.right - canvasRect.left) / canvasRect.width,
        imageTop: (imageRect.top - canvasRect.top) / canvasRect.height,
        imageBottom: (imageRect.bottom - canvasRect.top) / canvasRect.height,
      },
    };
  });
}

async function assertMarkedExport(page, probe, forceCanvasFallback) {
  await runExport(page, forceCanvasFallback);

  const bounds = probe.normalized;
  const imageWidth = bounds.imageRight - bounds.imageLeft;
  const imageHeight = bounds.imageBottom - bounds.imageTop;
  const points = {
    topLeft: { x: bounds.imageLeft + imageWidth * 0.1, y: bounds.imageTop + imageHeight * 0.1 },
    topRight: { x: bounds.imageLeft + imageWidth * 0.9, y: bounds.imageTop + imageHeight * 0.1 },
    bottomLeft: { x: bounds.imageLeft + imageWidth * 0.1, y: bounds.imageTop + imageHeight * 0.9 },
    bottomRight: { x: bounds.imageLeft + imageWidth * 0.9, y: bounds.imageTop + imageHeight * 0.9 },
    letterbox: bounds.imageTop > bounds.frameTop + 0.001
      ? { x: (bounds.frameLeft + bounds.frameRight) / 2, y: (bounds.frameTop + bounds.imageTop) / 2 }
      : { x: (bounds.frameLeft + bounds.imageLeft) / 2, y: (bounds.frameTop + bounds.frameBottom) / 2 },
  };
  const pixels = await page.evaluate(function (samplePoints) {
    const canvas = document.querySelector('#exportCanvas');
    const context = canvas.getContext('2d');
    return Object.fromEntries(Object.entries(samplePoints).map(function ([name, point]) {
      const x = Math.min(canvas.width - 1, Math.max(0, Math.round(point.x * canvas.width)));
      const y = Math.min(canvas.height - 1, Math.max(0, Math.round(point.y * canvas.height)));
      return [name, Array.from(context.getImageData(x, y, 1, 1).data.slice(0, 3))];
    }));
  }, points);
  const path = forceCanvasFallback ? 'Canvas fallback' : 'DOM snapshot';
  assertPixelNear(pixels.topLeft, [229, 57, 53], path + ' should retain the top-left marker');
  assertPixelNear(pixels.topRight, [67, 160, 71], path + ' should retain the top-right marker');
  assertPixelNear(pixels.bottomLeft, [30, 136, 229], path + ' should retain the bottom-left marker');
  assertPixelNear(pixels.bottomRight, [253, 216, 53], path + ' should retain the bottom-right marker');
  assertPixelNear(pixels.letterbox, [17, 26, 36], path + ' should retain the poster letterbox');
}

function assertContainedGeometry(probe, expectedRatio, label) {
  assert.ok(Math.abs(probe.imageRatio - expectedRatio) < 0.02, label + ' should preserve ratio, got ' + probe.imageRatio);
  assert.ok(probe.imageLeft >= probe.frameLeft - 1, label + ' should retain the left edge');
  assert.ok(probe.imageRight <= probe.frameRight + 1, label + ' should retain the right edge');
  assert.ok(probe.imageTop >= probe.frameTop - 1, label + ' should retain the top edge');
  assert.ok(probe.imageBottom <= probe.frameBottom + 1, label + ' should retain the bottom edge');
}

async function resetEditor(page) {
  page.once('dialog', function (dialog) { void dialog.accept(); });
  await page.click('#resetButton');
  await page.waitForFunction(function () {
    return document.querySelectorAll('.photo-card').length === 0;
  });
}

function assertPixelNear(actual, expected, message) {
  assert.ok(actual.every(function (value, index) {
    return Math.abs(value - expected[index]) <= 16;
  }), message + ': got ' + actual.join(','));
}

async function readExportGrid(page, forceCanvasFallback) {
  await runExport(page, forceCanvasFallback);
  return page.evaluate(function () {
    const preview = document.querySelector('#previewCanvas').getBoundingClientRect();
    const frame = document.querySelector('.movie-photo').getBoundingClientRect();
    const bounds = {
      left: (frame.left - preview.left) / preview.width,
      top: (frame.top - preview.top) / preview.height,
      width: frame.width / preview.width,
      height: frame.height / preview.height,
    };
    const canvas = document.querySelector('#exportCanvas');
    const context = canvas.getContext('2d');
    return [0.2, 0.5, 0.8].flatMap(function (yRatio) {
      return [0.2, 0.5, 0.8].map(function (xRatio) {
        const x = Math.round((bounds.left + bounds.width * xRatio) * canvas.width);
        const y = Math.round((bounds.top + bounds.height * yRatio) * canvas.height);
        return Array.from(context.getImageData(x, y, 1, 1).data.slice(0, 3));
      });
    });
  });
}

async function runExport(page, forceCanvasFallback) {
  if (forceCanvasFallback) {
    await page.evaluate(function () {
      window.XMLSerializer = class BrokenSerializer {
        serializeToString() { throw new Error('force canvas fallback'); }
      };
    });
  } else {
    await page.evaluate(function () { window.XMLSerializer = window.__NativeXMLSerializer; });
  }
  const previousCount = await page.evaluate(function () { return window.__aspectExportCount; });
  await page.click('#exportButton');
  await page.waitForFunction(function (count) {
    return window.__aspectExportCount > count
      && document.querySelector('#exportStatus')?.textContent === '已导出 PNG。';
  }, previousCount);
}

function assertPixelGridsNear(actual, expected, message) {
  assert.equal(actual.length, expected.length);
  actual.forEach(function (pixel, pixelIndex) {
    assert.ok(pixel.every(function (value, channel) {
      return Math.abs(value - expected[pixelIndex][channel]) <= 24;
    }), message + ' at sample ' + pixelIndex + ': got ' + pixel.join(',') + ', expected ' + expected[pixelIndex].join(','));
  });
}

function readImageCorners(page) {
  return page.evaluate(function () {
    const image = document.querySelector('.movie-photo.has-photo img');
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    function sample(xRatio, yRatio) {
      const x = Math.round((canvas.width - 1) * xRatio);
      const y = Math.round((canvas.height - 1) * yRatio);
      return Array.from(context.getImageData(x, y, 1, 1).data.slice(0, 3));
    }
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      topLeft: sample(0.15, 0.15),
      topRight: sample(0.85, 0.15),
      bottomLeft: sample(0.15, 0.85),
      bottomRight: sample(0.85, 0.85),
    };
  });
}

function addHeicRotation(source, quarterTurns) {
  const metaStart = findBoxStart(source, 'meta');
  const ilocStart = findBoxStart(source, 'iloc');
  const iprpStart = findBoxStart(source, 'iprp');
  const ipcoStart = findBoxStart(source, 'ipco');
  const ipmaStart = findBoxStart(source, 'ipma');
  const mdatStart = findBoxStart(source, 'mdat');
  const ipmaSize = source.readUInt32BE(ipmaStart);
  const associationCountOffset = ipmaStart + 18;
  const rotationProperty = Buffer.from([0, 0, 0, 9, 0x69, 0x72, 0x6f, 0x74, quarterTurns & 3]);
  const nextIpma = Buffer.concat([
    source.subarray(ipmaStart, associationCountOffset),
    Buffer.from([source[associationCountOffset] + 1]),
    source.subarray(associationCountOffset + 1, ipmaStart + ipmaSize),
    Buffer.from([0x85]),
  ]);
  nextIpma.writeUInt32BE(ipmaSize + 1, 0);

  const addedBytes = rotationProperty.length + 1;
  const result = Buffer.concat([
    source.subarray(0, ipmaStart),
    rotationProperty,
    nextIpma,
    source.subarray(mdatStart),
  ]);
  result.writeUInt32BE(source.readUInt32BE(metaStart) + addedBytes, metaStart);
  result.writeUInt32BE(source.readUInt32BE(iprpStart) + addedBytes, iprpStart);
  result.writeUInt32BE(source.readUInt32BE(ipcoStart) + rotationProperty.length, ipcoStart);
  const extentOffsetPosition = ilocStart + 26;
  result.writeUInt32BE(source.readUInt32BE(extentOffsetPosition) + addedBytes, extentOffsetPosition);
  return result;
}

function findBoxStart(buffer, type) {
  const typeOffset = buffer.indexOf(Buffer.from(type, 'ascii'));
  assert.ok(typeOffset >= 4, 'HEIC box not found: ' + type);
  return typeOffset - 4;
}

async function dragMoviePhoto(page, deltaX, deltaY) {
  const point = await page.evaluate(function () {
    const frame = document.querySelector('.movie-photo.has-photo');
    const rect = frame.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + deltaX, point.y + deltaY, { steps: 6 });
  await page.mouse.up();
}

function listenOnLocalhost(server) {
  return new Promise(function (resolvePort, reject) {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', function () {
      server.off('error', reject);
      resolvePort(server.address().port);
    });
  });
}

function closeServer(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise(function (resolveClose, reject) {
    server.close(function (error) {
      if (error) reject(error);
      else resolveClose();
    });
  });
}
