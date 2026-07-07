import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

import { createColorWalkServer } from '../server.js';

test('falls back to execCommand when Clipboard API copy fails', async (t) => {
  const { page, url } = await openApp(t, function () {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText(text) {
          window.__primaryClipboardText = text;
          return Promise.reject(new Error('clipboard blocked'));
        },
      },
    });
    document.execCommand = function (command) {
      window.__fallbackCommand = command;
      window.__fallbackClipboardText = document.activeElement?.value || '';
      return command === 'copy';
    };
  });

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await fillCopyFields(page);
  await clickCopyButton(page);
  await page.waitForFunction(function () {
    return document.querySelector('#exportStatus')?.textContent === '文案已复制。';
  });

  const result = await readCopyProbe(page);
  assert.equal(result.primaryText, expectedCopyText());
  assert.equal(result.fallbackCommand, 'copy');
  assert.equal(result.fallbackText, expectedCopyText());
  assert.equal(result.status, '文案已复制。');
});

test('reports failure when Clipboard API and execCommand copy both fail', async (t) => {
  const { page, url } = await openApp(t, function () {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText(text) {
          window.__primaryClipboardText = text;
          return Promise.reject(new Error('clipboard blocked'));
        },
      },
    });
    document.execCommand = function (command) {
      window.__fallbackCommand = command;
      window.__fallbackClipboardText = document.activeElement?.value || '';
      return false;
    };
  });

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await fillCopyFields(page);
  await clickCopyButton(page);
  await page.waitForFunction(function () {
    return document.querySelector('#exportStatus')?.textContent === '复制失败，请手动选择文本复制。';
  });

  const result = await readCopyProbe(page);
  assert.equal(result.primaryText, expectedCopyText());
  assert.equal(result.fallbackCommand, 'copy');
  assert.equal(result.fallbackText, expectedCopyText());
  assert.equal(result.status, '复制失败，请手动选择文本复制。');
});

async function openApp(t, setupClipboardProbe) {
  const app = createColorWalkServer();
  const port = await listenOnLocalhost(app);
  t.after(async function () { await closeServer(app); });

  const browser = await chromium.launch();
  t.after(async function () { await browser.close(); });

  const page = await browser.newPage();
  await page.addInitScript(setupClipboardProbe);

  return { page, url: 'http://127.0.0.1:' + port + '/' };
}

async function fillCopyFields(page) {
  await page.evaluate(function (text) {
    document.querySelector('#coverTextInput').value = text;
  }, expectedCopyText());
}

async function clickCopyButton(page) {
  await page.evaluate(function () {
    document.querySelector('#copyTextButton').click();
  });
}

function expectedCopyText() {
  return 'Fallback cover text\n#ColorWalk #Fallback';
}

async function readCopyProbe(page) {
  return page.evaluate(function () {
    return {
      primaryText: window.__primaryClipboardText,
      fallbackCommand: window.__fallbackCommand,
      fallbackText: window.__fallbackClipboardText,
      status: document.querySelector('#exportStatus')?.textContent,
    };
  });
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
