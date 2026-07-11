import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { chromium } from 'playwright';

import { createColorWalkServer } from '../server.js';

const fixturePath = resolve('test/fixtures/upload.heic');
const progressiveTimeoutMs = 5_000;
const decodeTimeoutMs = 15_000;

assert.ok(existsSync(fixturePath), 'HEIC fixture not found: ' + fixturePath);

const validHeicBuffer = readFileSync(fixturePath);
const corruptHeicBuffer = Buffer.from([
  0x00, 0x00, 0x00, 0x18,
  0x66, 0x74, 0x79, 0x70,
  0x68, 0x65, 0x69, 0x63,
  0x00, 0x00, 0x00, 0x00,
  0x68, 0x65, 0x69, 0x63,
]);

const firstDecoderRequestSeen = deferred();
const releaseFirstDecoderRequest = deferred();
let firstDecoderRequestContinued = false;
let decoderRequests = 0;

const app = createColorWalkServer();
const port = await listenOnLocalhost(app);
let browser;

try {
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1024, height: 900 }, deviceScaleFactor: 1 });
  const pageErrors = [];

  page.on('pageerror', function (error) {
    pageErrors.push(String(error?.message || error));
  });

  await page.addInitScript(function () {
    const NativeWorker = window.Worker;
    window.__colorWalkWorkerPostMessages = 0;
    window.Worker = new Proxy(NativeWorker, {
      construct(Target, args) {
        const worker = new Target(...args);
        const nativePostMessage = worker.postMessage.bind(worker);
        worker.postMessage = function (...postMessageArgs) {
          window.__colorWalkWorkerPostMessages += 1;
          return nativePostMessage(...postMessageArgs);
        };
        return worker;
      },
    });
  });

  await page.route('**/vendor/heic-to/heic-to.js*', async function (route) {
    decoderRequests += 1;
    if (decoderRequests === 1) {
      firstDecoderRequestSeen.resolve();
      await releaseFirstDecoderRequest.promise;
      await route.continue();
      firstDecoderRequestContinued = true;
      return;
    }
    await route.continue();
  });

  await page.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(function () { localStorage.clear(); });
  await page.reload({ waitUntil: 'domcontentloaded' });

  const fastPng = await createCanvasFile(page, {
    name: 'fast.png',
    mimeType: 'image/png',
    color: '#ee6040',
  });
  const fastJpeg = await createCanvasFile(page, {
    name: 'fast.jpg',
    mimeType: 'image/jpeg',
    color: '#3468d8',
  });

  await page.setInputFiles('#fileInput', [
    filePayload('slow-one.heic', 'image/heic', validHeicBuffer),
    filePayload('slow-two.heif', 'image/heif', validHeicBuffer),
    fastPng,
  ]);

  await withTimeout(
    firstDecoderRequestSeen.promise,
    progressiveTimeoutMs,
    'HEIC decoder request did not start'
  );
  assert.equal(firstDecoderRequestContinued, false, 'decoder request should still be pending');
  assert.equal(decoderRequests, 1);

  await waitForUploadedPhoto(page, 'fast.png', progressiveTimeoutMs, {
    message: 'fast.png should become editable while slow.heic is waiting for the decoder',
  });
  assert.equal(firstDecoderRequestContinued, false, 'fast.png appeared only after the decoder was released');
  assert.equal(decoderRequests, 1);

  const fontSizeProbe = await page.evaluate(async function () {
    const input = document.querySelector('#fontSizeInput');
    const before = input.value;
    const next = before === input.max ? String(Number(before) - 1) : String(Number(before) + 1);
    input.value = next;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(function (resolveFrame) { requestAnimationFrame(resolveFrame); });
    return {
      before,
      next,
      inputValue: input.value,
      previewFontSize: document.documentElement.style.getPropertyValue('--text-font-size') || '',
    };
  });
  assert.notEqual(fontSizeProbe.next, fontSizeProbe.before);
  assert.equal(fontSizeProbe.inputValue, fontSizeProbe.next);
  assert.equal(fontSizeProbe.previewFontSize, fontSizeProbe.next + 'px');
  assert.equal(firstDecoderRequestContinued, false, 'font size interaction waited for HEIC decoding');

  releaseFirstDecoderRequest.resolve();
  await waitForPhotoSet(page, ['slow-one.heic', 'slow-two.heif', 'fast.png'], decodeTimeoutMs);
  assert.deepEqual(
    await page.locator('.photo-card img').evaluateAll(function (images) {
      return images.map(function (image) { return image.alt; });
    }),
    ['slow-one.heic', 'slow-two.heif', 'fast.png'],
    'progressive completion must preserve the original file selection order'
  );
  await page.waitForFunction(function () {
    return ['slow-one.heic', 'slow-two.heif'].every(function (fileName) {
      const image = Array.from(document.querySelectorAll('.photo-card img')).find(function (item) {
        return item.alt === fileName;
      });
      const color = image?.closest('.photo-card')?.querySelector('.color-chip span:last-child')?.textContent?.trim();
      return color && color !== '#A0A0A0';
    });
  }, null, { timeout: decodeTimeoutMs });
  const colorProbe = await page.evaluate(function () {
    const colors = Array.from(document.querySelectorAll('.color-chip span:last-child'), function (node) {
      return node.textContent.trim();
    });
    const channels = colors.map(function (hex) {
      return [1, 3, 5].map(function (offset) { return Number.parseInt(hex.slice(offset, offset + 2), 16); });
    });
    const average = channels[0].map(function (_, channel) {
      return Math.round(channels.reduce(function (sum, color) { return sum + color[channel]; }, 0) / channels.length);
    });
    return {
      previewColor: document.documentElement.style.getPropertyValue('--preview-color'),
      averageColor: '#' + average.map(function (value) { return value.toString(16).padStart(2, '0'); }).join(''),
    };
  });
  assert.equal(colorProbe.previewColor, colorProbe.averageColor, 'preview color should average every uploaded photo');
  const workerMessagesAfterProgressiveUpload = await readWorkerMessageCount(page);
  assert.ok(workerMessagesAfterProgressiveUpload >= 2, 'both slow HEIC/HEIF files should be sent to the HEIC worker');

  await resetEditor(page);

  const workerMessagesBeforeCorruptUpload = await readWorkerMessageCount(page);
  await page.setInputFiles('#fileInput', [
    filePayload('corrupt.heic', 'image/heic', corruptHeicBuffer),
    fastJpeg,
  ]);
  await waitForIsolatedFailure(page, 'fast.jpg', 'corrupt.heic', decodeTimeoutMs);

  const isolatedFailureProbe = await page.evaluate(function () {
    return {
      status: document.querySelector('#exportStatus')?.textContent || '',
      photoCards: document.querySelectorAll('.photo-card').length,
      fastCards: document.querySelectorAll('.photo-card img[alt="fast.jpg"]').length,
      corruptCards: document.querySelectorAll('.photo-card img[alt="corrupt.heic"]').length,
      fastPreviewImages: document.querySelectorAll('.preview-image.has-photo img[alt="fast.jpg"]').length,
    };
  });
  assert.equal(isolatedFailureProbe.photoCards, 1);
  assert.equal(isolatedFailureProbe.fastCards, 1);
  assert.equal(isolatedFailureProbe.corruptCards, 0);
  assert.ok(isolatedFailureProbe.fastPreviewImages >= 1);
  assertOneSuccessOneFailure(isolatedFailureProbe.status);

  const workerMessagesAfterCorruptUpload = await readWorkerMessageCount(page);
  assert.ok(
    workerMessagesAfterCorruptUpload > workerMessagesBeforeCorruptUpload,
    'corrupt.heic should reach the loaded HEIC decoder and fail there'
  );

  await resetEditor(page);

  const workerMessagesBeforeRetry = await readWorkerMessageCount(page);
  await page.setInputFiles('#fileInput', filePayload('retry.heic', 'image/heic', validHeicBuffer));
  await waitForUploadedPhoto(page, 'retry.heic', decodeTimeoutMs, {
    message: 'a valid HEIC should succeed after an actual decode failure in the same page',
  });
  await waitForPhotoSet(page, ['retry.heic'], decodeTimeoutMs);

  const workerMessagesAfterRetry = await readWorkerMessageCount(page);
  assert.ok(workerMessagesAfterRetry > workerMessagesBeforeRetry, 'retry.heic should reach the HEIC decoder');
  assert.equal(decoderRequests, 1, 'the successful retry should reuse the loaded decoder module');

  await page.waitForTimeout(50);
  assert.deepEqual(pageErrors, []);

  await verifyWorkerRecovery(browser, port, validHeicBuffer);
  await verifyNativeClickUpload(browser, port, fastJpeg);

  console.log('PASS progressive upload regression: progressive rendering, failure isolation, and HEIC retry work.');
} finally {
  releaseFirstDecoderRequest.resolve();
  if (browser) await browser.close();
  await closeServer(app);
}

