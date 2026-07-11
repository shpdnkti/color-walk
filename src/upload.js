const HEIC_MIME_TYPES = new Set([
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
]);

export async function processUploadFiles(files, options = {}) {
  const getPriority = typeof options.getPriority === 'function'
    ? options.getPriority
    : function () { return 0; };
  const queue = Array.from(files || [], function (file, index) {
    return { file, index, priority: normalizePriority(getPriority(file, index)) };
  }).sort(function (left, right) {
    return left.priority - right.priority || left.index - right.index;
  });
  const concurrency = clampConcurrency(options.concurrency, queue.length);
  const preparePhoto = options.preparePhoto;
  const onPhotoReady = options.onPhotoReady || function () {};
  const onPhotoError = options.onPhotoError || function () {};
  const onPhotoCancelled = options.onPhotoCancelled || function () {};
  const isCancelled = options.isCancelled || function () { return false; };
  const summary = { loaded: 0, failed: 0, cancelled: 0 };
  let nextIndex = 0;

  if (typeof preparePhoto !== 'function') {
    throw new TypeError('processUploadFiles requires a preparePhoto function.');
  }

  async function work() {
    while (nextIndex < queue.length) {
      const entry = queue[nextIndex];
      nextIndex += 1;
      const { file, index } = entry;

      if (isCancelled()) {
        summary.cancelled += 1;
        continue;
      }

      try {
        const photo = await preparePhoto(file, index);
        if (isCancelled()) {
          await disposeCancelledPhoto(photo, file, index);
          summary.cancelled += 1;
          continue;
        }
        await onPhotoReady(photo, file, index);
        summary.loaded += 1;
      } catch (error) {
        if (isCancelled()) {
          summary.cancelled += 1;
          continue;
        }
        summary.failed += 1;
        await onPhotoError(error, file, index);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, work));
  return summary;

  async function disposeCancelledPhoto(photo, file, index) {
    try {
      await onPhotoCancelled(photo, file, index);
    } catch (_error) {
      // Cleanup failures must not turn a cancelled upload into a failed one.
    }
  }
}

export function isHeicFile(file) {
  const type = String(file?.type || '').toLowerCase();
  const name = String(file?.name || '').toLowerCase();
  return HEIC_MIME_TYPES.has(type) || /\.(heic|heif|hif)$/.test(name);
}

export function buildUploadStatusMessage(summary = {}) {
  const loaded = Math.max(0, Number(summary.loaded) || 0);
  const failed = Math.max(0, Number(summary.failed) || 0);
  if (loaded > 0 && failed === 0) return '已完成识别，可以继续调整文本和结构。';
  if (loaded > 0) return '已完成 ' + loaded + ' 张图片识别，' + failed + ' 张读取失败已跳过。';
  return failed + ' 张图片读取失败，请重试或转换为 JPG/PNG。';
}

function normalizePriority(value) {
  const priority = Number(value);
  return Number.isFinite(priority) ? priority : 0;
}

function clampConcurrency(value, queueLength) {
  if (queueLength === 0) return 0;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return 1;
  return Math.min(parsed, queueLength);
}
