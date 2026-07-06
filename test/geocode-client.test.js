import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const testDir = dirname(fileURLToPath(import.meta.url));
const appJs = readFileSync(resolve(testDir, '../src/app.js'), 'utf8');

test('client shows a clear message when reverse geocode lookup cannot complete', () => {
  assert.match(appJs, /function reverseGeocodePhoto/);
  assert.ok(appJs.includes('无法反查地点，请检查网络或稍后重试。'));
});
