import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function readProjectFile(path) {
  return readFile(new URL('../' + path, import.meta.url), 'utf8');
}

test('Dockerfile runs the built-in Node app server and includes app assets', async () => {
  const dockerfile = await readProjectFile('Dockerfile');

  assert.match(dockerfile, /^FROM node:22-alpine$/m);
  assert.ok(dockerfile.includes('WORKDIR /app'));
  assert.ok(dockerfile.includes('COPY package.json package-lock.json ./'));
  assert.ok(dockerfile.includes('COPY server.js ./server.js'));
  assert.ok(dockerfile.includes('COPY index.html ./index.html'));
  assert.ok(dockerfile.includes('COPY src/ ./src/'));
  assert.match(dockerfile, /^EXPOSE 8080$/m);
  assert.ok(dockerfile.includes('CMD [\"npm\", \"start\"]'));
});

test('production compose serves Node app with env file, configurable host port, and healthcheck', async () => {
  const compose = await readProjectFile('docker-compose.yml');

  assert.match(compose, /^name: color-walk$/m);
  assert.match(compose, /^  app:$/m);
  assert.match(compose, /^    build: \.$/m);
  assert.match(compose, /^    image: color-walk-collage:local$/m);
  assert.match(compose, /env_file:\n\s+- \.env\.local/);
  assert.ok(compose.includes('- \"${APP_PORT:-8080}:8080\"'));
  assert.match(compose, /restart: unless-stopped/);
  assert.ok(compose.includes('wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1'));
});

test('preview compose serves the live source tree through the Node app server', async () => {
  const compose = await readProjectFile('docker-compose.preview.yml');

  assert.match(compose, /^name: color-walk-preview$/m);
  assert.match(compose, /^  preview:$/m);
  assert.match(compose, /^    image: node:22-alpine$/m);
  assert.ok(compose.includes('working_dir: /app'));
  assert.match(compose, /env_file:\n\s+- \.env\.local/);
  assert.ok(compose.includes('- \"${PREVIEW_PORT:-5173}:8080\"'));
  assert.ok(compose.includes('- ./server.js:/app/server.js:ro'));
  assert.ok(compose.includes('- ./index.html:/app/index.html:ro'));
  assert.ok(compose.includes('- ./src:/app/src:ro'));
  assert.match(compose, /npm start/);
});
