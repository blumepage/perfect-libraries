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

test("component cards keep the scan hierarchy in the left column", () => {
  const body = renderer.indexOf('body.name = "Preview and component details"');
  const left = renderer.indexOf("const previewColumn");
  const title = renderer.indexOf("component.name", left);
  const subtitle = renderer.indexOf("component.description ||", title);
  const preview = renderer.indexOf("const gallery = buildCombinationGallery", subtitle);
  const right = renderer.indexOf("const detailsColumn", preview);
  const metrics = renderer.indexOf("addDocumentationMetrics(", right);

  assert.ok(body >= 0);
  assert.ok(body < left);
  assert.ok(left < title);
  assert.ok(title < subtitle);
  assert.ok(subtitle < preview);
  assert.ok(preview < right);
  assert.ok(right < metrics);
  assert.doesNotMatch(
    renderer.slice(0, body),
    /appendDocumentationText\(\s*card/,
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
    /"Component reference",\s*fonts\.heading,\s*18,\s*24,/,
  );
});
