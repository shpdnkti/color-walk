import test from "node:test";
import assert from "node:assert/strict";
import { formatExifDate, gpsToDecimal } from "../src/exif.js";

test("formats EXIF date strings for display and form fields", () => {
  assert.deepEqual(formatExifDate("2026:04:14 09:08:07"), {
    raw: "2026:04:14 09:08:07",
    date: "2026-04-14",
    display: "2026.04.14"
  });
});

test("returns empty date metadata for invalid EXIF dates", () => {
  assert.deepEqual(formatExifDate("not a date"), {
    raw: "",
    date: "",
    display: ""
  });
});

test("converts GPS rationals to signed decimal coordinates", () => {
  assert.equal(gpsToDecimal([{ numerator: 31, denominator: 1 }, { numerator: 13, denominator: 1 }, { numerator: 48, denominator: 1 }], "N"), 31.23);
  assert.equal(gpsToDecimal([{ numerator: 121, denominator: 1 }, { numerator: 28, denominator: 1 }, { numerator: 22, denominator: 1 }], "E"), 121.472778);
  assert.equal(gpsToDecimal([{ numerator: 33, denominator: 1 }, { numerator: 55, denominator: 1 }, { numerator: 0, denominator: 1 }], "S"), -33.916667);
});
