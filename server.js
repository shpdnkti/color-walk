import { createServer as createHttpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createReadStream, readFileSync as fsReadFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const defaultPort = 8080;
const maxBodyBytes = 32 * 1024;

function loadLocalEnv(filePath = join(rootDir, '.env.local')) {
  try {
    const contents = fsReadFileSync(filePath, 'utf8');
    contents.split(/\r?\n/).forEach(function (line) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const separator = trimmed.indexOf('=');
      if (separator === -1) return;
      const key = trimmed.slice(0, separator).trim();
      const rawValue = trimmed.slice(separator + 1).trim();
      if (!key || process.env[key]) return;
      process.env[key] = rawValue.replace(/^['"]|['"]$/g, '');
    });
  } catch {
    // Local env files are optional; Docker Compose can still provide env vars.
  }
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
  const text = data?.output_text || findOutputText(data);
  const parsed = JSON.parse(text || '{}');
  return {
    city: cleanText(parsed.city),
    district: cleanText(parsed.district),
    label: cleanText(parsed.label),
    confidence: ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : 'low',
  };
}

function findOutputText(data) {
  const output = Array.isArray(data?.output) ? data.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (typeof part?.text === 'string') return part.text;
    }
  }
  return '';
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function createServer({ env = process.env, fetchImpl = fetch, baseDir = rootDir } = {}) {
  return createHttpServer(async function (req, res) {
    try {
      if (req.url === '/healthz') {
        sendText(res, 200, 'ok', 'text/plain; charset=utf-8');
        return;
      }

      if (req.url === '/api/resolve-location') {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'method_not_allowed' });
          return;
        }
        const payload = await readJsonBody(req);
        const result = await resolveLocationPayload(payload, env, fetchImpl);
        sendJson(res, result.status, result.body);
        return;
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendText(res, 405, 'Method Not Allowed', 'text/plain; charset=utf-8');
        return;
      }

      await serveStatic(req, res, baseDir);
    } catch {
      sendJson(res, 500, { error: 'internal_server_error' });
    }
  });
}

async function readJsonBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > maxBodyBytes) throw new Error('request too large');
  }
  return body ? JSON.parse(body) : {};
}

async function serveStatic(req, res, baseDir) {
  const url = new URL(req.url || '/', 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = resolve(baseDir, normalize(relativePath));
  if (!filePath.startsWith(resolve(baseDir))) {
    sendText(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
    return;
  }

  try {
    await readFile(filePath);
  } catch {
    sendFile(res, join(baseDir, 'index.html'), req.method);
    return;
  }

  sendFile(res, filePath, req.method);
}

function sendFile(res, filePath, method) {
  res.writeHead(200, {
    'Content-Type': mimeType(filePath),
    'Cache-Control': filePath.endsWith('index.html') ? 'no-store' : 'public, max-age=604800, immutable',
  });
  if (method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(filePath).pipe(res);
}

function sendJson(res, status, payload) {
  sendText(res, status, JSON.stringify(payload), 'application/json; charset=utf-8');
}

function sendText(res, status, text, contentType) {
  res.writeHead(status, { 'Content-Type': contentType });
  res.end(text);
}

function mimeType(filePath) {
  return {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
  }[extname(filePath).toLowerCase()] || 'application/octet-stream';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadLocalEnv();
  const port = Number(process.env.PORT || defaultPort);
  createServer().listen(port, '0.0.0.0', function () {
    console.log('Color Walk server listening on :' + port);
  });
}
