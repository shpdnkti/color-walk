import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeCoordinate, formatReverseGeocodeLabel } from './src/geocode.js';
import { buildVisionRequest, parseVisionResponse } from './server/vision.js';

const ROOT_DIR = fileURLToPath(new URL('.', import.meta.url));
const LIBHEIF_BROWSER_MODULE_PATH = join(ROOT_DIR, 'node_modules', 'libheif-js', 'libheif-wasm', 'libheif-bundle.mjs');
const PORT = Number(process.env.PORT || 3000);
const MAX_JSON_BYTES = 12 * 1024 * 1024;
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
const OPENAI_RESPONSES_PATH = 'responses';
const DEFAULT_OPENAI_REQUEST_TIMEOUT_MS = 90000;
const MAX_OPENAI_REQUEST_TIMEOUT_MS = 2147483647;
const DEFAULT_GEOCODE_REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse';
const DEFAULT_GEOCODE_REFERER = 'https://github.com/shpdnkti/color-walk';
const DEFAULT_GEOCODE_USER_AGENT = 'ColorWalk/0.1 (' + DEFAULT_GEOCODE_REFERER + ')';
const REQUEST_LOG_CONTEXT = Symbol('requestLogContext');
const API_ROUTES = new Set(['/api/analyze-image', '/api/reverse-geocode']);
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self'",
  "connect-src 'self' blob: https://nominatim.openstreetmap.org",
  "img-src 'self' blob: data:",
  "style-src 'self' 'unsafe-inline'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join('; ');

loadEnvFile('.env.local');
loadEnvFile('.env');

export function createColorWalkServer() {
  return http.createServer(async function (request, response) {
    try {
      const url = new URL(request.url || '/', 'http://127.0.0.1');
      startRequestLog(request, response, url.pathname);

      if (request.method === 'POST' && url.pathname === '/api/analyze-image') {
        await handleAnalyzeImage(request, response);
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/reverse-geocode') {
        await handleReverseGeocode(url, response);
        return;
      }

      if (request.method === 'GET' || request.method === 'HEAD') {
        serveStatic(url.pathname, request.method, response);
        return;
      }

      sendJson(response, 405, { error: 'method_not_allowed' });
    } catch (error) {
      captureUnexpectedError(response, error);
      sendJson(response, 500, { error: 'server_error' });
    }
  });
}

if (isMainModule()) {
  const server = createColorWalkServer();
  server.listen(PORT, '0.0.0.0', function () {
    writeStructuredLog({
      level: 'info',
      event: 'server_started',
      host: '0.0.0.0',
      port: PORT,
    });
  });
}

function isMainModule() {
  return Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

async function handleAnalyzeImage(request, response) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    sendJson(response, 503, { error: 'openai_api_key_missing' });
    return;
  }

  const payload = await readJsonBody(request);
  const images = validateImages(payload.images);
  if (!images.length) {
    sendJson(response, 400, { error: 'image_required' });
    return;
  }

  const model = process.env.OPENAI_VISION_MODEL || 'gpt-5.5';
  const visionRequest = buildVisionRequest({
    model,
    images,
    context: payload.context || {},
  });
  const openAIConfig = getOpenAIConfig();

  const upstreamStartedAt = Date.now();
  let upstream;
  try {
    upstream = await fetch(openAIConfig.responsesUrl, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(visionRequest),
      signal: AbortSignal.timeout(openAIConfig.timeoutMs),
    });
  } finally {
    captureUpstream(response, 'openai', upstream?.status, upstreamStartedAt);
  }

  if (!upstream.ok) {
    const errorPayload = await upstream.json().catch(function () { return {}; });
    const upstreamError = errorPayload.error || {};
    captureUpstreamErrorCode(response, upstreamError.code || upstreamError.type);
    sendJson(response, upstream.status === 429 ? 503 : 502, {
      error: 'openai_request_failed',
      status: upstream.status,
      code: safeErrorCode(upstreamError.code || upstreamError.type),
    });
    return;
  }

  const data = await upstream.json();
  sendJson(response, 200, {
    insight: parseVisionResponse(data),
    model,
  });
}

