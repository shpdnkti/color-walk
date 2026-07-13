import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { chromium } from 'playwright';

import {
  assertColdMedianWithinLimit,
  assertComparableBenchmarkReports,
  getBaselineColdMedian,
  readBaselineReport,
} from './heic-benchmark-report.mjs';

const appRoot = resolve(process.env.COLOR_WALK_HEIC_APP_ROOT || '.');
const { createColorWalkServer } = await import(pathToFileURL(resolve(appRoot, 'server.js')).href);
const fixtureValue = process.env.COLOR_WALK_HEIC_FIXTURE || process.env.COLOR_WALK_HEIC_PERF_FIXTURE || '';
const fixturePath = fixtureValue ? resolve(fixtureValue) : resolve(appRoot, 'test/fixtures/performance-4032x3024.heic');
const runCount = positiveInteger(process.env.COLOR_WALK_HEIC_RUNS || process.env.COLOR_WALK_HEIC_PERF_RUNS, 5);
const timeoutMs = positiveInteger(process.env.COLOR_WALK_HEIC_TIMEOUT_MS || process.env.COLOR_WALK_HEIC_PERF_TIMEOUT_MS, 60_000);
const outputValue = process.env.COLOR_WALK_HEIC_OUTPUT || process.env.COLOR_WALK_HEIC_PERF_OUTPUT || '';
const outputPath = outputValue ? resolve(outputValue) : '';
const baselineValue = process.env.COLOR_WALK_HEIC_BASELINE || process.env.COLOR_WALK_HEIC_PERF_BASELINE || '';
const baselinePath = baselineValue ? resolve(baselineValue) : '';
const baselineReport = baselinePath ? readBaselineReport(baselinePath) : null;
const baselineColdMedian = baselineReport ? getBaselineColdMedian(baselineReport, baselinePath) : 0;
const pointerdownDelayMs = nonNegativeInteger(process.env.COLOR_WALK_HEIC_POINTERDOWN_DELAY_MS || process.env.COLOR_WALK_HEIC_PERF_POINTERDOWN_DELAY_MS, 750);
const requiredReduction = Number(process.env.COLOR_WALK_HEIC_REQUIRED_REDUCTION || 0.3);
const maxFrameGapMs = positiveInteger(process.env.COLOR_WALK_HEIC_MAX_FRAME_GAP_MS, 150);
const maxLongTaskMs = positiveInteger(process.env.COLOR_WALK_HEIC_MAX_LONG_TASK_MS, 150);
const maxColdMedianMs = positiveInteger(process.env.COLOR_WALK_HEIC_MAX_COLD_MEDIAN_MS, 1500);

if (!existsSync(fixturePath)) {
  console.error('HEIC performance fixture not found: ' + fixturePath);
  process.exit(1);
}

const fixtureBuffer = readFileSync(fixturePath);
const app = createColorWalkServer();
const port = await listenOnLocalhost(app);
const coldRuns = [];
const warmRuns = [];
let browserVersion = '';

try {
  for (let index = 0; index < runCount; index += 1) {
    const browser = await chromium.launch();
    try {
      browserVersion ||= browser.version();
      const session = await createBenchmarkPage(browser, port, true);
      try {
        coldRuns.push(await measureUpload(session, fixtureBuffer));
      } finally {
        await session.context.close();
      }
    } finally {
      await browser.close();
    }
  }

  const browser = await chromium.launch();
  try {
    browserVersion ||= browser.version();
    const session = await createBenchmarkPage(browser, port, false);
    try {
      await measureUpload(session, fixtureBuffer);
      await resetEditor(session.page);

      for (let index = 0; index < runCount; index += 1) {
        warmRuns.push(await measureUpload(session, fixtureBuffer));
        if (index < runCount - 1) await resetEditor(session.page);
      }
    } finally {
      await session.context.close();
    }
  } finally {
    await browser.close();
  }
} finally {
  await closeServer(app);
}

