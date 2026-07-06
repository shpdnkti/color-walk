import test from "node:test";
import assert from "node:assert/strict";
import {
  formatAperture,
  formatExifDate,
  formatFocalLength,
  formatIso,
  formatShutterSpeed,
  gpsToDecimal
} from "../src/exif.js";

test("formats EXIF date strings for display and form fields", () => {
  assert.deepEqual(formatExifDate("2026:04:14 09:08:07"), {
    raw: "2026:04:14 09:08:07",
    date: "2026-04-14",
    display: "2026.04.14",
    time: "09:08"
  });
});

test("returns empty date metadata for invalid EXIF dates", () => {
  assert.deepEqual(formatExifDate("not a date"), {
    raw: "",
    date: "",
    display: "",
    time: ""
  });
});

test("converts GPS rationals to signed decimal coordinates", () => {
  assert.equal(gpsToDecimal([{ numerator: 31, denominator: 1 }, { numerator: 13, denominator: 1 }, { numerator: 48, denominator: 1 }], "N"), 31.23);
  assert.equal(gpsToDecimal([{ numerator: 121, denominator: 1 }, { numerator: 28, denominator: 1 }, { numerator: 22, denominator: 1 }], "E"), 121.472778);
  assert.equal(gpsToDecimal([{ numerator: 33, denominator: 1 }, { numerator: 55, denominator: 1 }, { numerator: 0, denominator: 1 }], "S"), -33.916667);
});


test("formats camera exposure metadata for cover text", () => {
  assert.equal(formatAperture({ numerator: 28, denominator: 10 }), "f/2.8");
  assert.equal(formatShutterSpeed({ numerator: 1, denominator: 125 }), "1/125s");
  assert.equal(formatShutterSpeed({ numerator: 2, denominator: 1 }), "2s");
  assert.equal(formatIso(200), "ISO 200");
  assert.equal(formatIso([100, 200]), "ISO 100");
  assert.equal(formatFocalLength({ numerator: 35, denominator: 1 }), "35mm");
});

test("omits invalid camera exposure metadata", () => {
  assert.equal(formatAperture(null), "");
  assert.equal(formatShutterSpeed({ numerator: 1, denominator: 0 }), "");
  assert.equal(formatIso(null), "");
  assert.equal(formatFocalLength(undefined), "");
});
