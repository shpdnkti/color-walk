import http from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';

import { createColorWalkServer } from '../server.js';

test('serves the pinned HEIC browser decoder module', async (t) => {
  const app = createColorWalkServer();
  const appPort = await listenOnLocalhost(app);
  t.after(async function () { await closeServer(app); });

  const response = await fetch('http://127.0.0.1:' + appPort + '/vendor/heic-to/heic-to.js', { method: 'HEAD' });

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /text\/javascript/);
  assert.ok(Number(response.headers.get('content-length')) > 1_000_000);
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
