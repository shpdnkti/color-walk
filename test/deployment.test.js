import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function readProjectFile(path) {
  return readFile(new URL('../' + path, import.meta.url), 'utf8');
}

test('Dockerfile serves the static app with nginx and includes app assets', async () => {
  const dockerfile = await readProjectFile('Dockerfile');

  assert.match(dockerfile, /^FROM nginx:stable-alpine$/m);
  assert.match(dockerfile, /^COPY index\.html \/usr\/share\/nginx\/html\/index\.html$/m);
  assert.match(dockerfile, /^COPY src\/ \/usr\/share\/nginx\/html\/src\//m);
  assert.match(dockerfile, /^COPY nginx\.conf \/etc\/nginx\/conf\.d\/default\.conf$/m);
  assert.match(dockerfile, /^RUN chmod -R a\+rX \/usr\/share\/nginx\/html \/etc\/nginx\/conf\.d\/default\.conf$/m);
  assert.match(dockerfile, /^EXPOSE 80$/m);
});

test('production compose builds the static image with configurable host port and healthcheck', async () => {
  const compose = await readProjectFile('docker-compose.yml');

  assert.match(compose, /^name: color-walk$/m);
  assert.match(compose, /^  app:$/m);
  assert.match(compose, /^    build: \.$/m);
  assert.match(compose, /^    image: color-walk-collage:local$/m);
  assert.match(compose, /- "\$\{APP_PORT:-8080\}:80"/);
  assert.match(compose, /restart: unless-stopped/);
  assert.match(compose, /"CMD-SHELL", "wget -qO- http:\/\/127\.0\.0\.1\/ >\/dev\/null \|\| exit 1"/);
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
  assert.match(nginx, /location ~\* \\.\(js\|css\|png\|jpg\|jpeg\|gif\|svg\|ico\|webp\)\$/);
  assert.match(nginx, /add_header Cache-Control "public, max-age=604800, immutable";/);
});
