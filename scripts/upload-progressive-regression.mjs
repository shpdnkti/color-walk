import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { chromium } from 'playwright';

import { createColorWalkServer } from '../server.js';

const heicFixture = readFileSync(resolve('test/fixtures/upload.heic'));
const app = createColorWalkServer();
const port = await listenOnLocalhost(app);
let browser;

try {
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1024, height: 900 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  let delayDecoder = true;
  let holdGeocode = false;
  let geocodeRequested = false;
  let releaseGeocode = function () {};
  let geocodeGate = Promise.resolve();

  page.on('pageerror', function (error) {
    pageErrors.push(String(error?.message || error));
  });
  await page.route('**/vendor/heic-to/heic-to.js*', async function (route) {
    if (delayDecoder) await delay(750);
    await route.continue();
  });
  await page.route('**/api/reverse-geocode**', async function (route) {
    geocodeRequested = true;
    if (holdGeocode) await geocodeGate;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ label: '测试地点' }),
    });
  });

  await page.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(function () { localStorage.clear(); });
  const png = await createCanvasImage(page, 'image/png');
  const jpeg = await createCanvasImage(page, 'image/jpeg');

  await page.evaluate(function () {
    window.__photoReadyEvents = [];
    window.__uploadSettledEvents = [];
    window.addEventListener('color-walk:photo-ready', function (event) {
      window.__photoReadyEvents.push(event.detail);
    });
    window.addEventListener('color-walk:upload-settled', function (event) {
      window.__uploadSettledEvents.push(event.detail);
    });
    document.querySelector('#fileInput').addEventListener('change', function () {
      const scheduledAt = performance.now();
      setTimeout(function () {
        const input = document.querySelector('#coverTextInput');
        input.value = '用户输入保留';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        window.__uploadInteractionDelay = performance.now() - scheduledAt;
      }, 20);
    }, { capture: true, once: true });
  });

  await page.setInputFiles('#fileInput', [
    { name: 'fast.png', mimeType: 'image/png', buffer: png },
    { name: 'slow.heic', mimeType: 'image/heic', buffer: heicFixture },
  ]);

  await page.waitForFunction(function () {
    return window.__photoReadyEvents.length === 1
      && document.querySelectorAll('.photo-card').length === 1;
  }, null, { timeout: 500 });
  assert.equal(await page.locator('.photo-card').count(), 1);
  assert.equal(await page.inputValue('#coverTextInput'), '用户输入保留');
  assert.ok(await page.evaluate(function () { return window.__uploadInteractionDelay < 150; }));

  await page.waitForFunction(function () {
    return window.__uploadSettledEvents.length === 1
      && document.querySelectorAll('.photo-card').length === 2;
  }, null, { timeout: 10_000 });
  assert.equal(await page.inputValue('#coverTextInput'), '用户输入保留');
  await resetEditor(page);

  delayDecoder = false;
  const brokenHeic = Buffer.from([
    0, 0, 0, 24, 102, 116, 121, 112, 104, 101, 105, 99,
    0, 0, 0, 0, 104, 101, 105, 99, 109, 105, 102, 49,
  ]);
  await page.setInputFiles('#fileInput', [
    { name: 'kept.jpg', mimeType: 'image/jpeg', buffer: jpeg },
    { name: 'broken.heic', mimeType: 'image/heic', buffer: brokenHeic },
  ]);
  await page.waitForFunction(function () {
    return window.__uploadSettledEvents.length === 2;
  }, null, { timeout: 10_000 });
  assert.equal(await page.locator('.photo-card').count(), 1);
  assert.match(await page.textContent('#exportStatus'), /已完成 1 张图片识别，1 张读取失败已跳过/);
  await resetEditor(page);

  holdGeocode = true;
  geocodeGate = new Promise(function (resolveGate) { releaseGeocode = resolveGate; });
  geocodeRequested = false;
  const gpsPng = addPngTextChunks(png, [
    ['Creation Time', '2026:05:04 03:02:01'],
    ['GPSLatitude', '31.2300'],
    ['GPSLongitude', '121.4728'],
  ]);
  await page.setInputFiles('#fileInput', {
    name: 'gps.png',
    mimeType: 'image/png',
    buffer: gpsPng,
  });
  await page.waitForFunction(function () {
    return document.querySelectorAll('.photo-card').length === 1;
  }, null, { timeout: 500 });
  await waitFor(function () { return geocodeRequested; });
  assert.equal(await page.locator('.photo-card').count(), 1);
  releaseGeocode();
  await page.waitForFunction(function () {
    return document.querySelector('#coverTextInput')?.value.includes('测试地点');
  }, null, { timeout: 5_000 });

  assert.deepEqual(pageErrors, []);
  console.log('PASS progressive upload regression: first-ready, partial failure, and background geocode.');
} finally {
  if (browser) await browser.close();
  await closeServer(app);
}

async function createCanvasImage(page, type) {
  const bytes = await page.evaluate(async function (mimeType) {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 24;
    const context = canvas.getContext('2d');
    context.fillStyle = '#d65d7a';
    context.fillRect(0, 0, 16, 24);
    context.fillStyle = '#315b7d';
    context.fillRect(16, 0, 16, 24);
    const blob = await new Promise(function (resolveBlob) { canvas.toBlob(resolveBlob, mimeType, 0.9); });
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  }, type);
  return Buffer.from(bytes);
}

function addPngTextChunks(png, entries) {
  const ihdrEnd = 8 + 12 + png.readUInt32BE(8);
  const chunks = entries.map(function (entry) {
    return pngChunk('tEXt', Buffer.from(entry[0] + '\0' + entry[1], 'latin1'));
  });
  return Buffer.concat([png.subarray(0, ihdrEnd), ...chunks, png.subarray(ihdrEnd)]);
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return chunk;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function resetEditor(page) {
  page.once('dialog', function (dialog) { dialog.accept(); });
  await page.click('#resetButton');
  await page.waitForFunction(function () {
    return document.querySelectorAll('.photo-card').length === 0;
  });
}

function delay(milliseconds) {
  return new Promise(function (resolveDelay) { setTimeout(resolveDelay, milliseconds); });
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await delay(10);
  }
  throw new Error('Timed out waiting for progressive regression state.');
}

function listenOnLocalhost(server) {
  return new Promise(function (resolvePort, reject) {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', function () {
      server.removeListener('error', reject);
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
