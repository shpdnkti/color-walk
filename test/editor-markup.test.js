import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const testDir = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(testDir, '../index.html'), 'utf8');
const css = readFileSync(resolve(testDir, '../src/styles.css'), 'utf8');
const appJs = readFileSync(resolve(testDir, '../src/app.js'), 'utf8');

test('renders the fixed mobile editor shell from design.md', () => {
  assert.match(html, /class="app-shell editor-shell"/);
  assert.match(html, /class="editor-header"/);
  assert.match(html, /id="canvasStage"/);
  assert.match(html, /id="bottomPanel"/);
  assert.match(html, /id="panelTabBar"/);
  assert.match(html, /id="panelContent"/);
});

test('renders the desktop canvas workspace and persistent control panel shell', () => {
  assert.match(html, /class="[^"]*\bcanvas-viewport\b/);
  assert.match(html, /id="canvasTransform"/);
  assert.match(html, /class="[^"]*\bcanvas-zoom-toolbar\b/);
  assert.match(html, /id="zoomOutButton"/);
  assert.match(html, /id="zoomLevelButton"/);
  assert.match(html, /id="zoomInButton"/);
  assert.match(html, /id="zoomFitButton"/);
  assert.match(html, /id="controlPanel"/);
  assert.match(html, /class="[^"]*\bcontrol-panel\b/);
});

test('defines responsive desktop and mobile editor layout rules', () => {
  assert.match(css, /@media\s*\(min-width:\s*900px\)/);
  assert.match(css, /grid-template-columns:\s*minmax\(0,\s*65fr\)\s*minmax\(360px,\s*35fr\)/);
  assert.match(css, /grid-template-rows:\s*56px\s*minmax\(0,\s*55fr\)\s*minmax\(260px,\s*45fr\)/);
  assert.match(css, /\.canvas-viewport/);
  assert.match(css, /\.control-panel/);
});

