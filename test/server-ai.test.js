import http from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';

import { chromium } from 'playwright';

import { createColorWalkServer } from '../server.js';

const runHeicBrowserTests = process.env.COLOR_WALK_RUN_HEIC_BROWSER === '1';

test('serves the pinned strict-CSP HEIC browser decoder module', async (t) => {
  const app = createColorWalkServer();
  const appPort = await listenOnLocalhost(app);
  t.after(async function () { await closeServer(app); });

  const response = await fetch('http://127.0.0.1:' + appPort + '/vendor/libheif/libheif-bundle.mjs');
  const source = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /text\/javascript/);
  assert.ok(source.length > 1_000_000);
  assert.match(source, /WebAssembly/);
  assert.doesNotMatch(source, /\beval\s*\(|new Function\s*\(/);
  assert.equal(response.headers.get('cache-control'), 'no-cache');
  assert.match(response.headers.get('content-security-policy') || '', /script-src 'self' 'wasm-unsafe-eval'/);
  assert.doesNotMatch(response.headers.get('content-security-policy') || '', /(?:^|\s)'unsafe-eval'(?:\s|;|$)/);

  const retiredResponse = await fetch('http://127.0.0.1:' + appPort + '/vendor/heic-to/heic-to.js');
  assert.equal(retiredResponse.status, 404);
});

test('HEIC decoder worker warms before readiness and isolates serial decode failures', { skip: !runHeicBrowserTests }, async (t) => {
  const app = createColorWalkServer();
  const appPort = await listenOnLocalhost(app);
  t.after(async function () { await closeServer(app); });

  const browser = await chromium.launch();
  t.after(async function () { await browser.close(); });

  const page = await browser.newPage();
  const decoderRequests = [];
  await page.route('**/vendor/libheif/libheif-bundle.mjs*', async function (route) {
    decoderRequests.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body: [
        'let active = false;',
        'let warmed = false;',
        'class FakeImage {',
        '  constructor(name) { this.name = name; }',
        '  is_primary() { return true; }',
        '  get_width() { return 1; }',
        '  get_height() { return 1; }',
        '  display(imageData, callback) {',
        '    active = true;',
        "    const delay = this.name === 'slow' || this.name === 'warmup' ? 50 : 0;",
        '    setTimeout(() => {',
        '      active = false;',
        "      if (this.name === 'warmup') warmed = true;",
        '      imageData.data.set([120, 80, 40, 255]);',
        '      callback(imageData);',
        '    }, delay);',
        '  }',
        '  free() {}',
        '}',
        'class HeifDecoder {',
        '  decode(buffer) {',
        "    if (active) throw new Error('decode overlap');",
        "    const name = buffer.length > 20 ? 'warmup' : new TextDecoder().decode(buffer);",
        "    if (name !== 'warmup' && !warmed) throw new Error('decoder used before warmup');",
        "    if (name === 'broken') throw new Error('broken fixture');",
        '    return [new FakeImage(name)];',
        '  }',
        '}',
        'export default async function () { return { HeifDecoder }; }',
      ].join('\n'),
    });
  });
  await page.goto('http://127.0.0.1:' + appPort + '/', { waitUntil: 'domcontentloaded' });

  const probe = await page.evaluate(function () {
    return new Promise(function (resolve, reject) {
      const worker = new Worker('/src/heic-decoder-worker.js?retry=worker-test', { type: 'module' });
      const results = [];
      const timeout = setTimeout(function () {
        worker.terminate();
        reject(new Error('decoder worker timed out'));
      }, 5_000);

      worker.onerror = function (event) {
        clearTimeout(timeout);
        worker.terminate();
        reject(new Error(event.message || 'decoder worker failed'));
      };
      worker.onmessage = async function (event) {
        const message = event.data || {};
        if (message.type === 'fatal') {
          clearTimeout(timeout);
          worker.terminate();
          reject(new Error(message.message || 'decoder module failed'));
          return;
        }
        if (message.type === 'ready') {
          worker.postMessage({ type: 'decode', id: 'slow', file: new File(['slow'], 'slow.heic') });
          worker.postMessage({ type: 'decode', id: 'broken', file: new File(['broken'], 'broken.heic') });
          worker.postMessage({ type: 'decode', id: 'after-error', file: new File(['after'], 'after.heic') });
          return;
        }

        if (message.type === 'dominant-color') return;
        results.push(message);
        if (results.length !== 3) return;
        clearTimeout(timeout);
        worker.terminate();
        resolve(await Promise.all(results.map(async function (result) {
          return {
            type: result.type,
            id: result.id,
            message: result.message || '',
            blobType: result.blob?.type || '',
          };
        })));
      };
    });
  });

  assert.deepEqual(probe, [
    { type: 'decoded', id: 'slow', message: '', blobType: 'image/jpeg' },
    { type: 'decode-error', id: 'broken', message: 'broken fixture', blobType: '' },
    { type: 'decoded', id: 'after-error', message: '', blobType: 'image/jpeg' },
  ]);
  assert.equal(decoderRequests.length, 1);
  const decoderUrl = new URL(decoderRequests[0]);
  assert.equal(decoderUrl.pathname, '/vendor/libheif/libheif-bundle.mjs');
  assert.equal(decoderUrl.search, '');
});

