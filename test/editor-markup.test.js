import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const testDir = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(testDir, '../index.html'), 'utf8');
const css = readFileSync(resolve(testDir, '../src/styles.css'), 'utf8');
const appJs = readFileSync(resolve(testDir, '../src/app.js'), 'utf8');
const draftJs = readFileSync(resolve(testDir, '../src/draft.js'), 'utf8');

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
  assert.match(html, />重置</);
  assert.doesNotMatch(html, />重新上传</);
  assert.match(html, />暂存</);
  assert.match(html, />导出图片</);
  assert.match(html, /id="fileInput"/);
});

test('file picker explicitly accepts HEIC and HEIF uploads', () => {
  assert.match(html, /accept="[^"]*\.heic[^"]*\.heif[^"]*\.hif[^"]*image\/heic[^"]*image\/heif[^"]*image\/heic-sequence[^"]*image\/heif-sequence[^"]*"/);
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
  assert.match(css, /\.preview-image img\s*\{[\s\S]*?--image-fit-width[\s\S]*?--image-fit-height[\s\S]*?object-fit:\s*contain;/);
  assert.match(appJs, /function applyPhotoFitVarsToElement[\s\S]*?--image-fit-width[\s\S]*?--image-fit-height/);
  assert.doesNotMatch(css, /--image-(?:cover|contain)-(?:width|height)/);
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


test('exposes focused movie poster controls with readable labels and ratio value', () => {
  assert.match(html, />Casual Handwriting</);
  assert.match(html, /id="ratioInput"[^>]+data-range-output="#ratioValue"[^>]+data-range-unit="%"/);
  assert.match(html, /id="ratioValue"/);
  assert.match(html, /id="borderlessInput"/);
  assert.match(html, /id="equalRatioButton"/);
  assert.match(html, />色块比例</);
  assert.match(html, />无边距铺满</);
  assert.doesNotMatch(html, /Border-less/);
  assert.ok(appJs.includes("ratioValue: document.querySelector('#ratioValue')"));
  assert.ok(appJs.includes("els.ratioValue.textContent = state.style.ratio + '%'"));
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


test('keeps uploaded movie poster preview and export driven by output ratio', () => {
  assert.match(css, /\.layout-movie-poster\.has-photo\s*\{[\s\S]*?aspect-ratio:\s*var\(--canvas-ratio\)/);
  assert.match(css, /\.movie-poster-inner\.has-photo\s*\{[\s\S]*?display:\s*grid;[\s\S]*?height:\s*100%;/);
  assert.match(appJs, /function getMoviePosterExportHeight\(width\) \{\s*return getOutputExportHeight\(width\);\s*\}/);
});


test('refits the viewport after output ratio changes', () => {
  assert.match(appJs, /function setOutputRatio\(id\) \{[\s\S]*?renderPreview\(\);[\s\S]*?requestAnimationFrame\(function \(\) \{ fitCanvasToViewport\(true\); \}\);[\s\S]*?输出比例已切换为/);
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

test('keeps movie poster preview and fallback export on the same contain baseline', () => {
  assert.match(appJs, /function drawExportMoviePoster[\s\S]*?drawPhotoContain\(/);
  assert.match(appJs, /function drawPhotoContain[\s\S]*?clampPhotoTransformToFit/);
  assert.match(appJs, /function drawImageContain[\s\S]*?ctx\.rect\(x, y, w, h\);[\s\S]*?ctx\.clip\(\)/);
  assert.doesNotMatch(appJs, /drawPhotoCover/);
});

test('exposes discoverable per-photo crop controls from the palette photo cards', () => {
  assert.match(appJs, /function createPhotoCropControls/);
  assert.match(appJs, /className = 'photo-crop-controls'/);
  assert.match(appJs, /className = 'photo-crop-button'/);
  assert.match(appJs, /className = 'photo-crop-slider'/);
  assert.match(appJs, /slider\.min = String\(Math\.round\(\(PHOTO_SCALE_MIN - 1\) \* 100\)\)/);
  assert.match(appJs, /setPhotoCropScale\(photo\.id, 1 \+ Number\(slider\.value\) \/ 100\)/);
  assert.match(appJs, /function formatPhotoCropPercent/);
  assert.match(appJs, /data-crop-action/);
  assert.match(appJs, /aria-label', '调整 .* 裁切缩放/);
  assert.match(appJs, /createPhotoCropButton\(photo, 'reset'[\s\S]*?'重置 ' \+ photo\.fileName \+ ' 裁切'/);
});


test('prevents crop slider interactions from starting photo card drag', () => {
  assert.match(appJs, /function setPhotoCardDragEnabled/);
  assert.match(appJs, /closest\('\.photo-card'\)/);
  assert.match(appJs, /controls\.addEventListener\('pointerdown'[\s\S]*?setPhotoCardDragEnabled\(controls, false\)/);
  assert.match(appJs, /controls\.addEventListener\('pointerup'[\s\S]*?setPhotoCardDragEnabled\(controls, true\)/);
  assert.match(appJs, /event\.preventDefault\(\);[\s\S]*?event\.stopPropagation\(\);/);
});

test('wires per-photo crop controls to transform state and preview refresh', () => {
  assert.match(appJs, /function setPhotoCropScale\(photoId, scale\)/);
  assert.match(appJs, /function resetPhotoTransform\(photoId\)/);
  assert.match(appJs, /function applyPhotoTransformToPreviewInstances\(photoId\)/);
  assert.match(appJs, /setPhotoTransform\(photoId, \{\s*scale,\s*x: transform\.x,\s*y: transform\.y,\s*\}\)/);
  assert.match(appJs, /state\.photoTransforms\.delete\(photoId\)/);
  assert.match(appJs, /querySelectorAll\('\.preview-image\[data-photo-id="' \+ cssEscape\(photoId\) \+ '"\]'\)/);
});

test('styles photo crop controls as compact card-level editing controls', () => {
  assert.match(css, /\.photo-thumb\s*\{/);
  assert.match(css, /\.photo-crop-controls\s*\{/);
  assert.match(css, /\.photo-crop-button\s*\{/);
  assert.match(css, /\.photo-crop-slider\s*\{/);
  assert.match(css, /\.photo-crop-value\s*\{/);
  assert.match(css, /\.photo-crop-button:focus-visible/);
});

test('shows live numeric values for the font size slider', () => {
  assert.match(html, /id="fontSizeValue"/);
  assert.match(html, /src="src\/app\.js\?v=[^"]+"/);
  assert.match(html, /id="fontSizeInput"[^>]+data-range-output="#fontSizeValue"[^>]+data-range-unit="px"/);
  assert.match(html, /function bindRangeValueOutputs\(\)/);
  assert.match(html, /addEventListener\('input', sync\)/);
  assert.match(html, /addEventListener\('change', sync\)/);
  assert.match(appJs, /fontSizeValue: document\.querySelector\('#fontSizeValue'\)/);
  assert.match(appJs, /function syncRangeValueOutputs\(\)/);
  assert.match(appJs, /function handleStyleRangeInput/);
  assert.match(appJs, /addEventListener\('change', handleStyleRangeInput\)/);
  assert.match(appJs, /els\.fontSizeValue\.textContent = state\.style\.fontSize \+ 'px'/);
  assert.match(css, /\.range-value/);
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


test('reframes copy editing around one editable cover text field and one generate action', () => {
  const copyStart = html.indexOf('<section class="panel-page" data-panel="copy"');
  const copyEnd = html.indexOf('<section class="panel-page" data-panel="style"');
  const copyPanel = copyStart >= 0 && copyEnd > copyStart ? html.slice(copyStart, copyEnd) : '';
  assert.match(copyPanel, /id="coverTextInput"/);
  assert.match(copyPanel, /<textarea[^>]+id="coverTextInput"/);
  assert.match(copyPanel, /id="copyGenerateButton"/);
  assert.match(copyPanel, />生成封面文字</);
  assert.doesNotMatch(copyPanel, /id="aiAnalyzeButton"/);
  assert.doesNotMatch(copyPanel, />AI识图</);
  assert.doesNotMatch(copyPanel, /id="copyTextButton"/);
  assert.doesNotMatch(copyPanel, />复制文字</);
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


test('removes the palette photo grid empty guidance card', () => {
  assert.doesNotMatch(html, /上传 1 到 9 张照片后/);
  assert.doesNotMatch(appJs, /上传 1 到 9 张照片后/);
  assert.match(appJs, /els\.photoGrid\.className = 'photo-grid is-empty'/);
  assert.match(appJs, /els\.photoGrid\.innerHTML = ''/);
  assert.doesNotMatch(css, /\.empty-state\s*\{/);
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

test('limits the editor to the movie poster layout', () => {
  assert.match(html, /id="layoutHint">电影海报</);
  assert.match(html, /layout-movie-poster/);
  assert.doesNotMatch(html, /id="layoutControls"/);
  assert.doesNotMatch(html, /拼贴结构/);
  assert.doesNotMatch(html, /纯九宫格|上下结构|杂志拼贴|色卡海报/);
  assert.match(appJs, /selectedLayout:\s*'movie-poster'/);
  assert.match(appJs, /function renderMoviePoster/);
  assert.match(appJs, /function normalizeActivePanel/);
  assert.match(appJs, /state\.activePanel = normalizeActivePanel\(draft\.activePanel\)/);
  assert.match(css, /\.layout-movie-poster/);
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

test('wires a manual local draft clear action that preserves the current editor', () => {
  assert.match(html, /id="clearDraftButton"/);
  assert.match(html, />清除草稿</);
  assert.match(appJs, /clearDraftButton/);
  assert.match(appJs, /addEventListener\('click', clearSavedDraft\)/);
  assert.match(appJs, /function clearSavedDraft/);
  assert.match(appJs, /clearTimeout\(draftSaveTimer\)/);
  assert.match(appJs, /localStorage\.removeItem\(DRAFT_STORAGE_KEY\)/);
  assert.match(appJs, /当前画布保留/);
  assert.match(css, /\.clear-draft-action/);
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


test('wires one smart cover text generation action into the copy workflow', () => {
  assert.match(html, /id="copyGenerateButton"/);
  assert.match(html, />生成封面文字</);
  assert.doesNotMatch(html, /id="aiAnalyzeButton"/);
  assert.doesNotMatch(html, />AI识图</);
  assert.doesNotMatch(appJs, /aiAnalyzeButton/);
  assert.match(appJs, /copyGenerateButton/);
  assert.match(appJs, /function generateCoverTextAction/);
  assert.match(appJs, /function analyzePhotosWithAI/);
  assert.ok(appJs.includes('/api/analyze-image'));
  assert.match(appJs, /visionInsight/);
});


test('wires draggable palette swatch ordering into preview and drafts', () => {
  assert.match(appJs, /paletteOrder/);
  assert.match(appJs, /draggedColorIndex/);
  assert.match(appJs, /function movePaletteColor/);
  assert.match(appJs, /swatch.draggable = true/);
  assert.match(css, /palette-swatch.is-dragging/);
  assert.ok(appJs.includes('paletteOrder: state.paletteOrder'));
  assert.ok(appJs.includes('state.paletteOrder = draft.paletteOrder'));
});

test('wires per-swatch size controls into preview, export, and drafts', () => {
  assert.match(appJs, /paletteWeights/);
  assert.match(appJs, /function setPaletteColorWeight/);
  assert.match(appJs, /data-palette-size-action/);
  assert.match(appJs, /swatch\.style\.flexGrow = String\(getPaletteColorWeight\(hex\)\)/);
  assert.match(appJs, /drawPalette\(ctx, x, y, w, h, vertical\)/);
  assert.match(appJs, /getPaletteSizeSegments\(colors, vertical \? h : w\)/);
  assert.ok(appJs.includes('paletteWeights: state.paletteWeights'));
  assert.ok(appJs.includes('state.paletteWeights = draft.paletteWeights'));
  assert.ok(draftJs.includes('paletteWeights: normalizePaletteWeights(input.paletteWeights)'));
  assert.match(css, /\.palette-size-controls/);
});
