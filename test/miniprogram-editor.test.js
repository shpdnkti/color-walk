import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = new URL('..', import.meta.url);

function readProjectFile(path) {
  return readFileSync(resolve(root.pathname, path), 'utf8');
}

test('miniprogram editor page exposes the Color Walk editing surface', () => {
  const wxml = readProjectFile('miniprogram/pages/editor/editor.wxml');
  const wxss = readProjectFile('miniprogram/pages/editor/editor.wxss');

  assert.match(wxml, /class="editor-shell"/);
  assert.match(wxml, /bindtap="choosePhotos"/);
  assert.match(wxml, /bindtap="exportPng"/);
  assert.match(wxml, /wx:for="\{\{layoutDefinitions\}\}"/);
  assert.match(wxml, /wx:for="\{\{panelDefinitions\}\}"/);
  assert.match(wxml, /canvas-id="exportCanvas"/);
  assert.match(wxml, /bindtouchstart="handleCanvasTouchStart"/);
  assert.match(wxml, /bindtouchmove="handleCanvasTouchMove"/);
  assert.match(wxml, /bindtouchstart="handlePhotoTouchStart"/);
  assert.match(wxml, /id="placeInput"/);
  assert.match(wxml, /id="titleInput"/);
  assert.match(wxml, /id="bodyInput"/);
  assert.match(wxml, /id="tagsInput"/);

  assert.match(wxss, /\.editor-shell/);
  assert.match(wxss, /\.canvas-stage/);
  assert.match(wxss, /\.poster-card/);
  assert.match(wxss, /\.panel-tabbar/);
  assert.match(wxss, /\.photo-card/);
});

test('miniprogram editor page wires local APIs, shared utilities, drafts, and export', () => {
  const js = readProjectFile('miniprogram/pages/editor/editor.js');

  assert.match(js, /require\('\.\.\/\.\.\/config'\)/);
  assert.match(js, /require\('\.\.\/\.\.\/utils\/color'\)/);
  assert.match(js, /require\('\.\.\/\.\.\/utils\/templates'\)/);
  assert.match(js, /require\('\.\.\/\.\.\/utils\/geocode'\)/);
  assert.match(js, /require\('\.\.\/\.\.\/utils\/draft'\)/);
  assert.match(js, /require\('\.\.\/\.\.\/utils\/transform'\)/);
  assert.match(js, /require\('\.\.\/\.\.\/utils\/exif'\)/);
  assert.match(js, /Page\(\{/);
  assert.match(js, /choosePhotos\(/);
  assert.match(js, /wx\.chooseMedia/);
  assert.match(js, /createPhotoItem\(/);
  assert.match(js, /extractDominantColorFromImage\(/);
  assert.match(js, /readPhotoMetadata\(/);
  assert.match(js, /extractMetadataFromBuffer/);
  assert.match(js, /readPhotoFileBuffer\(/);
  assert.match(js, /savePhotoFile\(/);
  assert.match(js, /wx\.saveFile/);
  assert.match(js, /const \[dominantColor, metadata\] = await Promise\.all/);
  assert.match(js, /const savedSrc = await savePhotoFile\(src\);/);
  assert.match(js, /const mimeType = getPhotoMimeType\(file, imageInfo, src\)/);
  assert.match(js, /mimeType,/);
  assert.match(js, /reverseGeocodePhoto\(/);
  assert.match(js, /buildReverseGeocodeUrl/);
  assert.match(js, /analyzePhotosWithAI\(/);
  assert.match(js, /\/api\/analyze-image/);
  assert.match(js, /startsWith\('data:image\/'\)/);
  assert.match(js, /filePathToDataUrl\(photo\.src, photo\.mimeType\)/);
  assert.match(js, /function normalizeImageMimeType/);
  assert.match(js, /unsupported_image_type/);
  assert.match(js, /image\/heic/);
  assert.match(js, /seedCopy\(/);
  assert.match(js, /generateCopy/);
  assert.match(js, /saveDraft\(/);
  assert.match(js, /restoreDraft\(/);
  assert.match(js, /serializeDraft/);
  assert.match(js, /parseDraft/);
  assert.match(js, /setPhotoTransform\(/);
  assert.match(js, /clampPhotoTransform/);
  assert.match(js, /handleCanvasTouchStart\(/);
  assert.match(js, /handleCanvasTouchMove\(/);
  assert.match(js, /handlePhotoTouchStart\(/);
  assert.match(js, /drawExport\(/);
  assert.match(js, /wx\.canvasToTempFilePath/);
  assert.match(js, /wx\.saveImageToPhotosAlbum/);
});
