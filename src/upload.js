const HEIC2ANY_SCRIPT_URL = new URL('./vendor/heic2any-0.0.4.min.js', import.meta.url).href;
const HEIC_JPEG_QUALITY = 0.92;
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heif', 'mif1', 'msf1']);

let heic2anyLoader = null;

export async function isHeicFile(file) {
  const type = String(file?.type || '').toLowerCase();
  if (type.includes('heic') || type.includes('heif')) return true;

  const name = String(file?.name || '').toLowerCase();
  if (/\.(heic|heif|hif)$/.test(name)) return true;

  try {
    return hasHeicFtypBrand(await readHeaderBytes(file, 64));
  } catch {
    return false;
  }
}

export async function normalizeUploadFile(file, options = {}) {
  const readAsDataUrl = options.readAsDataUrl || readFileAsDataUrl;
  const loadImage = options.loadImage || loadBrowserImage;
  const extractMetadata = options.extractMetadata || emptyMetadata;
  const convertHeic = options.convertHeicToJpeg || convertHeicToJpeg;
  const transcodeImageToJpeg = options.transcodeImageToJpeg || transcodeBrowserImageToJpeg;
  const fileName = String(file?.name || 'uploaded-photo');
  const heic = await isHeicFile(file);
  const metadata = await safeExtractMetadata(extractMetadata, file);

  try {
    const dataUrl = heic
      ? await convertHeicWithNativeFallback(file, {
        convertHeic,
        readAsDataUrl,
        loadImage,
        transcodeImageToJpeg,
        quality: HEIC_JPEG_QUALITY,
      })
      : await readAsDataUrl(file);
    const image = await loadImage(dataUrl);

    return {
      ok: true,
      fileName,
      src: dataUrl,
      dataUrl,
      image,
      metadata,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      ratio: image.naturalWidth / image.naturalHeight,
      convertedFromHeic: heic,
    };
  } catch (error) {
    return {
      ok: false,
      fileName,
      reason: heic ? 'heic_conversion_failed' : 'image_load_failed',
      error,
    };
  }
}

async function convertHeicWithNativeFallback(file, { convertHeic, readAsDataUrl, loadImage, transcodeImageToJpeg, quality }) {
  try {
    return await convertHeic(file, { quality });
  } catch (conversionError) {
    try {
      const originalDataUrl = await readAsDataUrl(file);
      const image = await loadImage(originalDataUrl);
      return await transcodeImageToJpeg(image, { quality });
    } catch {
      throw conversionError;
    }
  }
}

export function buildUploadStatusMessage({ loaded = 0, failed = 0 } = {}) {
  if (loaded > 0 && failed > 0) {
    return '已完成 ' + loaded + ' 张图片识别，' + failed + ' 张 HEIC 转换失败已跳过。';
  }
  if (loaded > 0) return '已完成识别，可以继续调整文本和结构。';
  if (failed > 0) return 'HEIC 转换失败，请先转为 JPEG 或 PNG 后重试。';
  return '';
}

export async function convertHeicToJpeg(file, { quality = HEIC_JPEG_QUALITY } = {}) {
  const heic2any = await loadHeic2Any();
  const converted = await heic2any({
    blob: file,
    toType: 'image/jpeg',
    quality,
  });
  const blob = Array.isArray(converted) ? converted[0] : converted;
  return readFileAsDataUrl(blob);
}

export async function loadHeic2Any({ windowRef, documentRef, scriptUrl = HEIC2ANY_SCRIPT_URL } = {}) {
  const win = windowRef || (typeof window !== 'undefined' ? window : null);
  if (typeof win?.heic2any === 'function') return win.heic2any;
  if (heic2anyLoader) return heic2anyLoader;

  const doc = documentRef || (typeof document !== 'undefined' ? document : null);
  if (!win || !doc?.createElement) throw new Error('heic2any_browser_required');

  heic2anyLoader = new Promise(function (resolve, reject) {
    const script = doc.createElement('script');
    script.src = scriptUrl;
    script.async = true;
    script.onload = function () {
      if (typeof win.heic2any === 'function') resolve(win.heic2any);
      else {
        heic2anyLoader = null;
        reject(new Error('heic2any_not_loaded'));
      }
    };
    script.onerror = function () {
      heic2anyLoader = null;
      reject(new Error('heic2any_load_failed'));
    };
    doc.head.append(script);
  });

  return heic2anyLoader;
}

function hasHeicFtypBrand(bytes) {
  if (!bytes || bytes.length < 12) return false;
  if (ascii(bytes, 4, 8) !== 'ftyp') return false;

  const brands = [ascii(bytes, 8, 12)];
  for (let offset = 16; offset + 4 <= bytes.length; offset += 4) {
    brands.push(ascii(bytes, offset, offset + 4));
  }
  return brands.some(function (brand) { return HEIC_BRANDS.has(brand); });
}

async function readHeaderBytes(file, length) {
  if (!file || typeof file.arrayBuffer !== 'function') return new Uint8Array();
  const source = typeof file.slice === 'function' ? file.slice(0, length) : file;
  const buffer = await source.arrayBuffer();
  return new Uint8Array(buffer).slice(0, length);
}

function ascii(bytes, start, end) {
  let text = '';
  for (let index = start; index < end && index < bytes.length; index += 1) {
    text += String.fromCharCode(bytes[index]);
  }
  return text;
}

async function safeExtractMetadata(extractMetadata, file) {
  try {
    return await extractMetadata(file);
  } catch {
    return {};
  }
}

function emptyMetadata() {
  return {};
}

function readFileAsDataUrl(file) {
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onload = function () { resolve(String(reader.result || '')); };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadBrowserImage(src) {
  return new Promise(function (resolve, reject) {
    const image = new Image();
    image.onload = function () { resolve(image); };
    image.onerror = reject;
    image.src = src;
  });
}

function transcodeBrowserImageToJpeg(image, { quality = HEIC_JPEG_QUALITY } = {}) {
  const width = image.naturalWidth || image.width || 0;
  const height = image.naturalHeight || image.height || 0;
  if (!width || !height) throw new Error('image_dimensions_required');

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('canvas_context_required');

  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', quality);
}
