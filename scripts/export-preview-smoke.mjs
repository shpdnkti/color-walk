import assert from 'node:assert/strict';

import { createColorWalkServer } from '../server.js';

const RUN_FLAG = 'COLOR_WALK_RUN_EXPORT_PREVIEW_SMOKE';

if (process.env[RUN_FLAG] !== '1') {
  console.log('SKIP export/preview smoke: set ' + RUN_FLAG + '=1 to run the browser check.');
  process.exit(0);
}

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch (error) {
  console.log('SKIP export/preview smoke: Playwright package is not installed.');
  process.exit(0);
}

const app = createColorWalkServer();
const port = await listenOnLocalhost(app);
let browser;

try {
  try {
    browser = await chromium.launch();
  } catch (error) {
    if (isMissingBrowserError(error)) {
      console.log('SKIP export/preview smoke: Playwright browser binaries are not installed.');
      process.exitCode = 0;
    } else {
      throw error;
    }
  }

  if (browser) {
    const page = await browser.newPage({ viewport: { width: 1024, height: 900 }, deviceScaleFactor: 1 });
  await page.addInitScript(function () {
    const originalCreateObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = function (blob) {
      window.__lastExportBlob = blob;
      return originalCreateObjectURL(blob);
    };
  });

  await page.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(function () { localStorage.clear(); });
  await page.reload({ waitUntil: 'domcontentloaded' });

  await uploadGeneratedPhoto(page);
  await page.waitForFunction(function () {
    return document.querySelector('#exportStatus')?.textContent === '已完成识别，可以继续调整文本和结构。';
  });

  await page.evaluate(function () {
    const colorInput = document.querySelector('#customColorInput');
    colorInput.value = '#336699';
    colorInput.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#titleInput').value = 'Export Preview Smoke';
    document.querySelector('#titleInput').dispatchEvent(new Event('input', { bubbles: true }));
  });

  const preview = await readPreviewProbe(page);
  await page.click('#exportButton');
  await page.waitForFunction(function () {
    return document.querySelector('#exportStatus')?.textContent === '已导出 PNG。' && window.__lastExportBlob;
  });

  const exported = await readExportProbe(page, preview);
  if (process.env.COLOR_WALK_EXPORT_PREVIEW_DEBUG === '1') {
    console.log(JSON.stringify({ preview, exported }, null, 2));
  }

  assert.equal(exported.blobType, 'image/png');
  assert.ok(exported.blobSize > 1000, 'exported PNG blob should contain rendered image data');
  assert.equal(exported.width, 1080);
  assert.equal(exported.height, Math.round(1080 * (preview.rect.height / preview.rect.width)));
  assert.equal(exported.cssPreviewColor, 'rgb(51, 102, 153)');
  assert.ok(exported.previewHasPhoto, 'preview should render the generated photo');
  assert.ok(
    isNearColor(exported.colorPixel, [51, 102, 153], 8),
    'export color block should match preview color, got ' + exported.colorPixel.join(',')
  );
  assert.ok(
    isNearColor(exported.photoPixel, [238, 96, 64], 24),
    'export photo region should match generated photo, got ' + exported.photoPixel.join(',')
  );

    console.log('PASS export/preview smoke: PNG dimensions, color block, and photo region match preview probes.');
  }
} finally {
  if (browser) await browser.close();
  await closeServer(app);
}

async function uploadGeneratedPhoto(page) {
  const buffer = await page.evaluate(async function () {
    const canvas = document.createElement('canvas');
    canvas.width = 90;
    canvas.height = 120;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ee6040';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#2b6f79';
    ctx.fillRect(12, 18, 24, 30);
    const blob = await new Promise(function (resolve) { canvas.toBlob(resolve, 'image/png'); });
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });

  await page.setInputFiles('#fileInput', {
    name: 'export-preview-smoke.png',
    mimeType: 'image/png',
    buffer: Buffer.from(buffer),
  });
}

async function readPreviewProbe(page) {
  return page.evaluate(function () {
    const previewCanvas = document.querySelector('#previewCanvas');
    const colorCard = document.querySelector('.movie-color-card');
    const photo = document.querySelector('.movie-photo');
    const rect = previewCanvas.getBoundingClientRect();
    const colorRect = colorCard.getBoundingClientRect();
    const photoRect = photo.getBoundingClientRect();
    return {
      rect: { width: rect.width, height: rect.height },
      colorSample: {
        x: (colorRect.left - rect.left + colorRect.width * 0.12) / rect.width,
        y: (colorRect.top - rect.top + colorRect.height * 0.18) / rect.height,
      },
      photoCenter: {
        x: (photoRect.left - rect.left + photoRect.width / 2) / rect.width,
        y: (photoRect.top - rect.top + photoRect.height / 2) / rect.height,
      },
    };
  });
}

async function readExportProbe(page, preview) {
  return page.evaluate(function (previewProbe) {
    const canvas = document.querySelector('#exportCanvas');
    const ctx = canvas.getContext('2d');
    function pixelAt(point) {
      const x = Math.min(canvas.width - 1, Math.max(0, Math.round(point.x * canvas.width)));
      const y = Math.min(canvas.height - 1, Math.max(0, Math.round(point.y * canvas.height)));
      return Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3));
    }
    return {
      blobType: window.__lastExportBlob?.type,
      blobSize: window.__lastExportBlob?.size || 0,
      width: canvas.width,
      height: canvas.height,
      cssPreviewColor: getComputedStyle(document.querySelector('.movie-color-card')).backgroundColor,
      previewHasPhoto: Boolean(document.querySelector('.movie-photo img')),
      colorPixel: pixelAt(previewProbe.colorSample),
      photoPixel: pixelAt(previewProbe.photoCenter),
    };
  }, preview);
}

function isNearColor(actual, expected, tolerance) {
  return actual.every(function (channel, index) {
    return Math.abs(channel - expected[index]) <= tolerance;
  });
}

function isMissingBrowserError(error) {
  return /Executable doesn't exist|browserType\.launch|playwright install/i.test(String(error?.message || error));
}

function listenOnLocalhost(server) {
  return new Promise(function (resolve, reject) {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', function () {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
}

function closeServer(server) {
  return new Promise(function (resolve, reject) {
    server.close(function (error) {
      if (error) reject(error);
      else resolve();
    });
  });
}
