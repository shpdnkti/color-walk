import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];

async function readText(relativePath) {
  return readFile(path.join(rootDir, relativePath), 'utf8');
}

async function readJson(relativePath) {
  try {
    return JSON.parse(await readText(relativePath));
  } catch (error) {
    errors.push(`${relativePath}: ${error.message}`);
    return undefined;
  }
}

async function requireFile(relativePath) {
  try {
    await access(path.join(rootDir, relativePath));
    return true;
  } catch {
    errors.push(`${relativePath}: required file is missing`);
    return false;
  }
}

function requireEqual(actual, expected, label) {
  if (actual !== expected) {
    errors.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function requireStringIncludes(value, needle, label) {
  if (typeof value !== 'string' || !value.includes(needle)) {
    errors.push(`${label}: expected to include ${JSON.stringify(needle)}`);
  }
}

const appJson = await readJson('miniprogram/app.json');
if (appJson) {
  if (!Array.isArray(appJson.pages) || !appJson.pages.includes('pages/editor/editor')) {
    errors.push('miniprogram/app.json: pages must include "pages/editor/editor"');
  }
}

const projectConfig = await readJson('project.config.json');
if (projectConfig) {
  requireEqual(projectConfig.compileType, 'miniprogram', 'project.config.json compileType');
  requireEqual(projectConfig.miniprogramRoot, 'miniprogram/', 'project.config.json miniprogramRoot');
  if (projectConfig.appid !== '' && projectConfig.appid !== 'touristappid') {
    errors.push('project.config.json appid: keep empty for source control or use touristappid for local preview');
  }
  requireStringIncludes(projectConfig.projectname, 'Color Walk', 'project.config.json projectname');
}

if (await requireFile('miniprogram/pages/editor/editor.json')) {
  const editorJson = await readJson('miniprogram/pages/editor/editor.json');
  if (editorJson) {
    requireEqual(editorJson.navigationBarTitleText, 'Color Walk', 'miniprogram/pages/editor/editor.json navigationBarTitleText');
  }
}

await requireFile('miniprogram/pages/editor/editor.js');
await requireFile('miniprogram/pages/editor/editor.wxml');
await requireFile('miniprogram/pages/editor/editor.wxss');

const configText = await readText('miniprogram/config.js').catch((error) => {
  errors.push(`miniprogram/config.js: ${error.message}`);
  return '';
});
if (!/\bapiBaseUrl\b/.test(configText)) {
  errors.push('miniprogram/config.js: must define apiBaseUrl');
}

const packageJson = await readJson('package.json');
if (packageJson) {
  requireEqual(packageJson.scripts?.['miniprogram:validate'], 'node scripts/validate-miniprogram.mjs', 'package.json scripts.miniprogram:validate');
  requireEqual(packageJson.scripts?.['miniprogram:preview'], 'node scripts/upload-miniprogram.mjs preview', 'package.json scripts.miniprogram:preview');
  requireEqual(packageJson.scripts?.['miniprogram:upload'], 'node scripts/upload-miniprogram.mjs upload', 'package.json scripts.miniprogram:upload');
}

if (errors.length > 0) {
  console.error(`Miniprogram validation failed:\n- ${errors.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log('Miniprogram validation passed.');
}
