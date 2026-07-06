import http from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';

import { createColorWalkServer } from '../server.js';

test('reverse-geocode proxies GPS coordinates to a configured upstream and returns a readable place label', async (t) => {
  const upstreamRequests = [];
  const upstream = http.createServer(function (request, response) {
    const url = new URL(request.url, 'http://127.0.0.1');
    upstreamRequests.push({
      method: request.method,
      pathname: url.pathname,
      params: Object.fromEntries(url.searchParams.entries()),
      userAgent: request.headers['user-agent'],
      referer: request.headers.referer,
    });

    sendJson(response, 200, {
      display_name: '武康路, 湖南路街道, 徐汇区, 上海市, 中国',
      address: {
        road: '武康路',
        suburb: '湖南路街道',
        city: '上海市',
        country: '中国',
      },
    });
  });
  const upstreamPort = await listenOnLocalhost(upstream);
  t.after(async function () { await closeServer(upstream); });

  const originalEnv = captureGeocodeEnv();
  process.env.GEOCODE_REVERSE_URL = 'http://127.0.0.1:' + upstreamPort + '/reverse';
  process.env.GEOCODE_USER_AGENT = 'ColorWalkTest/1.0';
  t.after(function () { restoreGeocodeEnv(originalEnv); });

  const app = createColorWalkServer();
  const appPort = await listenOnLocalhost(app);
  t.after(async function () { await closeServer(app); });

  const response = await fetch('http://127.0.0.1:' + appPort + '/api/reverse-geocode?lat=31.230001&lon=121.472778&lang=zh-CN');
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.label, '上海 武康路');
  assert.equal(payload.source, 'nominatim');
  assert.equal(payload.attribution, 'OpenStreetMap/Nominatim');
  assert.equal(payload.address.road, '武康路');

  assert.equal(upstreamRequests.length, 1);
  assert.equal(upstreamRequests[0].method, 'GET');
  assert.equal(upstreamRequests[0].pathname, '/reverse');
  assert.equal(upstreamRequests[0].params.format, 'jsonv2');
  assert.equal(upstreamRequests[0].params.addressdetails, '1');
  assert.equal(upstreamRequests[0].params.namedetails, '1');
  assert.equal(upstreamRequests[0].params.layer, 'address,poi');
  assert.equal(upstreamRequests[0].params['accept-language'], 'zh-CN');
  assert.equal(upstreamRequests[0].params.lat, '31.230001');
  assert.equal(upstreamRequests[0].params.lon, '121.472778');
  assert.equal(upstreamRequests[0].userAgent, 'ColorWalkTest/1.0');
});

test('reverse-geocode returns a clear error when the upstream cannot be queried', async (t) => {
  const closedServer = http.createServer();
  const closedPort = await listenOnLocalhost(closedServer);
  await closeServer(closedServer);

  const originalEnv = captureGeocodeEnv();
  process.env.GEOCODE_REVERSE_URL = 'http://127.0.0.1:' + closedPort + '/reverse';
  process.env.GEOCODE_USER_AGENT = 'ColorWalkTest/1.0';
  t.after(function () { restoreGeocodeEnv(originalEnv); });

  const app = createColorWalkServer();
  const appPort = await listenOnLocalhost(app);
  t.after(async function () { await closeServer(app); });

  const response = await fetch('http://127.0.0.1:' + appPort + '/api/reverse-geocode?lat=31.230001&lon=121.472778&lang=zh-CN');
  const payload = await response.json();

  assert.equal(response.status, 502);
  assert.deepEqual(payload, { error: 'reverse_geocode_unavailable' });
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

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  response.end(body);
}

function captureGeocodeEnv() {
  return {
    GEOCODE_REVERSE_URL: process.env.GEOCODE_REVERSE_URL,
    GEOCODE_USER_AGENT: process.env.GEOCODE_USER_AGENT,
  };
}

function restoreGeocodeEnv(env) {
  Object.keys(env).forEach(function (key) {
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  });
}
