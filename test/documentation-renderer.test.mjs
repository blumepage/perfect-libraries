import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../src/code.ts", import.meta.url),
  "utf8",
);
const start = source.indexOf("function buildComponentDocumentationCard(");
const end = source.indexOf("\nfunction buildGroupDocumentationRoot(", start);
const renderer = source.slice(start, end);
const layoutStart = source.indexOf("const DOCUMENTATION_ROOT_WIDTH");
const layoutEnd = source.indexOf("\nfunction findManagedPage(", layoutStart);
const layoutConstants = source.slice(layoutStart, layoutEnd);
const dataPanelStart = source.indexOf("function addDocumentationDataPanel(");
const dataPanelEnd = source.indexOf(
  "\nfunction buildCombinationGallery(",
  dataPanelStart,
);
const dataPanelRenderer = source.slice(dataPanelStart, dataPanelEnd);
const guidanceStart = source.indexOf("function addDocumentationGuidance(");
const guidanceEnd = source.indexOf(
  "\nfunction createDocumentationPill(",
  guidanceStart,
);
const guidanceRenderer = source.slice(guidanceStart, guidanceEnd);
const compactGalleryStart = source.indexOf(
  "function useCompactCombinationGallery(",
);
const compactGalleryEnd = source.indexOf(
  "\nfunction buildComponentDocumentationCard(",
  compactGalleryStart,
);
const compactGalleryRenderer = source.slice(
  compactGalleryStart,
  compactGalleryEnd,
);

test("component card columns use the requested three-to-two ratio", () => {
  assert.match(
    layoutConstants,
    /const DOCUMENTATION_ROOT_WIDTH = 2160;/,
  );
  assert.match(
    layoutConstants,
    /const DOCUMENTATION_CARD_WIDTH = 2000;/,
  );
  assert.match(
    layoutConstants,
    /const DOCUMENTATION_COLUMN_UNIT = DOCUMENTATION_COLUMNS_WIDTH \/ 5;/,
  );
  assert.match(
    layoutConstants,
    /const DOCUMENTATION_PREVIEW_WIDTH = DOCUMENTATION_COLUMN_UNIT \* 3;/,
  );
  assert.match(
    layoutConstants,
    /const DOCUMENTATION_DETAILS_WIDTH = DOCUMENTATION_COLUMN_UNIT \* 2;/,
  );
});

test("reference lists render as compact single-line table rows", () => {
  assert.match(
    dataPanelRenderer,
    /rowsGrid\.layoutMode = table \? "VERTICAL" : "HORIZONTAL";/,
  );
  assert.match(
    dataPanelRenderer,
    /rowsGrid\.layoutWrap = table \? "NO_WRAP" : "WRAP";/,
  );
  assert.match(
    dataPanelRenderer,
    /rowWidth =\s*\(rowsWidth - rowGap \* Math\.max\(0, columnCount - 1\)\) \/ columnCount;/,
  );
  assert.match(dataPanelRenderer, /row\.layoutMode = "HORIZONTAL";/);
  assert.match(dataPanelRenderer, /row\.itemSpacing = table \? 0 : 6;/);
  assert.match(
    dataPanelRenderer,
    /const nameWidth = table \? 132 : columnCount === 1 \? 104 : 72;/,
  );
  assert.match(dataPanelRenderer, /fonts\.bodyMedium,\s*8,\s*10,\s*nameWidth,/);
  assert.match(dataPanelRenderer, /fonts\.body,\s*8,\s*10,/);
  assert.match(dataPanelRenderer, /name\.textTruncation = "ENDING";/);
  assert.match(dataPanelRenderer, /name\.maxLines = 1;/);
  assert.match(dataPanelRenderer, /details\.textTruncation = "ENDING";/);
  assert.match(dataPanelRenderer, /details\.maxLines = 1;/);
  assert.match(dataPanelRenderer, /\.replace\(\/\\s\+\/g, " "\)/);
});

test("right-column guidance uses compact eight-pixel list copy", () => {
  assert.match(guidanceRenderer, /fonts\.body,\s*8,\s*12,/);
});

