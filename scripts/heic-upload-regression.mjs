import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { chromium } from 'playwright';

import { createColorWalkServer } from '../server.js';

const fixturePath = resolve(process.env.COLOR_WALK_HEIC_FIXTURE || 'test/fixtures/upload.heic');
const fixtureMimeType = process.env.COLOR_WALK_HEIC_MIME_TYPE ?? 'image/heic';
const usesDefaultFixture = !process.env.COLOR_WALK_HEIC_FIXTURE;
const failFirstDecoderRequest = process.env.COLOR_WALK_HEIC_FAIL_FIRST_DECODER === '1';
const fixtureLastModified = Date.UTC(2024, 0, 2, 12);

if (!existsSync(fixturePath)) {
  console.error('HEIC fixture not found: ' + fixturePath);
  console.error('Set COLOR_WALK_HEIC_FIXTURE to a real .heic file.');
  process.exit(1);
}

const app = createColorWalkServer();
const port = await listenOnLocalhost(app);
let browser;

try {
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1024, height: 900 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  const consoleErrors = [];
  let reportPageError;
  const firstPageError = new Promise(function (resolveError) {
    reportPageError = resolveError;
  });

  page.on('pageerror', function (error) {
    const message = String(error?.message || error);
    pageErrors.push(message);
    reportPageError({ kind: 'pageerror', message });
  });
  page.on('console', function (message) {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.addInitScript(function () {
    window.__colorWalkCspViolations = [];
    window.__colorWalkWorkerSignals = [];
    document.addEventListener('securitypolicyviolation', function (event) {
      window.__colorWalkCspViolations.push({
        directive: event.effectiveDirective,
        blockedUri: event.blockedURI,
      });
    });
    const NativeWorker = window.Worker;
    window.Worker = new Proxy(NativeWorker, {
      construct(Target, args) {
        const worker = new Target(...args);
        worker.addEventListener('message', function (event) {
          const message = event.data || {};
          if (message.type === 'fatal' || message.type === 'decode-error') {
            window.__colorWalkWorkerSignals.push(message);
          }
        });
        worker.addEventListener('error', function (event) {
          window.__colorWalkWorkerSignals.push({ type: 'worker-error', message: event.message || '' });
        });
        return worker;
      },
    });
  });
  let decoderRequests = 0;
  await page.route('**/vendor/libheif/libheif-bundle.mjs*', function (route) {
    decoderRequests += 1;
    if (failFirstDecoderRequest && decoderRequests === 1) return route.abort('failed');
    return route.continue();
  });
  await page.route('**/api/reverse-geocode**', function (route) {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ label: '测试地点' }),
    });
  });

  const navigationResponse = await page.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'domcontentloaded' });
  const csp = navigationResponse?.headers()['content-security-policy'] || '';
  assert.match(csp, /script-src 'self' 'wasm-unsafe-eval'/);
  assert.doesNotMatch(csp, /(?:^|\s)'unsafe-eval'(?:\s|;|$)/);
  await page.evaluate(function () { localStorage.clear(); });
  await page.reload({ waitUntil: 'domcontentloaded' });

  const completed = page.waitForFunction(function () {
    const image = document.querySelector('.preview-image.has-photo img');
    return document.querySelector('#exportStatus')?.textContent === '已完成识别，可以继续调整文本和结构。'
      && document.querySelectorAll('.photo-card').length === 1
      && image?.naturalWidth > 0
      && image?.naturalHeight > 0;
  }, null, { timeout: 15_000 }).then(
    function () { return { kind: 'completed' }; },
    function (error) { return { kind: 'timeout', message: error.message }; }
  );

  const fixtureBuffer = readFileSync(fixturePath);
  if (failFirstDecoderRequest) {
    const firstAttemptFile = await uploadFixture(page, fixtureBuffer, fixtureMimeType, fixtureLastModified);
    assert.equal(firstAttemptFile.type, fixtureMimeType);
    await page.waitForFunction(function () {
      return document.querySelector('#exportStatus')?.textContent === '1 张图片读取失败，请重试或转换为 JPG/PNG。';
    }, null, { timeout: 5_000 });
    assert.equal(await page.locator('.photo-card').count(), 0);
  }

  const injectedFile = await uploadFixture(page, fixtureBuffer, fixtureMimeType, fixtureLastModified);
  assert.equal(injectedFile.type, fixtureMimeType);

  const outcome = await Promise.race([completed, firstPageError]);
  const outcomeProbe = await page.evaluate(function () {
    return {
      status: document.querySelector('#exportStatus')?.textContent || '',
      photoCards: document.querySelectorAll('.photo-card').length,
      cspViolations: window.__colorWalkCspViolations || [],
      workerSignals: window.__colorWalkWorkerSignals || [],
    };
  });
  assert.equal(outcome.kind, 'completed', JSON.stringify({ outcome, outcomeProbe, pageErrors, consoleErrors }, null, 2));
  if (usesDefaultFixture) {
    await page.waitForFunction(function () {
      return document.querySelector('#coverTextInput')?.value.includes('2024.01.02');
    }, null, { timeout: 5_000 });
  }
  const probe = await page.evaluate(async function () {
    const image = document.querySelector('.preview-image.has-photo img');
    const sourceResponse = image?.src ? await fetch(image.src) : null;
    return {
      status: document.querySelector('#exportStatus')?.textContent || '',
      photoCards: document.querySelectorAll('.photo-card').length,
      previewImages: document.querySelectorAll('.preview-image.has-photo img').length,
      naturalWidth: image?.naturalWidth || 0,
      naturalHeight: image?.naturalHeight || 0,
      sourcePrefix: String(image?.src || '').slice(0, 32),
      sourceMimeType: sourceResponse?.headers.get('content-type') || '',
      coverText: document.querySelector('#coverTextInput')?.value || '',
      cspViolations: window.__colorWalkCspViolations || [],
      workerSignals: window.__colorWalkWorkerSignals || [],
    };
  });

  assert.equal(outcome.kind, 'completed', JSON.stringify({ outcome, probe, pageErrors }, null, 2));
  assert.equal(probe.photoCards, 1);
  assert.equal(probe.previewImages, 1);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
  assert.deepEqual(probe.cspViolations, []);
  if (failFirstDecoderRequest) {
    assert.equal(probe.workerSignals.length, 1);
    assert.equal(probe.workerSignals[0].type, 'fatal');
  } else {
    assert.deepEqual(probe.workerSignals, []);
  }
  assert.equal(decoderRequests, failFirstDecoderRequest ? 2 : 1);
  assert.match(probe.sourcePrefix, /^(blob:|data:image\/jpeg;base64,)/);
  assert.equal(probe.sourceMimeType, 'image/jpeg');
  assert.ok(probe.naturalWidth > 0);
  assert.ok(probe.naturalHeight > 0);
  if (usesDefaultFixture) {
    assert.equal(probe.naturalWidth, 96);
    assert.equal(probe.naturalHeight, 72);
    assert.match(probe.coverText, /2024\.01\.02/);
  }
  await assertHeicExportKeepsImageCorners(page);

  console.log('PASS HEIC upload regression: the selected image is decoded, rendered, and exported.');
} finally {
  if (browser) await browser.close();
  await closeServer(app);
}

