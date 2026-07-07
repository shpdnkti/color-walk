import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
const validModes = new Set(['preview', 'upload']);

if (!validModes.has(mode)) {
  console.error('Usage: node scripts/upload-miniprogram.mjs <preview|upload>');
  process.exit(1);
}

const appid = process.env.WECHAT_MINIPROGRAM_APPID;
const privateKey = process.env.WECHAT_MINIPROGRAM_PRIVATE_KEY;
let apiBaseUrl = '';

try {
  apiBaseUrl = normalizeApiBaseUrl(process.env.WECHAT_MINIPROGRAM_API_BASE_URL);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const missing = [];
if (!appid) missing.push('WECHAT_MINIPROGRAM_APPID');
if (!privateKey) missing.push('WECHAT_MINIPROGRAM_PRIVATE_KEY');
if (!apiBaseUrl) missing.push('WECHAT_MINIPROGRAM_API_BASE_URL');

if (missing.length > 0) {
  console.error(`Missing required environment variable(s): ${missing.join(', ')}`);
  process.exit(1);
}

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = path.join(rootDir, 'miniprogram/config.js');
const version = process.env.WECHAT_MINIPROGRAM_VERSION || '0.1.0';
const desc = process.env.WECHAT_MINIPROGRAM_DESC || 'Color Walk miniprogram release';
const robot = Number.parseInt(process.env.WECHAT_MINIPROGRAM_ROBOT || '1', 10);

let ciModule;
try {
  ciModule = await import('miniprogram-ci');
} catch (error) {
  console.error('miniprogram-ci is not installed. Run `npm install --no-save miniprogram-ci@2.1.31` before preview/upload, or use the GitHub workflow deploy job.');
  process.exit(1);
}

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'color-walk-miniprogram-'));
const privateKeyPath = path.join(tempDir, 'private.key');
let originalConfig = null;
let configInjected = false;

try {
  await writeFile(privateKeyPath, privateKey, { mode: 0o600 });
  originalConfig = await readFile(configPath, 'utf8');
  await writeInjectedConfig(configPath, apiBaseUrl);
  configInjected = true;

  const ci = ciModule.default ?? ciModule;
  const project = new ci.Project({
    appid,
    type: 'miniProgram',
    projectPath: rootDir,
    privateKeyPath,
    ignores: ['node_modules/**/*', 'test/**/*', '.github/**/*'],
  });

  const options = {
    project,
    robot,
    desc,
    setting: {
      es6: true,
      minify: true,
    },
  };

  if (mode === 'preview') {
    await ci.preview({
      ...options,
      qrcodeFormat: 'terminal',
    });
    console.log('Miniprogram preview generated.');
  } else {
    await ci.upload({
      ...options,
      version,
    });
    console.log(`Miniprogram uploaded version ${version}.`);
  }
} finally {
  if (configInjected && originalConfig !== null) {
    await restoreConfig(configPath, originalConfig);
  }
  await rm(tempDir, { recursive: true, force: true });
}

function normalizeApiBaseUrl(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) return '';

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('WECHAT_MINIPROGRAM_API_BASE_URL must be a valid absolute HTTPS URL.');
  }

  if (url.protocol !== 'https:') {
    throw new Error('WECHAT_MINIPROGRAM_API_BASE_URL must use HTTPS for published miniprograms.');
  }
  url.hash = '';
  url.search = '';
  return url.toString().replace(/\/+$/, '');
}

async function writeInjectedConfig(targetPath, normalizedApiBaseUrl) {
  await writeFile(targetPath, [
    'module.exports = {',
    '  apiBaseUrl: ' + JSON.stringify(normalizedApiBaseUrl) + ',',
    '};',
    '',
  ].join('\n'));
}

async function restoreConfig(targetPath, content) {
  await writeFile(targetPath, content);
}
