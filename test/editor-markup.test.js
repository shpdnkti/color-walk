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

test('collapses poster spacing and radius through variables when Border-less is active', () => {
  assert.match(css, /\.layout-movie-poster\.borderless\s*\{[\s\S]*?--image-padding:\s*0px;[\s\S]*?--image-radius:\s*0px;/);
  assert.match(css, /\.layout-movie-poster\.borderless\s+\.preview-image\s*\{[\s\S]*?margin:\s*0;[\s\S]*?border-radius:\s*0;/);
  assert.match(appJs, /const resolvedPadding = borderlessMovie \? 0 : state\.style\.padding;/);
  assert.match(appJs, /const resolvedRadius = borderlessMovie \? 0 : state\.style\.radius;/);
});

test('uses system-safe serif poster typography with expanded tracking', () => {
  assert.match(css, /\.font-serif\s+\.preview-copy h3,\s*\.font-serif\s+\.movie-title\s*\{[\s\S]*?font-family:\s*Georgia,\s*"Songti SC",\s*"SimSun",\s*serif;[\s\S]*?letter-spacing:\s*0\.15em;/);
});


test('keeps the visible header brand to Color Walk only', () => {
  assert.match(html, /<div class="editor-brand" aria-label="Color Walk">\s*<h1>Color Walk<\/h1>\s*<\/div>/);
  assert.doesNotMatch(html, /<h1>拼贴编辑器<\/h1>/);
});


test('exposes updated movie poster controls from design.md', () => {
  assert.match(html, /id="timeInput"/);
  assert.match(html, /id="ratioInput"/);
  assert.match(html, /id="borderlessInput"/);
  assert.match(html, />Casual Handwriting</);
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


test('supports fluid movie poster sizing after an image is uploaded', () => {
  assert.match(css, /\.layout-movie-poster\.has-photo\s*\{[\s\S]*?height:\s*auto;/);
  assert.match(css, /\.movie-poster-inner\.has-photo\s*\{[\s\S]*?display:\s*flex;/);
  assert.match(css, /\.movie-poster-inner\.has-photo\s+\.movie-color-card\s*\{[\s\S]*?aspect-ratio:\s*var\(--movie-card-ratio\)/);
  assert.match(appJs, /--movie-card-ratio/);
  assert.match(appJs, /fitCanvasToViewport/);
});


test('updates the movie poster color from uploaded image colors by default', () => {
  assert.match(appJs, /state\.customColor\s*=\s*getMainColorHex\(\)\s*\|\|\s*state\.customColor/);
});

test('keeps the movie poster Ratio slider wired to uploaded-photo layout', () => {
  assert.match(appJs, /function getMovieCardRatio\(\) \{[\s\S]*?return photo\.ratio \* \(imageWeight \/ colorWeight\);/);
  assert.match(appJs, /function renderPreview\(\) \{[\s\S]*?--movie-card-ratio[\s\S]*?getMovieCardRatio\(\)/);
  assert.match(appJs, /function applyStyleControls\(\) \{[\s\S]*?--movie-card-ratio[\s\S]*?getMovieCardRatio\(\)/);
  assert.doesNotMatch(appJs, /colorCard\.style\.setProperty\('--movie-card-ratio'/);
});

test('binds movie poster double-click and direct panning to the canvas viewport', () => {
  assert.match(appJs, /els\.canvasViewport\.addEventListener\('dblclick'[\s\S]*?toggleMovieColorPosition\(\)/);
  assert.doesNotMatch(appJs, /els\.previewCanvas\.addEventListener\('dblclick'/);
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

test('adds an equal-size shortcut for the movie poster Ratio control', () => {
  assert.match(html, /id="equalRatioButton"/);
  assert.match(html, />等大<\/button>/);
  assert.match(css, /\.ratio-control-header\s*\{/);
  assert.match(css, /\.equal-ratio-button\s*\{/);
  assert.match(appJs, /equalRatioButton:\s*document\.querySelector\('#equalRatioButton'\)/);
  assert.match(appJs, /els\.equalRatioButton\.addEventListener\('click'[\s\S]*?setEqualMovieRatio\(\)/);
  assert.match(appJs, /function setEqualMovieRatio\(\) \{[\s\S]*?els\.ratioInput\.value = '50';[\s\S]*?state\.style\.ratio = 50;[\s\S]*?applyStyleControls\(\)/);
});

test('keeps the canvas zoom toolbar in the lower-right corner by default', () => {
  assert.match(css, /\.canvas-zoom-toolbar\s*\{[\s\S]*?right:\s*16px;[\s\S]*?bottom:\s*12px;[\s\S]*?transform:\s*none;/);
});

test('styles the equal-size Ratio shortcut as a compact panel control', () => {
  assert.match(css, /\.ratio-control-header\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s*auto;/);
  assert.match(css, /\.equal-ratio-button\s*\{[\s\S]*?display:\s*inline-flex;[\s\S]*?border:\s*1px solid var\(--line\);[\s\S]*?background:\s*#ffffff;/);
});

test('centers the rendered preview after fitting the canvas viewport', () => {
  assert.match(appJs, /function fitCanvasToViewport\(silent\) \{[\s\S]*?requestAnimationFrame\(centerPreviewInViewport\)/);
  assert.match(appJs, /function centerPreviewInViewport\(\) \{[\s\S]*?previewRect\.left \+ previewRect\.width \/ 2[\s\S]*?viewportRect\.left \+ viewportRect\.width \/ 2[\s\S]*?state\.viewport\.panX \+= deltaX;[\s\S]*?state\.viewport\.panY \+= deltaY;/);
});

test('turns off Border-less when radius or padding sliders add spacing', () => {
  assert.match(appJs, /if \(\(state\.style\.radius > 0 \|\| state\.style\.padding > 0\) && state\.style\.borderless\) \{[\s\S]*?state\.style\.borderless = false;[\s\S]*?els\.borderlessInput\.checked = false;/);
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

test('does not reverse uploaded movie poster color-bottom layout twice', () => {
  assert.match(appJs, /else inner\.append\(image, colorCard\)/);
  assert.doesNotMatch(css, /\.movie-poster-inner\.has-photo\.color-bottom\s*\{\s*flex-direction:\s*column-reverse;/);
});



test('wires draggable photo sorting controls in the palette panel', () => {
  assert.match(appJs, /function movePhoto/);
  assert.match(appJs, /card.draggable = true/);
  assert.match(appJs, /dragstart/);
  assert.match(appJs, /drop/);
  assert.match(css, /.photo-card.is-dragging/);
});

test('restores and auto-saves local drafts with image data', () => {
  assert.match(appJs, /restoreDraft/);
  assert.match(appJs, /scheduleDraftSave/);
  assert.match(appJs, /serializeDraft/);
  assert.match(appJs, /parseDraft/);
  assert.match(appJs, /dataUrl/);
});

test('uses a DOM snapshot export path before the canvas fallback', () => {
  assert.match(appJs, /drawPreviewDomToCanvas/);
  assert.match(appJs, /foreignObject/);
  assert.match(appJs, /clonePreviewForExport/);
  assert.ok(appJs.includes('drawExport(ctx, canvas.width, canvas.height)'));
});

test('requests readable place names for GPS metadata', () => {
  assert.match(appJs, /reverseGeocodePhoto/);
  assert.ok(appJs.includes('/api/reverse-geocode'));
  assert.match(appJs, /formatReverseGeocodeLabel/);
});


test('wires real AI image recognition controls into the copy workflow', () => {
  assert.match(html, /id="aiAnalyzeButton"/);
  assert.match(html, />AI识图</);
  assert.match(appJs, /aiAnalyzeButton/);
  assert.match(appJs, /function analyzePhotosWithAI/);
  assert.ok(appJs.includes('/api/analyze-image'));
  assert.match(appJs, /visionInsight/);
});