async function assertHeicExportKeepsImageCorners(page) {
  await page.waitForFunction(function () {
    const image = document.querySelector('.movie-photo.has-photo img');
    return image?.naturalWidth > 0 && image?.naturalHeight > 0;
  });
  await page.evaluate(function () {
    return new Promise(function (resolveFrame) {
      requestAnimationFrame(function () { requestAnimationFrame(resolveFrame); });
    });
  });

  const sourceProbe = await page.evaluate(function () {
    const preview = document.querySelector('#previewCanvas').getBoundingClientRect();
    const image = document.querySelector('.movie-photo.has-photo img');
    const imageRect = image.getBoundingClientRect();
    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = image.naturalWidth;
    sourceCanvas.height = image.naturalHeight;
    const context = sourceCanvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const ratios = [
      [0.15, 0.15],
      [0.85, 0.15],
      [0.15, 0.85],
      [0.85, 0.85],
    ];
    return ratios.map(function ([xRatio, yRatio]) {
      return {
        exportX: (imageRect.left - preview.left + imageRect.width * xRatio) / preview.width,
        exportY: (imageRect.top - preview.top + imageRect.height * yRatio) / preview.height,
        source: Array.from(context.getImageData(
          Math.round((sourceCanvas.width - 1) * xRatio),
          Math.round((sourceCanvas.height - 1) * yRatio),
          1,
          1
        ).data.slice(0, 3)),
      };
    });
  });

  await page.click('#exportButton');
  await page.waitForFunction(function () {
    return document.querySelector('#exportStatus')?.textContent === '已导出 PNG。';
  });
  const exported = await page.evaluate(function (points) {
    const canvas = document.querySelector('#exportCanvas');
    const context = canvas.getContext('2d');
    return points.map(function (point) {
      const x = Math.min(canvas.width - 1, Math.max(0, Math.round(point.exportX * canvas.width)));
      const y = Math.min(canvas.height - 1, Math.max(0, Math.round(point.exportY * canvas.height)));
      return Array.from(context.getImageData(x, y, 1, 1).data.slice(0, 3));
    });
  }, sourceProbe);

  sourceProbe.forEach(function (point, index) {
    assert.ok(point.source.every(function (value, channel) {
      return Math.abs(value - exported[index][channel]) <= 24;
    }), 'HEIC export should retain source corner ' + index
      + ': source=' + point.source.join(',')
      + ', exported=' + exported[index].join(','));
  });
}

async function uploadFixture(page, buffer, mimeType, lastModified) {
  await page.evaluate(function () {
    document.querySelector('#heicFixtureInput')?.remove();
    const stagingInput = document.createElement('input');
    stagingInput.id = 'heicFixtureInput';
    stagingInput.type = 'file';
    document.body.append(stagingInput);
  });
  await page.setInputFiles('#heicFixtureInput', {
    name: 'upload.heic',
    mimeType: 'application/octet-stream',
    buffer,
  });
  return page.evaluate(function (options) {
    const stagingInput = document.querySelector('#heicFixtureInput');
    const sourceFile = stagingInput.files[0];
    const file = new File([sourceFile], 'upload.heic', options);
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const targetInput = document.querySelector('#fileInput');
    targetInput.files = transfer.files;
    stagingInput.remove();
    targetInput.dispatchEvent(new Event('change', { bubbles: true }));
    return { name: file.name, type: file.type, size: file.size };
  }, { type: mimeType, lastModified });
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