const cold = summarize(coldRuns);
const warm = summarize(warmRuns);
const comparison = baselineColdMedian > 0 ? {
  baselineColdMedianMs: baselineColdMedian,
  candidateColdMedianMs: cold.medianFirstEditableMs,
  reduction: round((baselineColdMedian - cold.medianFirstEditableMs) / baselineColdMedian, 4),
  requiredReduction,
} : null;

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  gitCommit: readGitCommit(appRoot),
  appRoot,
  fixture: {
    path: fixturePath,
    bytes: fixtureBuffer.byteLength,
    sha256: createHash('sha256').update(fixtureBuffer).digest('hex'),
    width: 4032,
    height: 3024,
    source: 'deterministic synthetic test pattern without EXIF or location metadata',
  },
  environment: {
    platform: os.platform(),
    release: os.release(),
    architecture: os.arch(),
    cpuModel: os.cpus()[0]?.model || '',
    logicalCpuCount: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    node: process.version,
    playwright: readPackageVersion('playwright'),
    chromium: browserVersion,
    viewport: { width: 1024, height: 900, deviceScaleFactor: 1 },
  },
  config: { runCount, timeoutMs, pointerdownDelayMs, maxFrameGapMs, maxLongTaskMs, maxColdMedianMs },
  cold,
  warm,
  comparison,
};

if (baselineReport) assertComparableBenchmarkReports(baselineReport, report);

const serialized = JSON.stringify(report, null, 2) + '\n';
if (outputPath) writeFileSync(outputPath, serialized);
process.stdout.write(serialized);

assertResponsiveness(cold, 'Cold-cache');
assertResponsiveness(warm, 'Warm-cache');
assertColdMedianWithinLimit(cold, maxColdMedianMs);

if (comparison) {
  assert.ok(
    comparison.reduction >= requiredReduction,
    'Cold-cache median improved by ' + Math.round(comparison.reduction * 100)
      + '%, below the required ' + Math.round(requiredReduction * 100) + '%.'
  );
}

async function createBenchmarkPage(browser, serverPort, clearBrowserCache) {
  const context = await browser.newContext({ viewport: { width: 1024, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const session = { context, page, decoderRequests: 0 };

  page.on('request', function (request) {
    if (request.url().includes('/vendor/libheif/')) session.decoderRequests += 1;
  });
  await page.route('**/api/reverse-geocode**', function (route) {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ label: '基准地点' }),
    });
  });

  if (clearBrowserCache) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.clearBrowserCache');
    await cdp.detach();
  }

  await page.goto('http://127.0.0.1:' + serverPort + '/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(function () { localStorage.clear(); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#fileInput');
  return session;
}

async function measureUpload(session, buffer) {
  const { page } = session;
  const decoderRequestsBefore = session.decoderRequests;
  await installPageProbe(page);
  await page.locator('label[for="fileInput"]').dispatchEvent('pointerdown', {
    button: 0,
    buttons: 1,
    isPrimary: true,
    pointerType: 'mouse',
  });
  await page.waitForTimeout(pointerdownDelayMs);
  await page.setInputFiles('#fileInput', {
    name: 'performance-4032x3024.heic',
    mimeType: 'image/heic',
    buffer,
  });

  await page.waitForFunction(function () {
    return window.__colorWalkHeicBenchmark.firstEditableAt > 0;
  }, null, { timeout: timeoutMs });

  const metrics = await page.evaluate(function () {
    window.__colorWalkHeicBenchmark.stopped = true;
    const probe = window.__colorWalkHeicBenchmark;
    const resources = performance.getEntriesByType('resource')
      .filter(function (entry) { return entry.name.includes('/vendor/libheif/'); })
      .map(function (entry) {
        return {
          name: entry.name.replace(location.origin, ''),
          durationMs: Math.round(entry.duration * 10) / 10,
          transferSize: entry.transferSize,
          encodedBodySize: entry.encodedBodySize,
        };
      });
    return {
      firstEditableMs: Math.round((probe.firstEditableAt - probe.startedAt) * 10) / 10,
      maxAnimationFrameGapMs: Math.round(probe.maxFrameGap * 10) / 10,
      longTasks: probe.longTasks.slice(),
      naturalWidth: probe.naturalWidth,
      naturalHeight: probe.naturalHeight,
      resources,
    };
  });

  await waitForUploadSettled(page);
  metrics.decoderRequests = session.decoderRequests - decoderRequestsBefore;
  return metrics;
}

