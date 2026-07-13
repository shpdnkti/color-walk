import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('miniprogram API failures show the response request ID in page status', async () => {
  const page = loadEditorPage({
    statusCode: 503,
    data: { error: 'openai_request_failed' },
    header: { 'X-Request-ID': 'miniprogram-request-42' },
  });
  const instance = {
    ...page,
    data: {
      ...page.data,
      photos: [{
        dataUrl: 'data:image/png;base64,aGVsbG8=',
        fileName: 'sample.png',
        mimeType: 'image/png',
      }],
    },
    setData(patch) {
      this.data = { ...this.data, ...patch };
    },
  };

  await page.analyzePhotosWithAI.call(instance);

  assert.match(instance.data.exportStatus, /请求编号：miniprogram-request-42/);
});

test('miniprogram reverse geocoding failures show the response request ID', async () => {
  const page = loadEditorPage({
    statusCode: 502,
    data: { error: 'reverse_geocode_failed' },
    header: { 'x-request-id': 'geocode-request-42' },
  });
  const instance = {
    ...page,
    data: { ...page.data },
    setData(patch) {
      this.data = { ...this.data, ...patch };
    },
  };

  await page.reverseGeocodePhoto.call(instance, {
    metadata: { latitude: 22.5431, longitude: 114.0579 },
  });

  assert.match(instance.data.exportStatus, /请求编号：geocode-request-42/);
});

function loadEditorPage(response) {
  const source = readFileSync(new URL('../miniprogram/pages/editor/editor.js', import.meta.url), 'utf8');
  let page;
  const sandbox = {
    Page(definition) { page = definition; },
    wx: {
      request(options) { options.success(response); },
      getStorageSync() { return {}; },
      setStorageSync() {},
    },
    console,
    setTimeout,
    clearTimeout,
  };
  const context = vm.createContext(sandbox);
  const load = vm.runInContext('(function (require) {\n' + source + '\n})', context);
  load(function (specifier) {
    if (specifier === '../../config') return { apiBaseUrl: 'https://api.example.test' };
    if (specifier === '../../utils/templates') {
      return {
        copyStyleDefinitions: [{ id: 'poster-english', label: '英文海报' }],
        layoutDefinitions: [],
        panelDefinitions: [],
      };
    }
    if (specifier === '../../utils/transform') {
      return { outputRatioPresets: [{ id: '9:16', width: 1080, height: 1920 }] };
    }
    if (specifier === '../../utils/geocode') {
      return {
        buildReverseGeocodeUrl(baseUrl) { return baseUrl; },
        formatReverseGeocodeLabel() { return ''; },
      };
    }
    return {};
  });
  return page;
}
