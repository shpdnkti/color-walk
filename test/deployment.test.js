import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function readProjectFile(path) {
  return readFile(new URL('../' + path, import.meta.url), 'utf8');
}

test('Dockerfile serves the app server and includes static and API assets', async () => {
  const dockerfile = await readProjectFile('Dockerfile');

  assert.match(dockerfile, /^FROM node:22-alpine$/m);
  assert.match(dockerfile, /^COPY package\.json package-lock\.json \.\/$/m);
  assert.match(dockerfile, /^COPY index\.html \.\/index\.html$/m);
  assert.match(dockerfile, /^COPY src\/ \.\/src\//m);
  assert.match(dockerfile, /^COPY server\/ \.\/server\//m);
  assert.match(dockerfile, /^COPY server\.js \.\/server\.js$/m);
  assert.match(dockerfile, /^EXPOSE 3000$/m);
  assert.match(dockerfile, /^CMD \["node", "server\.js"\]$/m);
});

test('production compose builds the app server image with configurable host port and healthcheck', async () => {
  const compose = await readProjectFile('docker-compose.yml');

  assert.match(compose, /^name: color-walk$/m);
  assert.match(compose, /^  app:$/m);
  assert.match(compose, /^    build: \.$/m);
  assert.match(compose, /^    image: color-walk-collage:local$/m);
  assert.match(compose, /- "\$\{APP_PORT:-8080\}:3000"/);
  assert.match(compose, /restart: unless-stopped/);
  assert.match(compose, /"CMD-SHELL", "node -e \\"fetch\('http:\/\/127\.0\.0\.1:3000\/'\)\.then\(r=>process\.exit\(r\.ok\?0:1\)\)\.catch\(\(\)=>process\.exit\(1\)\)\\""/);
});

test('production geocode proxy identifies Color Walk to Nominatim', async () => {
  const compose = await readProjectFile('docker-compose.yml');
  const server = await readProjectFile('server.js');

  assert.doesNotMatch(compose, /example\.invalid/);
  assert.doesNotMatch(server, /example\.invalid/);
  assert.match(compose, /GEOCODE_USER_AGENT: "\$\{GEOCODE_USER_AGENT:-ColorWalk\/0\.1 \(https:\/\/github\.com\/shpdnkti\/color-walk\)\}"/);
  assert.match(server, /'User-Agent': process\.env\.GEOCODE_USER_AGENT \|\| DEFAULT_GEOCODE_USER_AGENT/);
  assert.match(server, /Referer: DEFAULT_GEOCODE_REFERER/);
});

test('preview compose serves the live source tree from a separate yaml', async () => {
  const compose = await readProjectFile('docker-compose.preview.yml');

  assert.match(compose, /^name: color-walk-preview$/m);
  assert.match(compose, /^  preview:$/m);
  assert.match(compose, /^    image: nginx:stable-alpine$/m);
  assert.match(compose, /- "\$\{PREVIEW_PORT:-5173\}:80"/);
  assert.match(compose, /- \.\/index\.html:\/usr\/share\/nginx\/html\/index\.html:ro/);
  assert.match(compose, /- \.\/src:\/usr\/share\/nginx\/html\/src:ro/);
  assert.match(compose, /- \.\/nginx\.conf:\/etc\/nginx\/conf\.d\/default\.conf:ro/);
  assert.match(compose, /- \.\/nginx\.preview\.conf:\/etc\/nginx\/nginx\.conf:ro/);
});

test('preview nginx main config lets the container read private bind-mounted workspace files', async () => {
  const nginx = await readProjectFile('nginx.preview.conf');

  assert.match(nginx, /^user root;$/m);
  assert.match(nginx, /include \/etc\/nginx\/conf\.d\/\*\.conf;/);
});

test('nginx configuration supports browser module assets and single-page fallback', async () => {
  const nginx = await readProjectFile('nginx.conf');

  assert.match(nginx, /listen 80;/);
  assert.match(nginx, /root \/usr\/share\/nginx\/html;/);
  assert.match(nginx, /try_files \$uri \$uri\/ \/index\.html;/);
  assert.match(nginx, /location ~\* \\\.\(js\|css\|png\|jpg\|jpeg\|gif\|svg\|ico\|webp\)\$/);
  assert.match(nginx, /add_header Cache-Control "public, max-age=604800, immutable";/);
});