test('HEIC decoder worker reports decoder module load failures as fatal messages', { skip: !runHeicBrowserTests }, async (t) => {
  const app = createColorWalkServer();
  const appPort = await listenOnLocalhost(app);
  t.after(async function () { await closeServer(app); });

  const browser = await chromium.launch();
  t.after(async function () { await browser.close(); });

  const page = await browser.newPage();
  await page.route('**/vendor/libheif/libheif-bundle.mjs*', function (route) {
    return route.fulfill({ status: 503, contentType: 'text/plain', body: 'decoder unavailable' });
  });
  await page.goto('http://127.0.0.1:' + appPort + '/', { waitUntil: 'domcontentloaded' });

  const message = await page.evaluate(function () {
    return new Promise(function (resolve, reject) {
      const worker = new Worker('/src/heic-decoder-worker.js?retry=fatal-test', { type: 'module' });
      const timeout = setTimeout(function () {
        worker.terminate();
        reject(new Error('decoder worker timed out'));
      }, 5_000);
      worker.onerror = function (event) {
        clearTimeout(timeout);
        worker.terminate();
        reject(new Error(event.message || 'decoder worker failed'));
      };
      worker.onmessage = function (event) {
        clearTimeout(timeout);
        worker.terminate();
        resolve(event.data);
      };
    });
  });

  assert.equal(message.type, 'fatal');
  assert.match(message.message, /module|fetch|import|503/i);
});

test('HEIC decoder worker reports warmup failures as fatal messages', { skip: !runHeicBrowserTests }, async (t) => {
  const app = createColorWalkServer();
  const appPort = await listenOnLocalhost(app);
  t.after(async function () { await closeServer(app); });

  const browser = await chromium.launch();
  t.after(async function () { await browser.close(); });

  const page = await browser.newPage();
  await page.route('**/vendor/libheif/libheif-bundle.mjs*', function (route) {
    return route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body: "export default async function () { return { HeifDecoder: class { decode() { throw new Error('warmup failed'); } } }; }",
    });
  });
  await page.goto('http://127.0.0.1:' + appPort + '/', { waitUntil: 'domcontentloaded' });

  const message = await page.evaluate(function () {
    return new Promise(function (resolve, reject) {
      const worker = new Worker('/src/heic-decoder-worker.js?retry=warmup-fatal-test', { type: 'module' });
      const timeout = setTimeout(function () {
        worker.terminate();
        reject(new Error('decoder worker timed out'));
      }, 5_000);
      worker.onerror = function (event) {
        clearTimeout(timeout);
        worker.terminate();
        reject(new Error(event.message || 'decoder worker failed'));
      };
      worker.onmessage = function (event) {
        clearTimeout(timeout);
        worker.terminate();
        resolve(event.data);
      };
    });
  });

  assert.equal(message.type, 'fatal');
  assert.match(message.message, /warmup failed/);
});

test('analyze-image proxies photos to configured Responses API and returns parsed insight', async (t) => {
  const upstreamRequests = [];
  const upstream = http.createServer(async function (request, response) {
    const rawBody = await readRequestBody(request);
    upstreamRequests.push({
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization,
      contentType: request.headers['content-type'],
      body: JSON.parse(rawBody),
    });

    sendJson(response, 200, {
      output_text: JSON.stringify({
        keywords: ['咖啡', '街景', '木质桌面'],
        subjects: ['咖啡', '街景'],
        scene: '街角咖啡店',
        mood: '松弛',
        description: '照片里有咖啡杯、街景和温暖的店内光线。',
        tags: ['#咖啡', '#街景', '#ColorWalk'],
      }),
    });
  });
  const upstreamPort = await listenOnLocalhost(upstream);
  t.after(async function () { await closeServer(upstream); });

  const originalEnv = captureOpenAIEnv();
  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.OPENAI_BASE_URL = 'http://127.0.0.1:' + upstreamPort + '/v1';
  process.env.OPENAI_VISION_MODEL = 'gpt-test-vision';
  process.env.OPENAI_REQUEST_TIMEOUT_MS = '5000';
  t.after(function () { restoreOpenAIEnv(originalEnv); });

  const app = createColorWalkServer();
  const appPort = await listenOnLocalhost(app);
  t.after(async function () { await closeServer(app); });

  const response = await fetch('http://127.0.0.1:' + appPort + '/api/analyze-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      images: [
        { dataUrl: 'data:image/png;base64,aGVsbG8=', fileName: 'coffee.png' },
      ],
      context: {
        place: '上海武康路',
        date: '2026-07-06',
        keywords: '咖啡, 街景',
      },
    }),
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.model, 'gpt-test-vision');
  assert.deepEqual(payload.insight.subjects, ['咖啡', '街景']);
  assert.equal(payload.insight.scene, '街角咖啡店');
  assert.deepEqual(payload.insight.tags, ['#咖啡', '#街景', '#ColorWalk']);

  assert.equal(upstreamRequests.length, 1);
  assert.equal(upstreamRequests[0].method, 'POST');
  assert.equal(upstreamRequests[0].url, '/v1/responses');
  assert.equal(upstreamRequests[0].authorization, 'Bearer test-openai-key');
  assert.equal(upstreamRequests[0].body.model, 'gpt-test-vision');
  assert.match(upstreamRequests[0].body.input[0].content[0].text, /上海武康路/);
  assert.equal(upstreamRequests[0].body.input[0].content[1].type, 'input_image');
  assert.equal(upstreamRequests[0].body.input[0].content[1].image_url, 'data:image/png;base64,aGVsbG8=');
});

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

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  response.end(body);
}

function captureOpenAIEnv() {
  return {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    OPENAI_VISION_MODEL: process.env.OPENAI_VISION_MODEL,
    OPENAI_REQUEST_TIMEOUT_MS: process.env.OPENAI_REQUEST_TIMEOUT_MS,
  };
}

function restoreOpenAIEnv(env) {
  Object.keys(env).forEach(function (key) {
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  });
}
