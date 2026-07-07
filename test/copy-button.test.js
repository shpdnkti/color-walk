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

async function openApp(t) {
  const app = createColorWalkServer();
  const port = await listenOnLocalhost(app);
  t.after(async function () { await closeServer(app); });

  const browser = await chromium.launch();
  t.after(async function () { await browser.close(); });

  const page = await browser.newPage();
  return { page, url: 'http://127.0.0.1:' + port + '/' };
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
