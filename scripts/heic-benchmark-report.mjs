import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const COMPARABLE_PATHS = [
  'schemaVersion',
  'fixture.bytes',
  'fixture.sha256',
  'fixture.width',
  'fixture.height',
  'config.runCount',
  'config.pointerdownDelayMs',
  'environment.platform',
  'environment.release',
  'environment.architecture',
  'environment.cpuModel',
  'environment.logicalCpuCount',
  'environment.totalMemoryBytes',
  'environment.node',
  'environment.playwright',
  'environment.chromium',
  'environment.viewport',
];

export function readBaselineReport(path) {
  const report = JSON.parse(readFileSync(path, 'utf8'));
  getBaselineColdMedian(report, path);
  return report;
}

export function getBaselineColdMedian(report, source = 'baseline report') {
  const value = Number(
    report?.cold?.medianFirstEditableMs
    ?? report?.cold?.firstEditablePreviewMedianMs
  );
  assert.ok(
    Number.isFinite(value) && value > 0,
    'Baseline JSON must contain a positive cold median: ' + source
  );
  return value;
}

export function assertComparableBenchmarkReports(baseline, candidate) {
  for (const path of COMPARABLE_PATHS) {
    assert.deepEqual(
      readPath(candidate, path),
      readPath(baseline, path),
      'Benchmark baseline mismatch for ' + path
    );
  }
}

function readPath(value, path) {
  return path.split('.').reduce(function (current, key) {
    return current?.[key];
  }, value);
}
