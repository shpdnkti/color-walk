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
    await page.addInitScript(function () {
      const createObjectURL = URL.createObjectURL.bind(URL);
      window.__imageCropExportCount = 0;
      URL.createObjectURL = function (blob) {
        window.__imageCropExportCount += 1;
        return createObjectURL(blob);
      };
    });
    await page.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(function () { localStorage.clear(); });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#previewCanvas.layout-movie-poster');
    await page.click('.ratio-preset[data-ratio="3:4"]');
    await page.locator('#ratioInput').evaluate(function (input) {
      input.value = '50';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

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
      return Number(photo?.style.getPropertyValue('--image-fit-height') || 1) < 1;
    }, null, { timeout: 1000 });
    const before = await readCropProbe(page);
    await dragMoviePhoto(page, 96, 0);
    const afterDefaultDrag = await readCropProbe(page);

    assert.equal(before.scale, '1.000');
    assert.ok(
      isFullyVisible(before),
      'wide photo should be fully visible at the default crop, got image/frame bounds ' + JSON.stringify(before)
    );
    assert.equal(
      afterDefaultDrag.translateX,
      before.translateX,
      'default-crop photo should not pan beyond its fully visible fitted bounds'
    );
    assert.ok(
      isFullyVisible(afterDefaultDrag),
      'default-crop photo should remain fully visible after a drag attempt, got ' + JSON.stringify(afterDefaultDrag)
    );

    const verticalStart = await readCropProbe(page);
    await dragMoviePhoto(page, 0, verticalStart.frameHeight * 0.4);
    const bottomAligned = await readCropProbe(page);
    assert.notEqual(
      bottomAligned.translateY,
      verticalStart.translateY,
      '100% crop should let the contained photo move vertically, got ' + JSON.stringify({ verticalStart, bottomAligned })
    );
    assert.ok(
      Math.abs(bottomAligned.imageBottom - bottomAligned.frameBottom) <= 1,
      '100% crop should let the contained photo reach the bottom edge, got ' + JSON.stringify(bottomAligned)
    );
    assert.ok(
      isFullyVisible(bottomAligned),
      'bottom-aligned contained photo should remain fully visible, got ' + JSON.stringify(bottomAligned)
    );

    await page.locator('.photo-crop-controls [data-crop-action="reset"]').click();
    await page.waitForFunction(function () {
      const photo = document.querySelector('.movie-photo.has-photo');
      return photo?.style.getPropertyValue('--image-translate-y').trim() === '0.000000%';
    });

    await setCropScale(page, 50);
    const shrunkenStart = await readCropProbe(page);
    assert.equal(shrunkenStart.scale, '0.500');
    assert.equal(await page.locator('.photo-crop-value').textContent(), '-50%');
    await dragMoviePhoto(page, 0, shrunkenStart.frameHeight * 0.45);
    const shrunkenBottom = await readCropProbe(page);
    assert.ok(
      Math.abs(shrunkenBottom.imageBottom - shrunkenBottom.frameBottom) <= 1,
      'negative crop should let the smaller photo reach the bottom edge, got ' + JSON.stringify(shrunkenBottom)
    );
    assert.ok(
      isFullyVisible(shrunkenBottom),
      'negative-crop photo should remain fully visible while repositioning, got ' + JSON.stringify(shrunkenBottom)
    );

    await page.waitForFunction(function () {
      try {
        const draft = JSON.parse(localStorage.getItem('color-walk-draft'));
        const transform = draft?.photos?.[0]?.transform;
        return transform?.scale === 0.5 && transform.y > 0;
      } catch {
        return false;
      }
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.movie-photo.has-photo img');
    await page.waitForFunction(function () {
      const photo = document.querySelector('.movie-photo.has-photo');
      const image = photo?.querySelector('img');
      if (!photo || !image || photo.style.getPropertyValue('--image-scale').trim() !== '0.500') return false;
      return Math.abs(image.getBoundingClientRect().bottom - photo.getBoundingClientRect().bottom) <= 1;
    });
    const restoredNegativeCrop = await readCropProbe(page);
    assert.ok(
      Math.abs(restoredNegativeCrop.imageBottom - restoredNegativeCrop.frameBottom) <= 1,
      'draft restore should retain negative crop and bottom alignment, got ' + JSON.stringify(restoredNegativeCrop)
    );
    assert.equal(await page.locator('.photo-crop-value').textContent(), '-50%');

    await page.locator('#customColorInput').evaluate(function (input) {
      input.value = '#000000';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const negativeExportPoints = await readPhotoFrameExportPoints(page);
    const negativeDomColors = await exportPhotoPixels(page, negativeExportPoints);
    assert.ok(isNearColor(negativeDomColors[0], [17, 26, 36], 8), 'negative-crop DOM export should retain photo-frame whitespace, got ' + negativeDomColors[0]);
    assert.ok(isNearColor(negativeDomColors[1], [67, 168, 111], 24), 'negative-crop DOM export should retain the bottom-aligned image, got ' + negativeDomColors[1]);

    await page.locator('.photo-crop-controls [data-crop-action="reset"]').click();
    await page.waitForFunction(function () {
      const photo = document.querySelector('.movie-photo.has-photo');
      return photo?.style.getPropertyValue('--image-scale').trim() === '1.000'
        && photo?.style.getPropertyValue('--image-translate-y').trim() === '0.000000%';
    });

    const exportedColors = await exportPhotoPixels(page, [
      { x: 1 / 6, y: 0.75 },
      { x: 1 / 2, y: 0.75 },
      { x: 5 / 6, y: 0.75 },
    ]);
    assert.ok(isNearColor(exportedColors[0], [233, 80, 63], 24), 'export should retain the red left edge, got ' + exportedColors[0]);
    assert.ok(isNearColor(exportedColors[1], [67, 168, 111], 24), 'export should retain the green center, got ' + exportedColors[1]);
    assert.ok(isNearColor(exportedColors[2], [52, 104, 216], 24), 'export should retain the blue right edge, got ' + exportedColors[2]);

    await setCropScale(page, 200);
    const zoomed = await readCropProbe(page);
    await dragMoviePhoto(page, 96, 0);
    const after = await readCropProbe(page);

    assert.equal(zoomed.scale, '2.000');
    assert.equal(after.scale, '2.000');
    assert.ok(
      zoomed.imageWidth > zoomed.frameWidth + 1,
      'user crop adjustment should be able to enlarge the fitted image, got image/frame widths ' + zoomed.imageWidth + '/' + zoomed.frameWidth
    );
    assert.notEqual(
      after.translateX,
      zoomed.translateX,
      'wide photo should be draggable after the user enlarges it'
    );
    assert.ok(
      Math.abs(parseFloat(after.translateX)) > 1,
      'drag should produce a visible horizontal crop offset, got ' + after.translateX
    );

    const adjustedDomColors = await exportPhotoPixels(page, [
      { x: 0.3, y: 0.75 },
      { x: 0.5, y: 0.75 },
    ]);
    assert.ok(isNearColor(adjustedDomColors[0], [233, 80, 63], 24), 'scaled DOM export should preserve normalized drag distance, got ' + adjustedDomColors[0]);
    assert.ok(isNearColor(adjustedDomColors[1], [67, 168, 111], 24), 'scaled DOM export should retain the expected center segment, got ' + adjustedDomColors[1]);

    await page.locator('.photo-crop-controls [data-crop-action="reset"]').click();
    await page.waitForFunction(function () {
      const photo = document.querySelector('.movie-photo.has-photo');
      return photo?.style.getPropertyValue('--image-scale').trim() === '1.000';
    });
    await setCropScale(page, 50);
    const fallbackNegativeStart = await readCropProbe(page);
    await dragMoviePhoto(page, 0, fallbackNegativeStart.frameHeight * 0.45);
    const fallbackNegativePoints = await readPhotoFrameExportPoints(page);
    const negativeFallbackColors = await exportPhotoPixels(page, fallbackNegativePoints, { forceCanvasFallback: true });
    assert.ok(isNearColor(negativeFallbackColors[0], [17, 26, 36], 8), 'negative-crop Canvas fallback should retain photo-frame whitespace, got ' + negativeFallbackColors[0]);
    assert.ok(isNearColor(negativeFallbackColors[1], [67, 168, 111], 24), 'negative-crop Canvas fallback should retain the bottom-aligned image, got ' + negativeFallbackColors[1]);

    await page.locator('.photo-crop-controls [data-crop-action="reset"]').click();
    await page.waitForFunction(function () {
      const photo = document.querySelector('.movie-photo.has-photo');
      return photo?.style.getPropertyValue('--image-scale').trim() === '1.000';
    });

    await setCropScale(page, 400);
    assert.equal(await page.locator('[data-crop-action="zoom-in"]').isDisabled(), true);
    await page.locator('#customColorInput').evaluate(function (input) {
      input.value = '#000000';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const adjustedFallbackColors = await exportPhotoPixels(page, [
      { x: 0.5, y: 0.4 },
      { x: 0.5, y: 0.75 },
    ], { forceCanvasFallback: true });
    assert.ok(isNearColor(adjustedFallbackColors[0], [0, 0, 0], 8), 'fallback export should clip the enlarged photo at the photo frame, got ' + adjustedFallbackColors[0]);
    assert.ok(isNearColor(adjustedFallbackColors[1], [67, 168, 111], 24), 'fallback export should retain the adjusted photo inside its frame, got ' + adjustedFallbackColors[1]);

    await dragMoviePhoto(page, 0, 96);
    await page.locator('#ratioInput').evaluate(function (input) {
      input.value = '35';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForFunction(function () {
      const photo = document.querySelector('.movie-photo.has-photo');
      return Number(photo?.style.getPropertyValue('--image-fit-height')) < 0.4;
    });
    const reframedFallbackColor = await exportPhotoPixels(page, [
      { x: 0.5, y: 0.37 },
    ]);
    assert.ok(isNearColor(reframedFallbackColor[0], [67, 168, 111], 24), 'fallback export should re-clamp a persisted offset after the photo frame ratio changes, got ' + reframedFallbackColor[0]);

    console.log('PASS image crop regression: wide photo starts fully visible and remains user-adjustable.');
  }
} finally {
  if (browser) await browser.close();
  await closeServer(app);
}

async function uploadGeneratedWidePhoto(page) {
  const buffer = await page.evaluate(async function () {
    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 160;
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

async function setCropScale(page, percent) {
  await page.locator('.photo-crop-slider').evaluate(function (slider, value) {
    slider.value = String(value - 100);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  }, percent);
  await page.waitForFunction(function (expectedScale) {
    const photo = document.querySelector('.movie-photo.has-photo');
    return photo?.style.getPropertyValue('--image-scale').trim() === expectedScale;
  }, (percent / 100).toFixed(3), { timeout: 2000 });
  await page.waitForFunction(function (expectedScale) {
    const photo = document.querySelector('.movie-photo.has-photo');
    const image = photo?.querySelector('img');
    if (!photo || !image) return false;
    const fitWidth = Number(photo.style.getPropertyValue('--image-fit-width')) || 1;
    const expectedWidth = photo.getBoundingClientRect().width * fitWidth * expectedScale;
    return Math.abs(image.getBoundingClientRect().width - expectedWidth) <= 1;
  }, percent / 100, { timeout: 2000 });
}

async function exportPhotoPixels(page, points, { forceCanvasFallback = false } = {}) {
  if (forceCanvasFallback) {
    await page.evaluate(function () {
      Object.defineProperty(window, 'XMLSerializer', {
        configurable: true,
        value: class BrokenXmlSerializer {
          serializeToString() {
            throw new Error('force_canvas_export_fallback');
          }
        },
      });
    });
  }
  const previousExportCount = await page.evaluate(function () {
    return window.__imageCropExportCount;
  });
  await page.click('#exportButton');
  await page.waitForFunction(function (previousCount) {
    return window.__imageCropExportCount > previousCount;
  }, previousExportCount);
  return page.evaluate(function (samplePoints) {
    const canvas = document.querySelector('#exportCanvas');
    const ctx = canvas.getContext('2d');
    return samplePoints.map(function (point) {
      const x = Math.round(canvas.width * point.x);
      const y = Math.round(canvas.height * point.y);
      return Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3));
    });
  }, points);
}

async function readPhotoFrameExportPoints(page) {
  return page.evaluate(function () {
    const canvas = document.querySelector('#previewCanvas');
    const photo = document.querySelector('.movie-photo.has-photo');
    const canvasRect = canvas.getBoundingClientRect();
    const frameRect = photo.getBoundingClientRect();
    const x = (frameRect.left + frameRect.width / 2 - canvasRect.left) / canvasRect.width;
    return [
      { x, y: (frameRect.top + frameRect.height * 0.1 - canvasRect.top) / canvasRect.height },
      { x, y: (frameRect.bottom - frameRect.height * 0.1 - canvasRect.top) / canvasRect.height },
    ];
  });
}

async function readCropProbe(page) {
  return page.evaluate(function () {
    const photo = document.querySelector('.movie-photo.has-photo');
    const image = photo.querySelector('img');
    const frameRect = photo.getBoundingClientRect();
    const imageRect = image.getBoundingClientRect();
    return {
      scale: photo.style.getPropertyValue('--image-scale').trim(),
      translateX: photo.style.getPropertyValue('--image-translate-x').trim(),
      translateY: photo.style.getPropertyValue('--image-translate-y').trim(),
      frameLeft: frameRect.left,
      frameTop: frameRect.top,
      frameRight: frameRect.right,
      frameBottom: frameRect.bottom,
      frameWidth: frameRect.width,
      frameHeight: frameRect.height,
      imageLeft: imageRect.left,
      imageTop: imageRect.top,
      imageRight: imageRect.right,
      imageBottom: imageRect.bottom,
      imageWidth: imageRect.width,
      imageHeight: imageRect.height,
    };
  });
}

function isFullyVisible(probe) {
  const tolerance = 1;
  return probe.imageLeft >= probe.frameLeft - tolerance
    && probe.imageTop >= probe.frameTop - tolerance
    && probe.imageRight <= probe.frameRight + tolerance
    && probe.imageBottom <= probe.frameBottom + tolerance;
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
