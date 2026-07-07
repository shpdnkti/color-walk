import assert from 'node:assert/strict';

import { createColorWalkServer } from '../server.js';

const RUN_FLAG = 'COLOR_WALK_RUN_IMAGE_CROP_DRAG';

if (process.env[RUN_FLAG] !== '1') {
  console.log('SKIP image crop drag regression: set ' + RUN_FLAG + '=1 to run the browser check.');
  process.exit(0);
}

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch (error) {
  console.log('SKIP image crop drag regression: Playwright package is not installed.');
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
      console.log('SKIP image crop drag regression: Playwright browser binaries are not installed.');
      process.exitCode = 0;
    } else {
      throw error;
    }
  }

  if (browser) {
    const page = await browser.newPage({ viewport: { width: 1024, height: 900 }, deviceScaleFactor: 1 });
    await page.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(function () { localStorage.clear(); });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#previewCanvas.layout-movie-poster');

    await uploadGeneratedWidePhoto(page);
    await page.waitForFunction(function () {
      return document.querySelector('#exportStatus')?.textContent === '已完成识别，可以继续调整文本和结构。';
    });

    await page.click('#zoomLevelButton');
    await page.waitForFunction(function () {
      return document.querySelector('#zoomLevelButton')?.textContent === '100%';
    });
    await page.waitForSelector('.movie-photo.has-photo img');
    await page.waitForFunction(function () {
      const photo = document.querySelector('.movie-photo.has-photo');
      return Number(photo?.style.getPropertyValue('--image-cover-width') || 1) > 1;
    }, null, { timeout: 1000 });

    const before = await readCropProbe(page);
    await dragMoviePhoto(page, 96, 0);
    const after = await readCropProbe(page);

    assert.equal(before.scale, '1.000');
    assert.equal(after.scale, '1.000');
    assert.ok(
      before.imageWidth > before.frameWidth + 1,
      'wide photo should render as an oversized cover image at 100%, got image/frame widths ' + before.imageWidth + '/' + before.frameWidth
    );
    assert.notEqual(
      after.translateX,
      before.translateX,
      'wide photo should be draggable at 100% crop scale when cover-cropped by the canvas ratio'
    );
    assert.ok(
      Math.abs(parseFloat(after.translateX)) > 1,
      'drag should produce a visible horizontal crop offset, got ' + after.translateX
    );

    console.log('PASS image crop drag regression: wide photo can be dragged at 100% crop scale.');
  }
} finally {
  if (browser) await browser.close();
  await closeServer(app);
}

async function uploadGeneratedWidePhoto(page) {
  const buffer = await page.evaluate(async function () {
    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 80;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#e9503f';
    ctx.fillRect(0, 0, 160, canvas.height);
    ctx.fillStyle = '#43a86f';
    ctx.fillRect(160, 0, 160, canvas.height);
    ctx.fillStyle = '#3468d8';
    ctx.fillRect(320, 0, 160, canvas.height);
    const blob = await new Promise(function (resolve) { canvas.toBlob(resolve, 'image/png'); });
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });

  await page.setInputFiles('#fileInput', {
    name: 'wide-crop-drag.png',
    mimeType: 'image/png',
    buffer: Buffer.from(buffer),
  });
}

async function dragMoviePhoto(page, deltaX, deltaY) {
  const point = await page.evaluate(function () {
    const photo = document.querySelector('.movie-photo.has-photo');
    const rect = photo.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  });
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + deltaX, point.y + deltaY, { steps: 6 });
  await page.mouse.up();
}

async function readCropProbe(page) {
  return page.evaluate(function () {
    const photo = document.querySelector('.movie-photo.has-photo');
    const image = photo.querySelector('img');
    return {
      scale: photo.style.getPropertyValue('--image-scale').trim(),
      translateX: photo.style.getPropertyValue('--image-translate-x').trim(),
      translateY: photo.style.getPropertyValue('--image-translate-y').trim(),
      frameWidth: photo.getBoundingClientRect().width,
      imageWidth: image.getBoundingClientRect().width,
    };
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
