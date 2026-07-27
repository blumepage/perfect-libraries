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
  assert.match(dataPanelRenderer, /rowsGrid\.layoutMode = "HORIZONTAL";/);
  assert.match(dataPanelRenderer, /rowsGrid\.layoutWrap = "WRAP";/);
  assert.match(
    dataPanelRenderer,
    /rowWidth =\s*\(rowsWidth - rowGap \* Math\.max\(0, columnCount - 1\)\) \/ columnCount;/,
  );
  assert.match(dataPanelRenderer, /row\.layoutMode = "HORIZONTAL";/);
  assert.match(dataPanelRenderer, /row\.itemSpacing = 6;/);
  assert.match(
    dataPanelRenderer,
    /const nameWidth = columnCount === 1 \? 104 : 72;/,
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

test("Storybook controls and actions use three compact columns", () => {
  const controls = renderer.indexOf('"Storybook controls & actions"');
  const composition = renderer.indexOf('"Composition"', controls);
  const controlsCall = renderer.slice(controls, composition);
  assert.match(controlsCall, /\{ columns: 3 \},/);
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
