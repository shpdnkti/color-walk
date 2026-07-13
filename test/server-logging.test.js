import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { createColorWalkServer } from '../server.js';

test('API failures return a request ID and emit one structured error log', async (t) => {
  const originalApiKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  t.after(function () {
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
  });

  const errorLines = [];
  const originalConsoleError = console.error;
  console.error = function (line) { errorLines.push(line); };
  t.after(function () { console.error = originalConsoleError; });

  const app = createColorWalkServer();
  const port = await listenOnLocalhost(app);
  t.after(async function () { await closeServer(app); });

  const response = await fetch('http://127.0.0.1:' + port + '/api/analyze-image', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Request-ID': 'diagnostic-request-42',
    },
    body: JSON.stringify({ secret: 'must-not-be-logged' }),
  });
  await response.json();

  assert.equal(response.status, 503);
  assert.equal(response.headers.get('x-request-id'), 'diagnostic-request-42');
  assert.equal(errorLines.length, 1);

  const entry = JSON.parse(errorLines[0]);
  assert.equal(entry.level, 'error');
  assert.equal(entry.event, 'request_completed');
  assert.equal(entry.requestId, 'diagnostic-request-42');
  assert.equal(entry.method, 'POST');
  assert.equal(entry.route, '/api/analyze-image');
  assert.equal(entry.status, 503);
  assert.equal(entry.errorCode, 'openai_api_key_missing');
  assert.match(entry.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(typeof entry.durationMs, 'number');
  assert.doesNotMatch(errorLines[0], /must-not-be-logged/);
});

test('successful API requests log upstream timing without request content', async (t) => {
  const upstream = await startJsonServer(t, 200, {
    output_text: JSON.stringify({
      keywords: ['咖啡'],
      subjects: ['咖啡杯'],
      scene: '咖啡店',
      mood: '安静',
      description: '桌上有一杯咖啡。',
      tags: ['咖啡'],
    }),
  });
  const originalEnv = captureOpenAIEnv();
  process.env.OPENAI_API_KEY = 'test-key';
  process.env.OPENAI_BASE_URL = upstream.url + '/v1';
  t.after(function () { restoreOpenAIEnv(originalEnv); });

  const infoLines = [];
  const originalConsoleLog = console.log;
  console.log = function (line) { infoLines.push(line); };
  t.after(function () { console.log = originalConsoleLog; });

  const app = createColorWalkServer();
  const port = await listenOnLocalhost(app);
  t.after(async function () { await closeServer(app); });

  const response = await fetch('http://127.0.0.1:' + port + '/api/analyze-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      images: [{ dataUrl: 'data:image/png;base64,aGVsbG8=', fileName: 'private-photo.png' }],
      context: { place: 'private-place' },
    }),
  });
  await response.json();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('x-request-id') || '', /^[0-9a-f-]{36}$/);
  assert.equal(infoLines.length, 1);

  const entry = JSON.parse(infoLines[0]);
  assert.equal(entry.level, 'info');
  assert.equal(entry.status, 200);
  assert.deepEqual(Object.keys(entry.upstream).sort(), ['durationMs', 'service', 'status']);
  assert.equal(entry.upstream.service, 'openai');
  assert.equal(entry.upstream.status, 200);
  assert.equal(typeof entry.upstream.durationMs, 'number');
  assert.doesNotMatch(infoLines[0], /private-photo|private-place|aGVsbG8/);
});

test('reverse geocoding logs Nominatim timing without coordinates', async (t) => {
  const upstream = await startJsonServer(t, 200, {
    display_name: '测试地点',
    address: { city: '测试市' },
  });
  const originalReverseUrl = process.env.GEOCODE_REVERSE_URL;
  process.env.GEOCODE_REVERSE_URL = upstream.url + '/reverse';
  t.after(function () {
    if (originalReverseUrl === undefined) delete process.env.GEOCODE_REVERSE_URL;
    else process.env.GEOCODE_REVERSE_URL = originalReverseUrl;
  });

  const infoLines = [];
  const originalConsoleLog = console.log;
  console.log = function (line) { infoLines.push(line); };
  t.after(function () { console.log = originalConsoleLog; });

  const app = createColorWalkServer();
  const port = await listenOnLocalhost(app);
  t.after(async function () { await closeServer(app); });

  const response = await fetch(
    'http://127.0.0.1:' + port + '/api/reverse-geocode?lat=22.5431&lon=114.0579',
  );
  await response.json();

  assert.equal(response.status, 200);
  assert.equal(infoLines.length, 1);
  const entry = JSON.parse(infoLines[0]);
  assert.equal(entry.upstream.service, 'nominatim');
  assert.equal(entry.upstream.status, 200);
  assert.equal(typeof entry.upstream.durationMs, 'number');
  assert.doesNotMatch(infoLines[0], /22\.5431|114\.0579|测试地点|测试市/);
});

test('invalid API requests emit warn logs and replace unsafe request IDs', async (t) => {
  const errorLines = [];
  const originalConsoleError = console.error;
  console.error = function (line) { errorLines.push(line); };
  t.after(function () { console.error = originalConsoleError; });

  const app = createColorWalkServer();
  const port = await listenOnLocalhost(app);
  t.after(async function () { await closeServer(app); });

  const response = await fetch('http://127.0.0.1:' + port + '/api/reverse-geocode?lat=private&lon=private', {
    headers: { 'X-Request-ID': 'unsafe request id' },
  });
  await response.json();

  assert.equal(response.status, 400);
  assert.match(response.headers.get('x-request-id') || '', /^[0-9a-f-]{36}$/);
  assert.equal(errorLines.length, 1);
  const entry = JSON.parse(errorLines[0]);
  assert.equal(entry.level, 'warn');
  assert.equal(entry.errorCode, 'invalid_coordinates');
  assert.doesNotMatch(errorLines[0], /unsafe request id|private/);
});

test('unexpected errors log their type and sanitized stack without the error message', async (t) => {
  const originalApiKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key';
  t.after(function () {
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
  });

  const errorLines = [];
  const originalConsoleError = console.error;
  console.error = function (line) { errorLines.push(line); };
  t.after(function () { console.error = originalConsoleError; });

  const app = createColorWalkServer();
  const port = await listenOnLocalhost(app);
  t.after(async function () { await closeServer(app); });

  const response = await fetch('http://127.0.0.1:' + port + '/api/analyze-image', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Request-ID': 'malformed-json-42',
    },
    body: '{"secret":"must-not-appear", invalid}',
  });
  await response.json();

  assert.equal(response.status, 500);
  assert.equal(errorLines.length, 1);
  const entry = JSON.parse(errorLines[0]);
  assert.equal(entry.errorType, 'SyntaxError');
  assert.equal(entry.errorCode, 'server_error');
  assert.match(entry.stack, /server\.js/);
  assert.doesNotMatch(errorLines[0], /must-not-appear|Unexpected token|Expected property/);
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

async function startJsonServer(t, status, payload) {
  const server = http.createServer(function (request, response) {
    request.resume();
    const body = JSON.stringify(payload);
    response.writeHead(status, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    });
    response.end(body);
  });
  const port = await listenOnLocalhost(server);
  t.after(async function () { await closeServer(server); });
  return { url: 'http://127.0.0.1:' + port };
}

function captureOpenAIEnv() {
  return {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  };
}

function restoreOpenAIEnv(env) {
  Object.keys(env).forEach(function (key) {
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  });
}