test('stacks desktop control panel sections without stretched grid rows', () => {
  assert.match(css, /@media\s*\(min-width:\s*900px\)[\s\S]*?\.panel-content\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex-direction:\s*column;/);
  assert.match(css, /@media\s*\(min-width:\s*900px\)[\s\S]*?\.panel-page,\s*\.panel-page\.active\s*\{[\s\S]*?flex:\s*0\s+0\s+auto;/);
});

test('exposes the required top actions and upload entry point', () => {
  assert.match(html, />重新上传</);
  assert.match(html, />暂存</);
  assert.match(html, />导出图片</);
  assert.match(html, /id="fileInput"/);
});

test('keeps the editor chrome free of colorful emoji labels', () => {
  const chrome = [html, appJs].join('\n');
  assert.doesNotMatch(chrome, /[🎛💾📤📐🎨✍️⚙️🎬📋➕🧩]/u);
  assert.match(html, /class="icon icon-upload"/);
  assert.match(html, /class="icon icon-save"/);
  assert.match(html, /class="icon icon-export"/);
});

test('uses a crisp neutral sans stack for ordinary UI text', () => {
  assert.match(css, /font-family:\s*-apple-system,\s*BlinkMacSystemFont,\s*"Segoe UI",\s*Roboto,\s*"PingFang SC",\s*sans-serif;/);
  assert.match(css, /font-synthesis:\s*none/);
  assert.match(css, /text-rendering:\s*geometricPrecision/);
  assert.match(css, /font-variant-numeric:\s*tabular-nums;/);
});

test('defines the required global canvas CSS variable contract', () => {
  assert.match(css, /:root\s*\{[\s\S]*?--canvas-ratio:\s*9\s*\/\s*16;/);
  assert.match(css, /:root\s*\{[\s\S]*?--image-padding:\s*0px;/);
  assert.match(css, /:root\s*\{[\s\S]*?--image-radius:\s*0px;/);
  assert.match(css, /:root\s*\{[\s\S]*?--text-font-size:\s*24px;/);
  assert.match(css, /:root\s*\{[\s\S]*?--image-scale:\s*1;/);
  assert.match(css, /:root\s*\{[\s\S]*?--image-translate-x:\s*0px;/);
  assert.match(css, /:root\s*\{[\s\S]*?--image-translate-y:\s*0px;/);
});

test('drives preview style from the required CSS variable names', () => {
  assert.match(appJs, /setPreviewVar\('--canvas-ratio'/);
  assert.match(appJs, /setPreviewVar\('--image-padding'/);
  assert.match(appJs, /setPreviewVar\('--image-radius'/);
  assert.match(appJs, /setPreviewVar\('--text-font-size'/);
  assert.match(appJs, /--image-translate-x/);
  assert.match(appJs, /--image-translate-y/);
  assert.doesNotMatch(appJs, /--poster-padding/);
  assert.doesNotMatch(appJs, /--poster-radius/);
  assert.doesNotMatch(appJs, /--poster-title-size/);
  assert.doesNotMatch(appJs, /--image-x/);
  assert.doesNotMatch(appJs, /--image-y/);
});

test('keeps canvas images at natural ratio without fixed image heights', () => {
  assert.match(css, /\.preview-image\s*\{[\s\S]*?aspect-ratio:\s*var\(--raw-ratio,\s*1\);/);
  assert.match(css, /\.preview-image img\s*\{[\s\S]*?width:\s*100%;[\s\S]*?height:\s*auto;[\s\S]*?object-fit:\s*contain;/);
  assert.doesNotMatch(css, /\.layout-movie-poster\s*\{[\s\S]*?height:\s*min\(/);
  assert.doesNotMatch(css, /--poster-padding/);
  assert.doesNotMatch(css, /--poster-radius/);
});

test('restores movie poster CSS variables and borderless behavior', () => {
  assert.match(css, /:root\s*\{[\s\S]*?--movie-color-ratio:\s*50%;/);
  assert.match(css, /:root\s*\{[\s\S]*?--movie-card-ratio:\s*1;/);
  assert.match(css, /:root\s*\{[\s\S]*?--movie-text-color:\s*#ffffff;/);
  assert.match(css, /\.layout-movie-poster/);
  assert.match(css, /\.movie-poster-inner/);
  assert.match(css, /\.movie-color-card/);
  assert.match(css, /\.layout-movie-poster\.borderless/);
  assert.match(appJs, /borderlessMovie/);
  assert.match(appJs, /borderlessInput/);
});

test('uses system-safe fine serif typography for Color Walk overlay text', () => {
  assert.match(css, /\.font-serif\s+\.color-walk-text-overlay\s*\{[\s\S]*?font-family:\s*Georgia,\s*"Songti SC",\s*"SimSun",\s*serif;/);
  assert.match(css, /\.color-walk-text-overlay\s*\{[\s\S]*?letter-spacing:\s*0;/);
  assert.match(css, /\.color-walk-title\s*\{[\s\S]*?font-weight:\s*600;/);
});


test('keeps the visible header brand to Color Walk only', () => {
  assert.match(html, /<div class="editor-brand" aria-label="Color Walk">\s*<h1>Color Walk<\/h1>\s*<\/div>/);
  assert.doesNotMatch(html, /<h1>拼贴编辑器<\/h1>/);
});


test('exposes movie poster controls alongside text controls', () => {
  assert.match(html, />Casual Handwriting</);
  assert.match(html, /id="ratioInput"/);
  assert.match(html, /id="borderlessInput"/);
  assert.match(html, /id="equalRatioButton"/);
  assert.match(html, />色块比例</);
  assert.match(html, />边距切换 Border-less</);
});

test('exposes output ratio segments and resolution feedback in the style panel', () => {
  assert.match(html, /id="ratioPresetBar"/);
  assert.match(html, /data-ratio="3:4"/);
  assert.match(html, /data-ratio="4:5"/);
  assert.match(html, /data-ratio="9:16"/);
  assert.match(html, /data-ratio="2:3"/);
  assert.match(html, /data-ratio="1:2"/);
  assert.match(html, /id="ratioResolution"/);
  assert.match(appJs, /ratioPresets:/);
  assert.match(appJs, /function setOutputRatio/);
});


test('updates the preview accent color from uploaded image colors by default', () => {
  assert.match(appJs, /state\.customColor\s*=\s*getMainColorHex\(\)\s*\|\|\s*state\.customColor/);
});

test('restores movie poster ratio slider and export helpers', () => {
  assert.match(appJs, /ratioInput/);
  assert.match(appJs, /equalRatioButton/);
  assert.match(appJs, /function setEqualMovieRatio/);
  assert.match(appJs, /function getMovieCardRatio/);
  assert.match(appJs, /function getMoviePosterExportHeight/);
  assert.match(appJs, /function drawExportMoviePoster/);
  assert.match(appJs, /--movie-card-ratio/);
});

test('keeps canvas panning and restores movie poster double-click behavior', () => {
  assert.match(appJs, /function toggleMovieColorPosition/);
  assert.match(appJs, /addEventListener\('dblclick',[\s\S]*?toggleMovieColorPosition\(\)/);
  assert.match(appJs, /movieColorOnTop/);
  assert.match(appJs, /function canStartPan\(event\) \{[\s\S]*?if \(isTypingTarget\(event\.target\)\) return false;[\s\S]*?return true;/);
  assert.match(appJs, /els\.canvasViewport\.classList\.add\('is-pannable'\)/);
});

test('binds non-destructive image transform controls inside preview masks', () => {
  assert.match(appJs, /photoTransforms:\s*new Map\(\)/);
  assert.match(appJs, /function bindImageTransformEvents/);
  assert.match(appJs, /--image-scale/);
  assert.match(appJs, /--image-translate-x/);
  assert.match(appJs, /--image-translate-y/);
  assert.match(appJs, /function drawPhotoContain/);
  assert.match(css, /\.preview-image img\s*\{[\s\S]*?transform:/);
  assert.match(css, /\.preview-image\.is-transforming/);
});

test('keeps the canvas zoom toolbar in the lower-right corner by default', () => {
  assert.match(css, /\.canvas-zoom-toolbar\s*\{[\s\S]*?right:\s*16px;[\s\S]*?bottom:\s*12px;[\s\S]*?transform:\s*none;/);
});

test('centers the rendered preview after fitting the canvas viewport', () => {
  assert.match(appJs, /function fitCanvasToViewport\(silent\) \{[\s\S]*?requestAnimationFrame\(centerPreviewInViewport\)/);
  assert.match(appJs, /function centerPreviewInViewport\(\) \{[\s\S]*?previewRect\.left \+ previewRect\.width \/ 2[\s\S]*?viewportRect\.left \+ viewportRect\.width \/ 2[\s\S]*?state\.viewport\.panX \+= deltaX;[\s\S]*?state\.viewport\.panY \+= deltaY;/);
});

test('disables canvas transform transitions while fitting before center correction', () => {
  assert.match(css, /\.canvas-viewport\.is-fitting\s+\.canvas-transform\s*\{[\s\S]*?transition:\s*none;/);
  assert.match(appJs, /els\.canvasViewport\.classList\.add\('is-fitting'\)/);
  assert.match(appJs, /els\.canvasViewport\.classList\.remove\('is-fitting'\)/);
});

test('places typography controls in the copy panel instead of the style panel', () => {
  const copyPanel = html.match(/<section class="panel-page" data-panel="copy"[\s\S]*?<\/section>/)?.[0] || '';
  const stylePanel = html.match(/<section class="panel-page" data-panel="style"[\s\S]*?<\/section>/)?.[0] || '';
  assert.match(copyPanel, /id="fontSizeInput"/);
  assert.match(copyPanel, /id="fontSelect"/);
  assert.doesNotMatch(stylePanel, /id="fontSizeInput"/);
  assert.doesNotMatch(stylePanel, /id="fontSelect"/);
});


test('reframes copy editing around one editable cover text field', () => {
  const copyPanel = html.match(/<section class="panel-page" data-panel="copy"[\s\S]*?<\/section>/)?.[0] || '';
  assert.match(copyPanel, /id="coverTextInput"/);
  assert.match(copyPanel, /<textarea[^>]+id="coverTextInput"/);
  assert.match(copyPanel, />生成封面文字</);
  assert.doesNotMatch(copyPanel, /id="placeInput"/);
  assert.doesNotMatch(copyPanel, /id="dateInput"/);
  assert.doesNotMatch(copyPanel, /id="timeInput"/);
  assert.doesNotMatch(copyPanel, /id="keywordInput"/);
  assert.doesNotMatch(copyPanel, /id="copyStyleSelect"/);
  assert.doesNotMatch(copyPanel, /id="titleInput"/);
  assert.doesNotMatch(copyPanel, /id="subtitleInput"/);
  assert.doesNotMatch(copyPanel, /id="placeTagInput"/);
  assert.doesNotMatch(copyPanel, /id="colorTagsInput"/);
  assert.doesNotMatch(copyPanel, /id="cornerNoteInput"/);
  assert.ok(appJs.includes("coverTextInput: document.querySelector('#coverTextInput')"));
});


test('renders one low-volume cover text block in preview and PNG export', () => {
  assert.match(appJs, /function createColorWalkTextOverlay/);
  assert.match(appJs, /className = 'color-walk-text-overlay'/);
  assert.match(appJs, /function drawExportCoverText/);
  assert.ok(appJs.includes('els.coverTextInput.value'));
  assert.doesNotMatch(appJs, /els\.colorTagsInput/);
  assert.match(css, /\.color-walk-text-overlay\s*\{[\s\S]*?white-space:\s*pre-line;/);
  assert.match(css, /\.color-walk-text-line\s*\{/);
});

test('renders movie poster layout as an explicit selectable code path', () => {
  assert.match(appJs, /layout\.id === 'movie-poster'/);
  assert.match(appJs, /function renderMoviePoster/);
  assert.match(css, /\.layout-movie-poster/);
});