async function handleReverseGeocode(url, response) {
  const lat = normalizeCoordinate(url.searchParams.get('lat'), 'lat');
  const lon = normalizeCoordinate(url.searchParams.get('lon'), 'lon');
  const language = url.searchParams.get('lang') || 'zh-CN';
  if (lat === null || lon === null) {
    sendJson(response, 400, { error: 'invalid_coordinates' });
    return;
  }

  const upstreamUrl = new URL(process.env.GEOCODE_REVERSE_URL || DEFAULT_GEOCODE_REVERSE_URL);
  upstreamUrl.searchParams.set('format', 'jsonv2');
  upstreamUrl.searchParams.set('addressdetails', '1');
  upstreamUrl.searchParams.set('namedetails', '1');
  upstreamUrl.searchParams.set('zoom', '17');
  upstreamUrl.searchParams.set('layer', 'address,poi');
  upstreamUrl.searchParams.set('accept-language', language);
  upstreamUrl.searchParams.set('lat', String(lat));
  upstreamUrl.searchParams.set('lon', String(lon));

  let upstream;
  let data;
  const upstreamStartedAt = Date.now();
  try {
    upstream = await fetch(upstreamUrl, {
      headers: {
        Accept: 'application/json',
        'User-Agent': process.env.GEOCODE_USER_AGENT || DEFAULT_GEOCODE_USER_AGENT,
        Referer: DEFAULT_GEOCODE_REFERER,
      },
    });
    captureUpstream(response, 'nominatim', upstream.status, upstreamStartedAt);

    if (!upstream.ok) {
      sendJson(response, 502, { error: 'reverse_geocode_failed', status: upstream.status });
      return;
    }

    data = await upstream.json();
  } catch (error) {
    if (!upstream) captureUpstream(response, 'nominatim', null, upstreamStartedAt);
    sendJson(response, 502, { error: 'reverse_geocode_unavailable' });
    return;
  }
  sendJson(response, 200, {
    label: formatReverseGeocodeLabel(data),
    source: 'nominatim',
    attribution: 'OpenStreetMap/Nominatim',
    address: data.address || {},
    display_name: data.display_name || '',
  });
}

function serveStatic(pathname, method, response) {
  const filePath = resolveStaticPath(pathname);
  if (!filePath) {
    sendText(response, 404, 'Not found');
    return;
  }

  const stats = statSync(filePath);
  response.writeHead(200, {
    ...securityHeaders(),
    'Content-Type': contentType(filePath),
    'Content-Length': stats.size,
    'Cache-Control': staticCacheControl(filePath),
  });

  if (method === 'HEAD') {
    response.end();
    return;
  }

  createReadStream(filePath).pipe(response);
}

function staticCacheControl(filePath) {
  const extension = extname(filePath).toLowerCase();
  return ['.html', '.js', '.mjs'].includes(extension)
    ? 'no-cache'
    : 'public, max-age=604800, immutable';
}

function resolveStaticPath(pathname) {
  const decoded = decodeURIComponent(pathname.split('?')[0] || '/');
  let relativePath = decoded === '/' ? '/index.html' : decoded;
  if (relativePath.includes('\0') || relativePath.split('/').some(function (part) { return part.startsWith('.'); })) {
    return '';
  }

  if (relativePath === '/vendor/libheif/libheif-bundle.mjs') {
    return existsSync(LIBHEIF_BROWSER_MODULE_PATH) ? LIBHEIF_BROWSER_MODULE_PATH : '';
  }
  if (relativePath.startsWith('/vendor/')) return '';

  const allowed = relativePath === '/index.html' || relativePath.startsWith('/src/');
  if (!allowed) relativePath = '/index.html';

  const fullPath = normalize(join(ROOT_DIR, relativePath));
  const root = normalize(ROOT_DIR.endsWith(sep) ? ROOT_DIR : ROOT_DIR + sep);
  if (!fullPath.startsWith(root)) return '';
  return existsSync(fullPath) && statSync(fullPath).isFile() ? fullPath : '';
}

async function readJsonBody(request) {
  let total = 0;
  const chunks = [];
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_JSON_BYTES) throw new Error('request_too_large');
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function validateImages(images) {
  if (!Array.isArray(images)) return [];
  return images.slice(0, 4).map(function (image) {
    const dataUrl = typeof image?.dataUrl === 'string' ? image.dataUrl.trim() : '';
    const fileName = typeof image?.fileName === 'string' ? image.fileName.trim().slice(0, 120) : '';
    return { dataUrl, fileName };
  }).filter(function (image) {
    return /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/i.test(image.dataUrl);
  });
}

function getOpenAIConfig() {
  return {
    responsesUrl: buildOpenAIResponsesUrl(process.env.OPENAI_BASE_URL),
    timeoutMs: parsePositiveInteger(process.env.OPENAI_REQUEST_TIMEOUT_MS, DEFAULT_OPENAI_REQUEST_TIMEOUT_MS, MAX_OPENAI_REQUEST_TIMEOUT_MS),
  };
}

function buildOpenAIResponsesUrl(baseUrl) {
  const rawBaseUrl = String(baseUrl || DEFAULT_OPENAI_BASE_URL).trim() || DEFAULT_OPENAI_BASE_URL;
  const normalizedBaseUrl = rawBaseUrl.endsWith('/') ? rawBaseUrl : rawBaseUrl + '/';
  return new URL(OPENAI_RESPONSES_PATH, normalizedBaseUrl).toString();
}

function parsePositiveInteger(value, fallback, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(Math.floor(number), max);
}

function safeErrorCode(value) {
  return typeof value === 'string' && /^[a-z0-9_.-]+$/i.test(value) ? value : '';
}

