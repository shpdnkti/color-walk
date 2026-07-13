import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertColdMedianWithinLimit,
  assertComparableBenchmarkReports,
  getBaselineColdMedian,
} from '../scripts/heic-benchmark-report.mjs';

test('enforces the selected cold first-editable preview limit', () => {
  assert.doesNotThrow(function () { assertColdMedianWithinLimit({ medianFirstEditableMs: 1499.9 }, 1500); });
  assert.throws(
    function () { assertColdMedianWithinLimit({ medianFirstEditableMs: 1500.1 }, 1500); },
    /1500\.1ms exceeded 1500ms/
  );
});

function makeReport() {
  return {
    schemaVersion: 1,
    fixture: {
      bytes: 510794,
      sha256: 'fixture-hash',
      width: 4032,
      height: 3024,
    },
    environment: {
      platform: 'linux',
      release: 'test-release',
      architecture: 'x64',
      cpuModel: 'test-cpu',
      logicalCpuCount: 4,
      totalMemoryBytes: 8_000_000_000,
      node: 'v22.23.1',
      playwright: '1.61.1',
      chromium: '149.0.7827.55',
      viewport: { width: 1024, height: 900, deviceScaleFactor: 1 },
    },
    config: {
      runCount: 5,
      pointerdownDelayMs: 750,
    },
    cold: {
      medianFirstEditableMs: 1800,
    },
  };
}

test('accepts benchmark reports from the same fixture, environment, and run config', () => {
  const baseline = makeReport();
  const candidate = structuredClone(baseline);
  candidate.cold.medianFirstEditableMs = 1100;

  assert.doesNotThrow(function () {
    assertComparableBenchmarkReports(baseline, candidate);
  });
  assert.equal(getBaselineColdMedian(baseline), 1800);
});

test('rejects a baseline from a different fixture', () => {
  const baseline = makeReport();
  const candidate = structuredClone(baseline);
  candidate.fixture.sha256 = 'different-fixture';

  assert.throws(
    function () { assertComparableBenchmarkReports(baseline, candidate); },
    /fixture\.sha256/
  );
});

test('rejects a baseline from a different browser or device', () => {
  const baseline = makeReport();
  const candidate = structuredClone(baseline);
  candidate.environment.chromium = 'different-browser';
  assert.throws(
    function () { assertComparableBenchmarkReports(baseline, candidate); },
    /environment\.chromium/
  );

  candidate.environment.chromium = baseline.environment.chromium;
  candidate.environment.logicalCpuCount = 8;
  assert.throws(
    function () { assertComparableBenchmarkReports(baseline, candidate); },
    /environment\.logicalCpuCount/
  );
});

test('rejects a baseline with a different run count or upload-intent delay', () => {
  const baseline = makeReport();
  const candidate = structuredClone(baseline);
  candidate.config.runCount = 3;
  assert.throws(
    function () { assertComparableBenchmarkReports(baseline, candidate); },
    /config[.]runCount/
  );

  candidate.config.runCount = baseline.config.runCount;
  candidate.config.pointerdownDelayMs = 0;
  assert.throws(
    function () { assertComparableBenchmarkReports(baseline, candidate); },
    /config[.]pointerdownDelayMs/
  );
});
