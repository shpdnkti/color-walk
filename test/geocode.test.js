import test from 'node:test';
import assert from 'node:assert/strict';

import { formatReverseGeocodeLabel, normalizeCoordinate } from '../src/geocode.js';

test('formats Chinese reverse geocode results as city plus street', () => {
  const label = formatReverseGeocodeLabel({
    display_name: '武康路, 湖南路街道, 徐汇区, 上海市, 中国',
    address: {
      road: '武康路',
      suburb: '湖南路街道',
      city: '上海市',
      country: '中国',
    },
  });

  assert.equal(label, '上海 武康路');
});

test('falls back to district labels when a street is unavailable', () => {
  const label = formatReverseGeocodeLabel({
    address: {
      city: '北京市',
      district: '东城区',
      country: '中国',
    },
  });

  assert.equal(label, '北京 东城区');
});

test('normalizes valid WGS84 coordinates and rejects invalid input', () => {
  assert.equal(normalizeCoordinate('31.230001', 'lat'), 31.230001);
  assert.equal(normalizeCoordinate('121.472778', 'lon'), 121.472778);
  assert.equal(normalizeCoordinate('91', 'lat'), null);
  assert.equal(normalizeCoordinate('181', 'lon'), null);
});
