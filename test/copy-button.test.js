import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

import { createColorWalkServer } from '../server.js';

test('copy panel keeps cover text directly editable without a separate copy button', async (t) => {
  const { page, url } = await openApp(t);

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const probe = await page.evaluate(function () {
    const textarea = document.querySelector('#coverTextInput');
    textarea.value = 'Direct editable cover text';
    textarea.focus();
    textarea.select();
    return {
      hasCopyButton: Boolean(document.querySelector('#copyTextButton')),
      selectedText: textarea.value.slice(textarea.selectionStart, textarea.selectionEnd),
      activeId: document.activeElement?.id,
    };
  });

  assert.equal(probe.hasCopyButton, false);
  assert.equal(probe.selectedText, 'Direct editable cover text');
  assert.equal(probe.activeId, 'coverTextInput');
});

test('web API failures show the request ID in the visible status', async (t) => {
  const { page, url } = await openApp(t);
  await page.route('**/api/analyze-image', function (route) {
    return route.fulfill({
      status: 503,
      contentType: 'application/json',
      headers: { 'X-Request-ID': 'web-request-42' },
      body: JSON.stringify({ error: 'openai_request_failed' }),
    });
  });

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const uploadSettled = page.evaluate(function () {
    return new Promise(function (resolve) {
      window.addEventListener('color-walk:upload-settled', resolve, { once: true });
    });
  });
  const png = await createPng(page);
  await page.setInputFiles('#fileInput', {
    name: 'sample.png',
    mimeType: 'image/png',
    buffer: png,
  });
  await uploadSettled;
  assert.equal(await page.locator('#photoCount').textContent(), '1 张');
  await page.locator('#copyGenerateButton').evaluate(function (button) { button.click(); });
  await page.waitForFunction(function () {
    return document.querySelector('#exportStatus')?.textContent.includes('web-request-42');
  });

  assert.match(await page.locator('#exportStatus').textContent(), /请求编号：web-request-42/);
});

async function openApp(t) {
  const app = createColorWalkServer();
  const port = await listenOnLocalhost(app);
  const browser = await chromium.launch();
  t.after(async function () {
    await browser.close();
    await closeServer(app);
  });

  const page = await browser.newPage();
  return { page, url: 'http://127.0.0.1:' + port + '/' };
}

async function createPng(page) {
  const bytes = await page.evaluate(async function () {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    const context = canvas.getContext('2d');
    context.fillStyle = '#336699';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const blob = await new Promise(function (resolve) { canvas.toBlob(resolve, 'image/png'); });
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  return Buffer.from(bytes);
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