function startRequestLog(request, response, route) {
  if (!API_ROUTES.has(route)) return;

  const requestId = safeRequestId(request.headers['x-request-id']) || randomUUID();
  const context = {
    startedAt: Date.now(),
    requestId,
    method: request.method || '',
    route,
  };
  response[REQUEST_LOG_CONTEXT] = context;
  response.setHeader('X-Request-ID', requestId);
  response.once('finish', function () {
    const status = response.statusCode;
    writeStructuredLog({
      level: status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info',
      event: 'request_completed',
      requestId: context.requestId,
      method: context.method,
      route: context.route,
      status,
      durationMs: Date.now() - context.startedAt,
      ...(context.errorCode ? { errorCode: context.errorCode } : {}),
      ...(context.errorType ? { errorType: context.errorType } : {}),
      ...(context.stack ? { stack: context.stack } : {}),
      ...(context.upstream ? { upstream: context.upstream } : {}),
    });
  });
}

function safeRequestId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : '';
}

function captureUnexpectedError(response, error) {
  const context = response[REQUEST_LOG_CONTEXT];
  if (!context) return;
  context.errorType = typeof error?.name === 'string' ? error.name : 'Error';
  if (typeof error?.stack === 'string') {
    context.stack = error.stack.split('\n').slice(1).map(function (line) { return line.trim(); }).filter(Boolean).join('\n');
  }
}

function captureUpstream(response, service, status, startedAt) {
  const context = response[REQUEST_LOG_CONTEXT];
  if (!context) return;
  context.upstream = {
    service,
    status: Number.isInteger(status) ? status : null,
    durationMs: Date.now() - startedAt,
  };
}

function captureUpstreamErrorCode(response, value) {
  const errorCode = safeErrorCode(value);
  const upstream = response[REQUEST_LOG_CONTEXT]?.upstream;
  if (upstream && errorCode) upstream.errorCode = errorCode;
}

function writeStructuredLog(entry) {
  const line = JSON.stringify({ timestamp: new Date().toISOString(), ...entry });
  if (entry.level === 'info') console.log(line);
  else console.error(line);
}

function sendJson(response, status, payload) {
  const context = response[REQUEST_LOG_CONTEXT];
  if (context) context.errorCode = safeErrorCode(payload?.error);
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    ...securityHeaders(),
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  response.end(body);
}

function sendText(response, status, body) {
  response.writeHead(status, {
    ...securityHeaders(),
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  response.end(body);
}

function securityHeaders() {
  return {
    'Content-Security-Policy': CONTENT_SECURITY_POLICY,
    'X-Content-Type-Options': 'nosniff',
  };
}


export async function resolveLocationPayload(payload, env = process.env, fetchImpl = fetch) {
  const latitude = Number(payload?.latitude);
  const longitude = Number(payload?.longitude);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return { status: 400, body: { error: 'invalid_coordinates' } };
  }

  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    return { status: 503, body: { error: 'missing_openai_api_key' } };
  }

  try {
    const response = await fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildLocationRequest({ latitude, longitude }, env.OPENAI_MODEL || 'gpt-5.4-nano')),
    });

    if (!response.ok) {
      return { status: 502, body: { error: 'location_lookup_failed' } };
    }

    const data = await response.json();
    const parsed = parseLocationResponse(data);
    if (!parsed.label) {
      return { status: 502, body: { error: 'location_lookup_failed' } };
    }

    return { status: 200, body: parsed };
  } catch {
    return { status: 502, body: { error: 'location_lookup_failed' } };
  }
}

function buildLocationRequest({ latitude, longitude }, model) {
  return {
    model,
    input: [
      {
        role: 'system',
        content: 'You convert GPS coordinates into a concise city or district label for a travel color diary. Return only city/district-level information. Do not invent exact POIs.',
      },
      {
        role: 'user',
        content: 'Coordinates: ' + latitude + ', ' + longitude + '. Return the nearest recognizable city and district if reasonably confident.',
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'resolved_location',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['city', 'district', 'label', 'confidence'],
          properties: {
            city: { type: 'string' },
            district: { type: 'string' },
            label: { type: 'string' },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          },
        },
      },
    },
    max_output_tokens: 160,
  };
}

function parseLocationResponse(data) {
  const text = data?.output_text || findLocationOutputText(data);
  const parsed = JSON.parse(text || '{}');
  return {
    city: cleanLocationText(parsed.city),
    district: cleanLocationText(parsed.district),
    label: cleanLocationText(parsed.label),
    confidence: ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : 'low',
  };
}

function findLocationOutputText(data) {
  const output = Array.isArray(data?.output) ? data.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (typeof part?.text === 'string') return part.text;
    }
  }
  return '';
}

function cleanLocationText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function contentType(filePath) {
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml; charset=utf-8',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
  };
  return types[extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function loadEnvFile(relativePath) {
  const filePath = join(ROOT_DIR, relativePath);
  if (!existsSync(filePath)) return;

  const content = readFileSync(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key]) continue;
    process.env[key] = unquoteEnvValue(trimmed.slice(separator + 1).trim());
  }
}

function unquoteEnvValue(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}