async function installPageProbe(page) {
  await page.evaluate(function () {
    window.__colorWalkHeicBenchmark = {
      startedAt: 0,
      lastFrameAt: 0,
      maxFrameGap: 0,
      firstEditableAt: 0,
      paintFramesRemaining: 0,
      naturalWidth: 0,
      naturalHeight: 0,
      longTasks: [],
      stopped: false,
    };

    window.addEventListener('change', function startProbe(event) {
      if (event.target?.id !== 'fileInput') return;
      const probe = window.__colorWalkHeicBenchmark;
      probe.startedAt = performance.now();
      probe.lastFrameAt = probe.startedAt;

      if (typeof PerformanceObserver === 'function') {
        try {
          const observer = new PerformanceObserver(function (list) {
            list.getEntries().forEach(function (entry) {
              if (entry.startTime >= probe.startedAt) {
                probe.longTasks.push({
                  startMs: Math.round((entry.startTime - probe.startedAt) * 10) / 10,
                  durationMs: Math.round(entry.duration * 10) / 10,
                });
              }
            });
          });
          observer.observe({ type: 'longtask', buffered: true });
        } catch {
          // Long Task entries are optional; the animation-frame gap is always recorded.
        }
      }

      requestAnimationFrame(function recordFrame(now) {
        probe.maxFrameGap = Math.max(probe.maxFrameGap, now - probe.lastFrameAt);
        probe.lastFrameAt = now;
        if (probe.paintFramesRemaining > 0) {
          probe.paintFramesRemaining -= 1;
          if (probe.paintFramesRemaining === 0) probe.firstEditableAt = now;
        } else if (!probe.firstEditableAt) {
          const image = document.querySelector('.preview-image.has-photo img');
          const cropControl = document.querySelector('.photo-card .photo-crop-slider');
          const isEditable = image?.naturalWidth > 0
            && image?.naturalHeight > 0
            && cropControl
            && !cropControl.disabled;
          if (isEditable) {
            probe.naturalWidth = image.naturalWidth;
            probe.naturalHeight = image.naturalHeight;
            probe.paintFramesRemaining = 2;
          }
        }
        if (!probe.stopped) requestAnimationFrame(recordFrame);
      });
    }, { capture: true, once: true });
  });
}

async function waitForUploadSettled(page) {
  await page.waitForFunction(function () {
    const status = document.querySelector('#exportStatus')?.textContent || '';
    return status.startsWith('已完成') || status.startsWith('HEIC/HEIF 图片读取失败') || status.startsWith('图片读取失败');
  }, null, { timeout: timeoutMs });
}

async function resetEditor(page) {
  page.once('dialog', function (dialog) { void dialog.accept(); });
  await page.click('#resetButton');
  await page.waitForFunction(function () {
    return document.querySelectorAll('.photo-card').length === 0
      && !document.querySelector('.preview-image.has-photo img');
  });
}

function summarize(runs) {
  return {
    medianFirstEditableMs: median(runs.map(function (run) { return run.firstEditableMs; })),
    medianMaxAnimationFrameGapMs: median(runs.map(function (run) { return run.maxAnimationFrameGapMs; })),
    maxAnimationFrameGapMs: round(Math.max(0, ...runs.map(function (run) { return run.maxAnimationFrameGapMs; })), 1),
    maxLongTaskMs: round(Math.max(0, ...runs.flatMap(function (run) {
      return run.longTasks.map(function (task) { return task.durationMs; });
    })), 1),
    runs,
  };
}

function assertResponsiveness(summary, label) {
  assert.ok(
    summary.maxAnimationFrameGapMs <= maxFrameGapMs,
    label + ' maximum animation-frame gap ' + summary.maxAnimationFrameGapMs
      + 'ms exceeded ' + maxFrameGapMs + 'ms.'
  );
  assert.ok(
    summary.maxLongTaskMs <= maxLongTaskMs,
    label + ' maximum Long Task ' + summary.maxLongTaskMs
      + 'ms exceeded ' + maxLongTaskMs + 'ms.'
  );
}

function median(values) {
  const sorted = values.slice().sort(function (left, right) { return left - right; });
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : round((sorted[middle - 1] + sorted[middle]) / 2, 1);
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function nonNegativeInteger(value, fallback) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readGitCommit(root) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function readPackageVersion(name) {
  try {
    return JSON.parse(readFileSync(resolve('node_modules', name, 'package.json'), 'utf8')).version || '';
  } catch {
    return '';
  }
}

function listenOnLocalhost(server) {
  return new Promise(function (resolvePort, reject) {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', function () {
      server.removeListener('error', reject);
      resolvePort(server.address().port);
    });
  });
}

function closeServer(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise(function (resolveClose, reject) {
    server.close(function (error) {
      if (error) reject(error);
      else resolveClose();
    });
  });
}