test("component cards keep the scan hierarchy in the left column", () => {
  const body = renderer.indexOf('body.name = "Preview and component details"');
  const left = renderer.indexOf("const previewColumn");
  const title = renderer.indexOf("component.name", left);
  const subtitle = renderer.indexOf("component.description ||", title);
  const preview = renderer.indexOf("const gallery = buildCombinationGallery", subtitle);
  const reference = renderer.indexOf('"Component reference"', preview);
  const metrics = renderer.indexOf("addDocumentationMetrics(", reference);
  const guidance = renderer.indexOf("addDocumentationGuidance(", metrics);
  const right = renderer.indexOf("const detailsColumn", guidance);
  const axes = renderer.indexOf('"Variant axes"', right);

  assert.ok(body >= 0);
  assert.ok(body < left);
  assert.ok(left < title);
  assert.ok(title < subtitle);
  assert.ok(subtitle < preview);
  assert.ok(preview < reference);
  assert.ok(reference < metrics);
  assert.ok(metrics < guidance);
  assert.ok(guidance < right);
  assert.ok(right < axes);
  assert.doesNotMatch(
    renderer.slice(0, body),
    /appendDocumentationText\(\s*card/,
  );
});

test("Storybook controls and actions use a bordered compact table", () => {
  const controls = renderer.indexOf('"Storybook controls & actions"');
  const composition = renderer.indexOf('"Composition"', controls);
  const controlsCall = renderer.slice(controls, composition);
  assert.match(controlsCall, /\{ table: true \},/);
  assert.doesNotMatch(controlsCall, /columns:\s*3/);
  assert.match(
    dataPanelRenderer,
    /const columnCount = table \? 1 : Math\.max\(1, Math\.floor\(columns\)\);/,
  );
  assert.match(dataPanelRenderer, /const rowGap = table \? 0 : 4;/);
  assert.match(
    dataPanelRenderer,
    /rowsGrid\.layoutMode = table \? "VERTICAL" : "HORIZONTAL";/,
  );
  assert.match(
    dataPanelRenderer,
    /rowsGrid\.layoutWrap = table \? "NO_WRAP" : "WRAP";/,
  );
  assert.match(
    dataPanelRenderer,
    /row\.counterAxisSizingMode = table \? "FIXED" : "AUTO";/,
  );
  assert.match(dataPanelRenderer, /const tableRowHeight = 18;/);
  assert.match(
    dataPanelRenderer,
    /row\.resizeWithoutConstraints\(rowWidth, table \? tableRowHeight : 20\);/,
  );
  assert.match(
    dataPanelRenderer,
    /DOCUMENTATION_COLORS\.borderCard,\s*"border-card"/,
  );
  assert.match(
    dataPanelRenderer,
    /setDocumentationRadius\(rowsGrid, 8, "radius-control", variables\);/,
  );
  assert.match(dataPanelRenderer, /rowsGrid\.clipsContent = true;/);
  assert.match(dataPanelRenderer, /row\.strokeBottomWeight = rowIndex === rows\.length - 1 \? 0 : 1;/);
  assert.match(source, /cell\.strokeRightWeight = 1;/);
  assert.match(
    dataPanelRenderer,
    /createDocumentationTypeBadge\(\s*rowDefinition\.type,\s*fonts,\s*variables,\s*true,/,
  );
  assert.match(
    source,
    /badge\.paddingTop = compact \? 1 : 3;[\s\S]*?compact \? 7 : 8,[\s\S]*?compact \? 8 : 10,/,
  );
});

test("component titles and subtitles dominate compact reference text", () => {
  assert.match(renderer, /component\.name,\s*fonts\.heading,\s*72,\s*80,/);
  assert.match(
    renderer,
    /component\.description \|\|[\s\S]*?fonts\.body,\s*28,\s*40,/,
  );
  assert.match(
    renderer,
    /"Component reference",\s*fonts\.heading,\s*14,\s*18,/,
  );
});

test("intrinsically narrow components use grouped one-axis preview rows", () => {
  assert.match(
    compactGalleryRenderer,
    /variant\.width <= DOCUMENTATION_NARROW_SOURCE_MAX_WIDTH/,
  );
  assert.match(
    compactGalleryRenderer,
    /variant\.height <= DOCUMENTATION_NARROW_SOURCE_MAX_HEIGHT/,
  );
  assert.match(
    compactGalleryRenderer,
    /createRepresentativeCombinationGroups\(component\)/,
  );
  assert.match(compactGalleryRenderer, /grid\.layoutWrap = "WRAP";/);
  assert.match(
    compactGalleryRenderer,
    /DOCUMENTATION_COMPACT_GALLERY_MAX_COLUMNS/,
  );
  assert.match(
    compactGalleryRenderer,
    /Math\.ceil\(combinations\.length \/ 2\)/,
  );
  assert.match(
    compactGalleryRenderer,
    /return buildCompactCombinationGallery\(/,
  );
});
