import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(resolve(testDir, '../src/app.js'), 'utf8');
const workerSource = readFileSync(resolve(testDir, '../src/heic-decoder-worker.js'), 'utf8');

test('runs HEIC conversion through a persistent module worker', () => {
  assert.match(appSource, /const HEIC_DECODER_WORKER_URL = '\/src\/heic-decoder-worker\.js\?v=20260710-heic-first-preview'/);
  assert.match(appSource, /new Worker\(HEIC_DECODER_WORKER_URL \+ retryQuery, \{ type: 'module' \}\)/);
  assert.match(appSource, /function convertHeicInWorker/);
  assert.match(appSource, /worker\.postMessage\(\{ type: 'decode', id, file \}\)/);
  assert.doesNotMatch(appSource, /import\(HEIC_DECODER_MODULE_URL/);
  assert.match(workerSource, /decoderUrl\.searchParams\.set\('retry', retry\)/);
  assert.match(workerSource, /import\(decoderUrl\.href\)/);
  assert.match(workerSource, /type: 'ready'/);
  assert.match(workerSource, /type: 'fatal'/);
  assert.match(workerSource, /type: 'image\/jpeg'/);
  assert.match(workerSource, /type: 'decoded'/);
  assert.match(workerSource, /type: 'decode-error'/);
  assert.match(workerSource, /decodeQueue = decodeQueue\.then/);
  assert.match(workerSource, /HEIC_DECODER_WARMUP_BASE64/);
  assert.match(workerSource, /quality: 0\.5/);
  const warmupIndex = workerSource.indexOf('await warmUpHeicDecoder');
  const readyIndex = workerSource.indexOf("type: 'ready'");
  assert.ok(warmupIndex >= 0 && warmupIndex < readyIndex);
});

test('serializes app decode requests before starting each item timeout', () => {
  assert.match(appSource, /let heicDecodeRequestQueue = Promise\.resolve\(\)/);
  assert.match(appSource, /heicDecodeRequestQueue\.then\(/);
  assert.match(appSource, /heicDecodeRequestQueue = decodePromise\.catch/);
  assert.match(appSource, /function postHeicDecodeRequest/);
});

test('recreates the decoder worker after fatal, runtime, load-timeout, and item-timeout failures', () => {
  assert.match(appSource, /resetHeicDecoderWorker/);
  assert.match(appSource, /heicDecoderLoadAttempt \+= 1/);
  assert.match(appSource, /heicDecoderWorkerReadyPromise = null/);
  assert.match(appSource, /HEIC_WORKER_LOAD_TIMEOUT_MS/);
  assert.match(appSource, /HEIC_DECODE_TIMEOUT_MS/);
  assert.match(appSource, /message\.type === 'fatal'/);
  assert.match(appSource, /worker\.onerror/);
  assert.match(appSource, /for \(const pending of heicDecoderPending\.values\(\)\)/);
  assert.match(appSource, /message\.type === 'decode-error'/);
});

test('preloads the decoder silently from upload intent without forcing conversion', () => {
  assert.match(appSource, /document\.querySelector\('label\[for="fileInput"\]'\)/);
  assert.match(appSource, /uploadButton.*pointerdown.*preloadHeicDecoderWorker/);
  assert.doesNotMatch(appSource, /pointerenter|addEventListener.*focus.*preloadHeicDecoderWorker/);
  assert.match(appSource, /function releaseIdleHeicDecoderWorker/);
  assert.match(appSource, /function preloadHeicDecoderWorker/);
  assert.match(appSource, /const nativeUrl = URL\.createObjectURL\(file\)/);
  assert.match(appSource, /await loadImage\(nativeUrl\)/);
  assert.match(appSource, /convertHeicInWorker\(file/);
});

test('cancels active decoder work while preserving an idle warm worker', () => {
  assert.match(appSource, /onPhotoCancelled: revokePhotoUrl/);
  assert.match(appSource, /if \(heicDecoderPending\.size > 0\) \{\s*resetHeicDecoderWorker\(new Error\('upload cancelled'\)\);\s*\}/);
});
