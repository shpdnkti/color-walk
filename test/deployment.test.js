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
  assert.match(dockerfile, /^RUN npm ci --omit=dev$/m);
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
  const readme = await readProjectFile('README.md');

  assert.doesNotMatch(compose, /example\.invalid/);
  assert.doesNotMatch(server, /example\.invalid/);
  assert.match(compose, /GEOCODE_USER_AGENT: "\$\{GEOCODE_USER_AGENT:-ColorWalk\/0\.1 \(https:\/\/github\.com\/shpdnkti\/color-walk\)\}"/);
  assert.ok(compose.includes("GEOCODE_REVERSE_URL: \"${GEOCODE_REVERSE_URL:-https://nominatim.openstreetmap.org/reverse}\""));
  assert.match(server, /process.env.GEOCODE_REVERSE_URL/);
  assert.match(server, /'User-Agent': process\.env\.GEOCODE_USER_AGENT \|\| DEFAULT_GEOCODE_USER_AGENT/);
  assert.match(server, /Referer: DEFAULT_GEOCODE_REFERER/);
  assert.match(readme, /GEOCODE_REVERSE_URL/);
});

test('production exposes OpenAI endpoint and request tuning configuration', async () => {
  const compose = await readProjectFile('docker-compose.yml');
  const server = await readProjectFile('server.js');
  const readme = await readProjectFile('README.md');

  assert.ok(compose.includes("OPENAI_BASE_URL: \"${OPENAI_BASE_URL:-https://api.openai.com/v1}\""));
  assert.ok(compose.includes("OPENAI_REQUEST_TIMEOUT_MS: \"${OPENAI_REQUEST_TIMEOUT_MS:-90000}\""));
  assert.ok(server.includes("DEFAULT_OPENAI_BASE_URL") && server.includes("https://api.openai.com/v1"));
  assert.match(server, /process.env.OPENAI_BASE_URL/);
  assert.match(server, /process.env.OPENAI_REQUEST_TIMEOUT_MS/);
  assert.match(server, /AbortSignal.timeout/);
  assert.match(readme, /OPENAI_BASE_URL/);
  assert.match(readme, /OPENAI_REQUEST_TIMEOUT_MS/);
});

test('preview compose serves the live source tree from a separate yaml', async () => {
  const compose = await readProjectFile('docker-compose.preview.yml');

  assert.match(compose, /^name: color-walk-preview$/m);
  assert.match(compose, /^  preview:$/m);
  assert.match(compose, /^    image: nginx:stable-alpine$/m);
  assert.match(compose, /- "\$\{PREVIEW_PORT:-5173\}:80"/);
  assert.match(compose, /- \.\/index\.html:\/usr\/share\/nginx\/html\/index\.html:ro/);
  assert.match(compose, /- \.\/src:\/usr\/share\/nginx\/html\/src:ro/);
  assert.match(compose, /node_modules\/libheif-js\/libheif-wasm:\/usr\/share\/nginx\/html\/vendor\/libheif:ro/);
  assert.doesNotMatch(compose, /heic-to/);
  assert.match(compose, /- \.\/nginx\.conf:\/etc\/nginx\/conf\.d\/default\.conf:ro/);
  assert.match(compose, /- \.\/nginx\.preview\.conf:\/etc\/nginx\/nginx\.conf:ro/);
});

test('preview nginx main config lets the container read private bind-mounted workspace files', async () => {
  const nginx = await readProjectFile('nginx.preview.conf');

  assert.match(nginx, /^user root;$/m);
  assert.match(nginx, /include \/etc\/nginx\/conf\.d\/\*\.conf;/);
});