async function verifyWorkerRecovery(currentBrowser, serverPort, heicBuffer) {
  const page = await currentBrowser.newPage({ viewport: { width: 1024, height: 900 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  let workerScriptRequests = 0;
  page.on('pageerror', function (error) {
    pageErrors.push(String(error?.message || error));
  });
  await page.route('**/src/heic-decoder-worker.js*', async function (route) {
    workerScriptRequests += 1;
    if (workerScriptRequests === 1) {
      await route.fulfill({
        status: 200,
        contentType: 'text/javascript',
        body: [
          "self.postMessage({ type: 'ready' });",
          'self.onmessage = function () {',
          "  setTimeout(function () { throw new Error('forced worker crash'); }, 0);",
          '};',
        ].join('\n'),
      });
      return;
    }
    await route.continue();
  });

  try {
    await page.goto('http://127.0.0.1:' + serverPort + '/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(function () {
      window.__uploadSettledCount = 0;
      window.addEventListener('color-walk:upload-settled', function () {
        window.__uploadSettledCount += 1;
      });
    });
    await page.setInputFiles('#fileInput', [
      filePayload('worker-crash.heic', 'image/heic', heicBuffer),
      filePayload('worker-recovery.heic', 'image/heic', heicBuffer),
    ]);
    await page.waitForFunction(function () {
      return window.__uploadSettledCount === 1;
    }, null, { timeout: decodeTimeoutMs });

    const probe = await page.evaluate(function () {
      return {
        names: Array.from(document.querySelectorAll('.photo-card img'), function (image) { return image.alt; }),
        status: document.querySelector('#exportStatus')?.textContent || '',
      };
    });
    assert.deepEqual(probe.names, ['worker-recovery.heic']);
    assertOneSuccessOneFailure(probe.status);
    assert.ok(workerScriptRequests >= 2, 'queued HEIC should load a replacement worker after a runtime failure');
    assert.deepEqual(pageErrors, []);
  } finally {
    await page.close();
  }
}

async function verifyNativeClickUpload(currentBrowser, serverPort, jpegPayload) {
  const page = await currentBrowser.newPage({ viewport: { width: 1024, height: 900 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on('pageerror', function (error) {
    pageErrors.push(String(error?.message || error));
  });
  await page.addInitScript(function () {
    const NativeWorker = window.Worker;
    window.__nativeUploadWorkerMessages = 0;
    window.Worker = new Proxy(NativeWorker, {
      construct(Target, args) {
        const worker = new Target(...args);
        const nativePostMessage = worker.postMessage.bind(worker);
        worker.postMessage = function (...postMessageArgs) {
          window.__nativeUploadWorkerMessages += 1;
          return nativePostMessage(...postMessageArgs);
        };
        return worker;
      },
    });
  });

  try {
    await page.goto('http://127.0.0.1:' + serverPort + '/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(function () {
      window.__nativePhotoReady = null;
      window.addEventListener('color-walk:photo-ready', function (event) {
        window.__nativePhotoReady = event.detail;
      }, { once: true });
    });
    const chooserPromise = page.waitForEvent('filechooser');
    await page.click('label[for="fileInput"]');
    const chooser = await chooserPromise;
    await chooser.setFiles(jpegPayload);
    await waitForUploadedPhoto(page, jpegPayload.name, progressiveTimeoutMs, {
      message: 'a JPEG chosen through the real upload button should remain immediately editable',
    });
    await page.waitForFunction(function () {
      return window.__nativePhotoReady !== null;
    }, null, { timeout: progressiveTimeoutMs });

    const probe = await page.evaluate(function () {
      return {
        ready: window.__nativePhotoReady,
        workerMessages: window.__nativeUploadWorkerMessages,
      };
    });
    assert.equal(probe.ready?.fileName, jpegPayload.name);
    assert.ok(probe.ready.elapsedMs < 1_000, 'JPEG upload should not compete with HEIC warmup');
    assert.equal(probe.workerMessages, 0, 'JPEG upload must never be posted to the HEIC decoder');
    await page.waitForTimeout(50);
    assert.deepEqual(pageErrors, []);
  } finally {
    await page.close();
  }
}

function filePayload(name, mimeType, buffer) {
  return { name, mimeType, buffer };
}

async function createCanvasFile(page, { name, mimeType, color }) {
  const bytes = await page.evaluate(async function ({ type, fill }) {
    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 72;
    const context = canvas.getContext('2d');
    context.fillStyle = fill;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#ffffff';
    context.fillRect(12, 12, 24, 18);
    const blob = await new Promise(function (resolveBlob) {
      canvas.toBlob(resolveBlob, type, 0.9);
    });
    if (!blob) throw new Error('Canvas could not encode ' + type);
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  }, { type: mimeType, fill: color });

  return filePayload(name, mimeType, Buffer.from(bytes));
}

async function waitForUploadedPhoto(page, fileName, timeout, { message }) {
  try {
    await page.waitForFunction(function (name) {
      const cardImage = document.querySelector('.photo-card img[alt="' + CSS.escape(name) + '"]');
      const card = cardImage?.closest('.photo-card');
      const slider = card?.querySelector('.photo-crop-slider');
      const previewImage = document.querySelector('.preview-image.has-photo img[alt="' + CSS.escape(name) + '"]');
      return Boolean(card && slider && previewImage && previewImage.naturalWidth > 0 && previewImage.naturalHeight > 0);
    }, fileName, { timeout });
  } catch (error) {
    throw new Error(message + ': ' + error.message);
  }
}

async function waitForPhotoSet(page, fileNames, timeout) {
  await page.waitForFunction(function (expectedNames) {
    const actualNames = Array.from(document.querySelectorAll('.photo-card img'), function (image) {
      return image.alt;
    }).sort();
    const expected = expectedNames.slice().sort();
    return actualNames.length === expected.length
      && actualNames.every(function (name, index) { return name === expected[index]; });
  }, fileNames, { timeout });
}

async function waitForIsolatedFailure(page, successfulFileName, failedFileName, timeout) {
  await page.waitForFunction(function ({ successName, failureName }) {
    const status = document.querySelector('#exportStatus')?.textContent || '';
    const cards = Array.from(document.querySelectorAll('.photo-card img'), function (image) { return image.alt; });
    const hasSuccessCount = /(?:成功|已加入|完成)[^，。；;]{0,16}1(?:\s*张)?|1(?:\s*张)?[^，。；;]{0,16}(?:成功|已加入|完成)/.test(status);
    const hasFailureCount = /失败[^，。；;]{0,16}1(?:\s*张)?|1(?:\s*张)?[^，。；;]{0,16}失败/.test(status);
    return cards.length === 1
      && cards.includes(successName)
      && !cards.includes(failureName)
      && hasSuccessCount
      && hasFailureCount;
  }, { successName: successfulFileName, failureName: failedFileName }, { timeout });
}

function assertOneSuccessOneFailure(status) {
  const hasSuccessCount = /(?:成功|已加入|完成)[^，。；;]{0,16}1(?:\s*张)?|1(?:\s*张)?[^，。；;]{0,16}(?:成功|已加入|完成)/.test(status);
  const hasFailureCount = /失败[^，。；;]{0,16}1(?:\s*张)?|1(?:\s*张)?[^，。；;]{0,16}失败/.test(status);
  assert.ok(hasSuccessCount, 'status should report one successful upload: ' + status);
  assert.ok(hasFailureCount, 'status should report one failed upload: ' + status);
}

async function resetEditor(page) {
  page.once('dialog', function (dialog) { dialog.accept(); });
  await page.click('#resetButton');
  await page.waitForFunction(function () {
    return document.querySelectorAll('.photo-card').length === 0
      && document.querySelector('#exportStatus')?.textContent === '画布已重置。';
  });
}

function readWorkerMessageCount(page) {
  return page.evaluate(function () { return window.__colorWalkWorkerPostMessages || 0; });
}

function deferred() {
  let resolvePromise;
  const promise = new Promise(function (resolveDeferred) {
    resolvePromise = resolveDeferred;
  });
  return { promise, resolve: resolvePromise };
}

async function withTimeout(promise, timeout, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise(function (_, rejectTimeout) {
        timer = setTimeout(function () { rejectTimeout(new Error(message)); }, timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
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
