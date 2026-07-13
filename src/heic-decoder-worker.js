import { findDominantColor } from './color.js';

const workerUrl = new URL(self.location.href);
const decoderUrl = new URL('/vendor/libheif/libheif-bundle.mjs', workerUrl.origin);
const DOMINANT_COLOR_SAMPLE_SIZE = 72;
const HEIC_DECODER_WARMUP_BASE64 = 'AAAAHGZ0eXBoZWljAAAAAG1pZjFoZWljbWlhZgAAAVZtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAAA5waXRtAAAAAAABAAAAImlsb2MAAAAAREAAAQABAAAAAAF6AAEAAAAAAAAALgAAACNpaW5mAAAAAAABAAAAFWluZmUCAAAAAAEAAGh2YzEAAAAA1mlwcnAAAAC3aXBjbwAAAHhodmNDAQNwAAAAAAAAAAAAHvAA/P34+AAADwMgAAEAGEABDAH//wNwAAADAJAAAAMAAAMAHroCQCEAAQArQgEBA3AAAAMAkAAAAwAAAwAeoDCBJZbqSSmubgIaDAgAAAMACAAAAwAIQCIAAQAHRAHBcrAiQAAAABRpc3BlAAAAAAAAAGAAAABIAAAAE2NvbHJuY2x4AAEADQAGgAAAABBwaXhpAAAAAAMICAgAAAAXaXBtYQAAAAAAAAABAAEEgQIDBAAAADZtZGF0AAAAKigBrwT4QTJpy/4u////IkfZf044pPRxgz4KU26eESXbQxvdeAAAAwA/YA==';

const decoderReady = loadDecoder();

async function loadDecoder() {
  try {
    const decoderModule = await import(decoderUrl.href);
    const libheif = await decoderModule.default();
    const decoder = new libheif.HeifDecoder();
    await warmUpHeicDecoder(decoder);
    self.postMessage({ type: 'ready' });
    return decoder;
  } catch (error) {
    self.postMessage({ type: 'fatal', message: getErrorMessage(error) });
    return null;
  }
}

async function warmUpHeicDecoder(decoder) {
  const binary = atob(HEIC_DECODER_WARMUP_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  await decodeHeicToJpeg(decoder, new Blob([bytes], { type: 'image/heic' }), 0.5);
}

let decodeQueue = Promise.resolve();

self.onmessage = function (event) {
  const message = event.data || {};
  if (message.type !== 'decode') return;

  decodeQueue = decodeQueue.then(function () {
    return decodeFile(message);
  });
};

async function decodeFile(message) {
  const decoder = await decoderReady;
  if (!decoder) return;

  try {
    const blob = await decodeHeicToJpeg(decoder, message.file, 0.9);
    self.postMessage({ type: 'decoded', id: message.id, blob });
    let dominantColor = null;
    try {
      dominantColor = await extractDominantColor(blob);
    } catch (_error) {
      dominantColor = null;
    }
    self.postMessage({ type: 'dominant-color', id: message.id, dominantColor });
  } catch (error) {
    self.postMessage({ type: 'decode-error', id: message.id, message: getErrorMessage(error) });
  }
}

async function decodeHeicToJpeg(decoder, blob, quality) {
  const images = decoder.decode(new Uint8Array(await blob.arrayBuffer()));
  if (!images.length) throw new Error('HEIC file contains no decodable image');
  let canvas;
  try {
    const image = images[0];
    const width = image.get_width();
    const height = image.get_height();
    if (!width || !height) throw new Error('HEIC image has invalid dimensions');

    canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('HEIC decoder canvas is unavailable');
    const imageData = context.createImageData(width, height);
    for (let index = 3; index < imageData.data.length; index += 4) imageData.data[index] = 255;
    await new Promise(function (resolveDisplay, rejectDisplay) {
      image.display(imageData, function (displayData) {
        if (!displayData) {
          rejectDisplay(new Error('HEIC image decode failed'));
          return;
        }
        resolveDisplay();
      });
    });
    context.putImageData(imageData, 0, 0);
    return await canvas.convertToBlob({ type: 'image/jpeg', quality });
  } finally {
    images.forEach(function (decodedImage) { decodedImage.free(); });
    if (canvas) {
      canvas.width = 1;
      canvas.height = 1;
    }
  }
}

async function extractDominantColor(blob) {
  const bitmap = await createImageBitmap(blob);
  try {
    const size = DOMINANT_COLOR_SAMPLE_SIZE;
    const canvas = new OffscreenCanvas(size, size);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const scale = Math.max(size / bitmap.width, size / bitmap.height);
    const sourceWidth = size / scale;
    const sourceHeight = size / scale;
    const sourceX = (bitmap.width - sourceWidth) / 2;
    const sourceY = (bitmap.height - sourceHeight) / 2;
    context.drawImage(bitmap, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, size, size);
    const pixels = context.getImageData(0, 0, size, size);
    return findDominantColor(pixels.data, size, size, {
      sampleStep: 2,
      bucketSize: 16,
      ignoreNearWhite: true,
      ignoreNearBlack: true,
    });
  } finally {
    bitmap.close();
  }
}

function getErrorMessage(error) {
  if (error && typeof error.message === 'string' && error.message) return error.message;
  return String(error || 'HEIC decoder failed');
}