test('nginx configuration enforces the production CSP and supports browser module assets', async () => {
  const nginx = await readProjectFile('nginx.conf');

  assert.match(nginx, /listen 80;/);
  assert.match(nginx, /root \/usr\/share\/nginx\/html;/);
  assert.match(nginx, /try_files \$uri \$uri\/ \/index\.html;/);
  assert.match(nginx, /location ~\* \\\.\(js\|mjs\)\$/);
  assert.match(nginx, /location ~\* \\\.\(css\|png\|jpg\|jpeg\|gif\|svg\|ico\|webp\)\$/);
  assert.match(nginx, /add_header Cache-Control "no-cache";/);
  assert.match(nginx, /add_header Cache-Control "public, max-age=604800, immutable";/);
  assert.match(nginx, /Content-Security-Policy/);
  assert.match(nginx, /script-src 'self' 'wasm-unsafe-eval'/);
  assert.match(nginx, /worker-src 'self'/);
  assert.doesNotMatch(nginx, /(?:^|\s)'unsafe-eval'(?:\s|;|$)/m);
});

test('production dependency uses libheif directly without the retired decoder wrapper', async () => {
  const packageJson = JSON.parse(await readProjectFile('package.json'));
  const packageLock = await readProjectFile('package-lock.json');
  const dockerfile = await readProjectFile('Dockerfile');

  assert.equal(packageJson.dependencies['libheif-js'], '1.19.8');
  assert.equal(packageJson.dependencies['heic-to'], undefined);
  assert.match(packageLock, /node_modules\/libheif-js/);
  assert.doesNotMatch(packageLock, /heic-to/);
  assert.match(dockerfile, /npm ci --omit=dev/);
});

test('documents opt-in browser regression checks', async () => {
  const packageJson = JSON.parse(await readProjectFile('package.json'));
  const readme = await readProjectFile('README.md');

  assert.equal(packageJson.scripts['test:export-preview'], 'node scripts/export-preview-smoke.mjs');
  assert.equal(packageJson.scripts['test:heic-upload'], 'node scripts/heic-upload-regression.mjs');
  assert.equal(packageJson.scripts['test:heic-worker'], 'COLOR_WALK_RUN_HEIC_BROWSER=1 node --test test/server-ai.test.js');
  assert.equal(packageJson.scripts['test:upload-enrichment'], 'node scripts/upload-progressive-regression.mjs');
  assert.equal(packageJson.scripts['test:heic-progressive'], 'node scripts/progressive-upload-regression.mjs');
  assert.equal(packageJson.scripts['test:image-aspect'], 'node scripts/image-aspect-regression.mjs');
  assert.equal(packageJson.scripts['bench:heic-first-preview'], 'node scripts/heic-first-preview-benchmark.mjs');
  assert.match(readme, /npm run test:export-preview/);
  assert.match(readme, /COLOR_WALK_RUN_EXPORT_PREVIEW_SMOKE=1/);
  assert.match(readme, /COLOR_WALK_HEIC_FIXTURE/);
  assert.match(readme, /npm run test:upload-enrichment/);
  assert.match(readme, /npm run test:heic-progressive/);
  assert.match(readme, /npm run test:heic-worker/);
  assert.match(readme, /npm run test:image-aspect/);
  assert.match(readme, /npm run test:image-crop-drag/);
  assert.match(readme, /npm run bench:heic-first-preview/);
});

test('CI gates HEIC delivery on strict-CSP browser and performance regressions', async () => {
  const workflow = await readProjectFile('.github/workflows/wechat-miniprogram.yml');

  assert.match(workflow, /docker build --tag color-walk:ci \./);
  assert.match(workflow, /test ! -e \/app\/node_modules\/heic-to/);
  assert.match(workflow, /npm run test:heic-worker/);
  assert.match(workflow, /npm run test:heic-upload/);
  assert.match(workflow, /npm run test:heic-progressive/);
  assert.match(workflow, /npm run test:image-aspect/);
  assert.match(workflow, /COLOR_WALK_HEIC_RUNS=3 npm run bench:heic-first-preview/);
});

test('documents HEIC CSP requirements, production verification, and failure signals', async () => {
  const readme = await readProjectFile('README.md');

  assert.match(readme, /script-src 'self' 'wasm-unsafe-eval'/);
  assert.match(readme, /不得加入 `'unsafe-eval'`/);
  assert.match(readme, /npm run test:heic-upload/);
  assert.match(readme, /securitypolicyviolation/);
  assert.match(readme, /Worker `fatal`/);
  assert.match(readme, /\/vendor\/libheif\/libheif-bundle\.mjs/);
});
