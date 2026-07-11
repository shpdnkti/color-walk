import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

async function readProjectFile(path) {
  return readFile(new URL('../' + path, import.meta.url), 'utf8');
}

async function projectFileExists(path) {
  await access(new URL('../' + path, import.meta.url));
}

test('miniprogram app configuration declares the editor page', async () => {
  const appJson = JSON.parse(await readProjectFile('miniprogram/app.json'));

  assert.ok(Array.isArray(appJson.pages));
  assert.ok(appJson.pages.includes('pages/editor/editor'));
});

test('miniprogram project configuration is safe to open from the repository root', async () => {
  const projectConfig = JSON.parse(await readProjectFile('project.config.json'));

  assert.equal(projectConfig.compileType, 'miniprogram');
  assert.equal(projectConfig.miniprogramRoot, 'miniprogram/');
  assert.ok(projectConfig.appid === '' || /^touristappid$|^wx[a-f0-9]+$/i.test(projectConfig.appid));
  assert.match(projectConfig.projectname, /Color Walk/i);
});

test('editor page JSON exists with the Color Walk title', async () => {
  await projectFileExists('miniprogram/pages/editor/editor.json');

  const editorJson = JSON.parse(await readProjectFile('miniprogram/pages/editor/editor.json'));

  assert.equal(editorJson.navigationBarTitleText, 'Color Walk');
});

test('miniprogram config defines an API base URL', async () => {
  const config = await readProjectFile('miniprogram/config.js');

  assert.match(config, /apiBaseUrl/);
});

test('package exposes miniprogram validation and release scripts', async () => {
  const packageJson = JSON.parse(await readProjectFile('package.json'));

  assert.equal(packageJson.scripts['miniprogram:validate'], 'node scripts/validate-miniprogram.mjs');
  assert.equal(packageJson.scripts['miniprogram:preview'], 'node scripts/upload-miniprogram.mjs preview');
  assert.equal(packageJson.scripts['miniprogram:upload'], 'node scripts/upload-miniprogram.mjs upload');
  assert.equal(packageJson.devDependencies?.['miniprogram-ci'], undefined);
});

test('GitHub workflow validates and can deploy the miniprogram', async () => {
  const workflow = await readProjectFile('.github/workflows/wechat-miniprogram.yml');

  assert.match(workflow, /npx playwright install --with-deps chromium/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /npm run miniprogram:validate/);
  assert.match(workflow, /npm install --no-save miniprogram-ci@2\.1\.31/);
  assert.match(workflow, /WECHAT_MINIPROGRAM_APPID/);
  assert.match(workflow, /WECHAT_MINIPROGRAM_PRIVATE_KEY/);
  assert.match(workflow, /WECHAT_MINIPROGRAM_API_BASE_URL/);
  assert.match(workflow, /exit 1/);
  assert.doesNotMatch(workflow, /available=false/);
});

test('miniprogram validator treats the editor runtime files as required', async () => {
  const validator = await readProjectFile('scripts/validate-miniprogram.mjs');

  assert.match(validator, /requireFile\('miniprogram\/pages\/editor\/editor\.js'\)/);
  assert.match(validator, /requireFile\('miniprogram\/pages\/editor\/editor\.wxml'\)/);
  assert.match(validator, /requireFile\('miniprogram\/pages\/editor\/editor\.wxss'\)/);
  assert.doesNotMatch(validator, /noteOptionalFile\('miniprogram\/pages\/editor\/editor\.(js|wxml|wxss)'\)/);
});

test('miniprogram upload script injects a validated API base URL before publishing', async () => {
  const uploadScript = await readProjectFile('scripts/upload-miniprogram.mjs');
  const readme = await readProjectFile('README.md');

  assert.match(uploadScript, /WECHAT_MINIPROGRAM_API_BASE_URL/);
  assert.match(uploadScript, /normalizeApiBaseUrl/);
  assert.match(uploadScript, /protocol !== 'https:'/);
  assert.match(uploadScript, /writeInjectedConfig/);
  assert.match(uploadScript, /restoreConfig/);
  assert.match(readme, /WECHAT_MINIPROGRAM_API_BASE_URL/);
});
