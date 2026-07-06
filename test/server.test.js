import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveLocationPayload } from '../server.js';

test('resolveLocationPayload rejects missing GPS coordinates', async () => {
  const result = await resolveLocationPayload({}, { OPENAI_API_KEY: 'sk-test' }, async () => {
    throw new Error('fetch should not be called');
  });

  assert.equal(result.status, 400);
  assert.equal(result.body.error, 'invalid_coordinates');
});

test('resolveLocationPayload reports missing OpenAI key without calling upstream', async () => {
  const result = await resolveLocationPayload({ latitude: 22.5431, longitude: 114.0579 }, {}, async () => {
    throw new Error('fetch should not be called');
  });

  assert.equal(result.status, 503);
  assert.equal(result.body.error, 'missing_openai_api_key');
});

test('resolveLocationPayload calls OpenAI Responses API and parses structured location output', async () => {
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          output_text: JSON.stringify({
            city: '深圳',
            district: '南山区',
            label: '深圳南山区',
            confidence: 'high',
          }),
        };
      },
    };
  };

  const result = await resolveLocationPayload(
    { latitude: 22.5431, longitude: 114.0579 },
    { OPENAI_API_KEY: 'sk-test', OPENAI_MODEL: 'gpt-test' },
    fakeFetch,
  );

  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    city: '深圳',
    district: '南山区',
    label: '深圳南山区',
    confidence: 'high',
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.openai.com/v1/responses');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer sk-test');
  const requestBody = JSON.parse(calls[0].options.body);
  assert.equal(requestBody.model, 'gpt-test');
  assert.equal(requestBody.text.format.type, 'json_schema');
  assert.match(JSON.stringify(requestBody.input), /22.5431/);
});

test('resolveLocationPayload maps OpenAI failures to a non-blocking API error', async () => {
  const result = await resolveLocationPayload(
    { latitude: 22.5431, longitude: 114.0579 },
    { OPENAI_API_KEY: 'sk-test' },
    async () => ({ ok: false, status: 429, text: async () => 'rate limited' }),
  );

  assert.equal(result.status, 502);
  assert.equal(result.body.error, 'location_lookup_failed');
});
