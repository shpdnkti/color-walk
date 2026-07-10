const workerUrl = new URL(self.location.href);
const retry = workerUrl.searchParams.get('retry') || '';
const decoderUrl = new URL('/vendor/heic-to/heic-to.js', workerUrl.origin);
decoderUrl.searchParams.set('v', '1.5.2');
decoderUrl.searchParams.set('retry', retry);
const HEIC_DECODER_WARMUP_BASE64 = 'AAAAHGZ0eXBoZWljAAAAAG1pZjFoZWljbWlhZgAAAVZtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAAA5waXRtAAAAAAABAAAAImlsb2MAAAAAREAAAQABAAAAAAF6AAEAAAAAAAAALgAAACNpaW5mAAAAAAABAAAAFWluZmUCAAAAAAEAAGh2YzEAAAAA1mlwcnAAAAC3aXBjbwAAAHhodmNDAQNwAAAAAAAAAAAAHvAA/P34+AAADwMgAAEAGEABDAH//wNwAAADAJAAAAMAAAMAHroCQCEAAQArQgEBA3AAAAMAkAAAAwAAAwAeoDCBJZbqSSmubgIaDAgAAAMACAAAAwAIQCIAAQAHRAHBcrAiQAAAABRpc3BlAAAAAAAAAGAAAABIAAAAE2NvbHJuY2x4AAEADQAGgAAAABBwaXhpAAAAAAMICAgAAAAXaXBtYQAAAAAAAAABAAEEgQIDBAAAADZtZGF0AAAAKigBrwT4QTJpy/4u////IkfZf044pPRxgz4KU26eESXbQxvdeAAAAwA/YA==';

const decoderReady = loadDecoder();

async function loadDecoder() {
  try {
    const decoderModule = await import(decoderUrl.href);
    await warmUpHeicDecoder(decoderModule);
    self.postMessage({ type: 'ready' });
    return decoderModule;
  } catch (error) {
    self.postMessage({ type: 'fatal', message: getErrorMessage(error) });
    return null;
  }
}

async function warmUpHeicDecoder(decoderModule) {
  const binary = atob(HEIC_DECODER_WARMUP_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const blob = new Blob([bytes], { type: 'image/heic' });
  await decoderModule.heicTo({
    blob,
    type: 'image/jpeg',
    quality: 0.5,
  });
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
  const decoderModule = await decoderReady;
  if (!decoderModule) return;

  try {
    const blob = await decoderModule.heicTo({
      blob: message.file,
      type: 'image/jpeg',
      quality: 0.9,
    });
    self.postMessage({ type: 'decoded', id: message.id, blob });
  } catch (error) {
    self.postMessage({ type: 'decode-error', id: message.id, message: getErrorMessage(error) });
  }
}

function getErrorMessage(error) {
  if (error && typeof error.message === 'string' && error.message) return error.message;
  return String(error || 'HEIC decoder failed');
}
