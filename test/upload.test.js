import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildUploadStatusMessage,
  isHeicFile,
  processUploadFiles,
} from '../src/upload.js';

test('publishes each prepared photo without waiting for the rest of the batch', async () => {
  const pending = new Map([
    ['first', deferred()],
    ['second', deferred()],
    ['third', deferred()],
  ]);
  const started = [];
  const ready = [];
  let active = 0;
  let maxActive = 0;

  const processing = processUploadFiles(['first', 'second', 'third'], {
    concurrency: 2,
    async preparePhoto(file) {
      started.push(file);
      active += 1;
      maxActive = Math.max(maxActive, active);
      try {
        return await pending.get(file).promise;
      } finally {
        active -= 1;
      }
    },
    onPhotoReady(photo) {
      ready.push(photo);
    },
  });

  await waitFor(function () { return started.length === 2; });
  pending.get('second').resolve('photo:second');
  await waitFor(function () { return ready.length === 1; });

  assert.deepEqual(ready, ['photo:second']);
  assert.deepEqual(started, ['first', 'second', 'third']);

  pending.get('first').resolve('photo:first');
  pending.get('third').resolve('photo:third');
  const summary = await processing;

  assert.equal(maxActive, 2);
  assert.deepEqual(ready, ['photo:second', 'photo:first', 'photo:third']);
  assert.deepEqual(summary, { loaded: 3, failed: 0, cancelled: 0 });
});

test('prioritizes native images without losing their original input indexes', async () => {
  const releaseHeic = deferred();
  const files = [
    { name: 'slow-one.heic', type: 'image/heic' },
    { name: 'slow-two.heic', type: 'image/heic' },
    { name: 'fast.png', type: 'image/png' },
  ];
  const started = [];
  const ready = [];

  const processing = processUploadFiles(files, {
    concurrency: 2,
    getPriority(file) {
      return isHeicFile(file) ? 1 : 0;
    },
    async preparePhoto(file, inputIndex) {
      started.push({ name: file.name, inputIndex });
      if (isHeicFile(file)) await releaseHeic.promise;
      return 'photo:' + file.name;
    },
    onPhotoReady(photo, file, inputIndex) {
      ready.push({ photo, name: file.name, inputIndex });
    },
  });

  await waitFor(function () {
    return ready.some(function (entry) { return entry.name === 'fast.png'; });
  });

  assert.deepEqual(started.slice(0, 2), [
    { name: 'fast.png', inputIndex: 2 },
    { name: 'slow-one.heic', inputIndex: 0 },
  ]);
  assert.deepEqual(ready, [{
    photo: 'photo:fast.png',
    name: 'fast.png',
    inputIndex: 2,
  }]);

  releaseHeic.resolve();
  const summary = await processing;

  assert.deepEqual(
    ready.map(function (entry) { return entry.inputIndex; }).sort(),
    [0, 1, 2]
  );
  assert.deepEqual(summary, { loaded: 3, failed: 0, cancelled: 0 });
});

test('keeps successful photos when another file fails', async () => {
  const ready = [];
  const failed = [];

  const summary = await processUploadFiles(['good.jpg', 'broken.heic', 'good.png'], {
    concurrency: 2,
    async preparePhoto(file) {
      if (file === 'broken.heic') throw new Error('decode failed');
      return 'photo:' + file;
    },
    onPhotoReady(photo) {
      ready.push(photo);
    },
    onPhotoError(error, file) {
      failed.push({ message: error.message, file });
    },
  });

  assert.deepEqual(ready.sort(), ['photo:good.jpg', 'photo:good.png']);
  assert.deepEqual(failed, [{ message: 'decode failed', file: 'broken.heic' }]);
  assert.deepEqual(summary, { loaded: 2, failed: 1, cancelled: 0 });
});

test('disposes a prepared photo when the upload is cancelled before publish', async () => {
  const releasePhoto = deferred();
  const disposed = [];
  const ready = [];
  let started = false;
  let cancelled = false;

  const processing = processUploadFiles(['late.heic'], {
    concurrency: 1,
    async preparePhoto() {
      started = true;
      await releasePhoto.promise;
      return { src: 'blob:late-photo' };
    },
    isCancelled() {
      return cancelled;
    },
    onPhotoCancelled(photo, file, index) {
      disposed.push({ photo, file, index });
    },
    onPhotoReady(photo) {
      ready.push(photo);
    },
  });

  await waitFor(function () { return started; });
  cancelled = true;
  releasePhoto.resolve();
  const summary = await processing;

  assert.deepEqual(ready, []);
  assert.deepEqual(disposed, [{ photo: { src: 'blob:late-photo' }, file: 'late.heic', index: 0 }]);
  assert.deepEqual(summary, { loaded: 0, failed: 0, cancelled: 1 });
});

test('detects HEIC family uploads by extension and MIME type', () => {
  assert.equal(isHeicFile({ name: 'IMG_0001.HEIC', type: '' }), true);
  assert.equal(isHeicFile({ name: 'IMG_0002.hif', type: 'application/octet-stream' }), true);
  assert.equal(isHeicFile({ name: 'sequence.bin', type: 'image/heif-sequence' }), true);
  assert.equal(isHeicFile({ name: 'walk.jpg', type: 'image/jpeg' }), false);
});

test('builds complete, partial, and failed upload status messages', () => {
  assert.equal(buildUploadStatusMessage({ loaded: 2, failed: 0 }), '已完成识别，可以继续调整文本和结构。');
  assert.equal(buildUploadStatusMessage({ loaded: 2, failed: 1 }), '已完成 2 张图片识别，1 张读取失败已跳过。');
  assert.equal(buildUploadStatusMessage({ loaded: 0, failed: 2 }), '2 张图片读取失败，请重试或转换为 JPG/PNG。');
});

function deferred() {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise(function (resolve, reject) {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise(function (resolveTick) { setImmediate(resolveTick); });
  }
  throw new Error('Timed out waiting for upload test state.');
}
