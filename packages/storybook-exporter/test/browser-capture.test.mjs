import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { chromium } from "playwright";

const captureScript = await readFile(
  new URL("../src/browser-capture.js", import.meta.url),
  "utf8",
);

async function capture(html, sourceNode) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
    await page.setContent(html);
    await page.addScriptTag({ content: captureScript });
    return await page.evaluate(
      (name) => window.PerfectLibraries.captureSource(name),
      sourceNode,
    );
  } finally {
    await browser.close();
  }
}

test("captures the explicit component root with gradients, shadows, and asymmetric geometry", async () => {
  const svg = encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="currentColor" d="M0 0h16v16H0z"/></svg>',
  );
  const result = await capture(`
    <style>
      #component {
        align-items: center;
        background: linear-gradient(to bottom, color(srgb .25 .24 .2) 0%, color(srgb .15 .13 .1) 100%);
        border-color: color(srgb .1 .2 .3);
        border-style: solid;
        border-width: 1px 2px 3px 4px;
        border-radius: 4px 8px 12px 16px;
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, .16),
          0 1px 2px rgba(38, 30, 12, .3);
        color: color(srgb 1 0 0);
        display: inline-flex;
        gap: 6px;
        height: 40px;
        padding: 0 10px;
      }
    </style>
    <main data-figma-source-node="Button / Primary">
      <div data-figma-source-root="child">
        <button id="component">
          <span data-figma-layer="label">Continue</span>
          <img alt="Leading icon" width="16" height="16" src="data:image/svg+xml,${svg}">
        </button>
      </div>
    </main>
  `, "Button / Primary");

  const scene = result.scene;
  assert.equal(scene.name, "Button / Primary");
  assert.notEqual(scene.children[0].name, "div");
  assert.equal(scene.children[0].name, "label");
  assert.equal(scene.children[1].type, "VECTOR");
  assert.doesNotMatch(scene.children[1].svg, /currentColor/i);
  assert.match(scene.children[1].svg, /rgba\(255, 0, 0, 1\)/);
  assert.equal(scene.fills[0].type, "GRADIENT_LINEAR");
  assert.deepEqual(scene.fills[0].gradientStops.map((stop) => stop.position), [0, 1]);
  assert.equal(scene.effects.length, 2);
  assert.equal(scene.effects[0].type, "INNER_SHADOW");
  assert.equal(scene.effects[1].type, "DROP_SHADOW");
  assert.equal(scene.topLeftRadius, 4);
  assert.equal(scene.topRightRadius, 8);
  assert.equal(scene.bottomRightRadius, 12);
  assert.equal(scene.bottomLeftRadius, 16);
  assert.equal(scene.strokeTopWeight, 1);
  assert.equal(scene.strokeRightWeight, 2);
  assert.equal(scene.strokeBottomWeight, 3);
  assert.equal(scene.strokeLeftWeight, 4);
  assert.equal(scene.strokeAlign, "INSIDE");
  assert.deepEqual(result.warnings, []);
});

test("makes unsupported radial gradients blocking instead of silently dropping them", async () => {
  const result = await capture(`
    <main data-figma-source-node="Radial" data-figma-source-root
      style="width: 32px; height: 32px; background: radial-gradient(circle, red, blue)">
    </main>
  `, "Radial");

  assert.equal(result.scene.fills.length, 0);
  assert.ok(
    result.warnings.some((warning) =>
      warning.includes("unsupported background image"),
    ),
  );
});

test("resolves CSS Color 4 solids instead of dropping them", async () => {
  const result = await capture(`
    <main data-figma-source-node="Color sample" data-figma-source-root
      style="width: 32px; height: 32px; background-color: color(srgb .25 .5 .75 / .5)">
    </main>
  `, "Color sample");

  assert.equal(result.scene.fills[0].type, "SOLID");
  assert.ok(Math.abs(result.scene.fills[0].color.r - 0.25) < 0.01);
  assert.ok(Math.abs(result.scene.fills[0].color.g - 0.5) < 0.01);
  assert.ok(Math.abs(result.scene.fills[0].color.b - 0.75) < 0.01);
  assert.ok(Math.abs(result.scene.fills[0].opacity - 0.5) < 0.01);
});

test("embeds raster images as Figma image sources", async () => {
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const result = await capture(`
    <main data-figma-source-node="Avatar" data-figma-source-root
      style="display:flex;width:40px;height:40px">
      <img alt="Project avatar" width="40" height="40"
        style="border-radius:20px;object-fit:contain"
        src="data:image/png;base64,${png}">
    </main>
  `, "Avatar");

  assert.equal(result.scene.children.length, 1);
  assert.equal(result.scene.children[0].type, "IMAGE");
  assert.equal(result.scene.children[0].mimeType, "image/png");
  assert.equal(result.scene.children[0].data, png);
  assert.equal(result.scene.children[0].scaleMode, "FIT");
  assert.equal(result.scene.children[0].cornerRadius, 20);
  assert.deepEqual(result.warnings, []);
});

test("infers vertical Auto Layout from deterministic normal block flow", async () => {
  const result = await capture(`
    <main data-figma-source-node="Stack" data-figma-source-root
      style="box-sizing:border-box;width:120px;height:68px;padding:8px">
      <div style="height:20px;background:#eee">First</div>
      <div style="height:20px;margin-top:12px;background:#ddd">Second</div>
    </main>
  `, "Stack");

  assert.equal(result.scene.layoutMode, "VERTICAL");
  assert.equal(result.scene.layoutWrap, "NO_WRAP");
  assert.equal(result.scene.paddingTop, 8);
  assert.equal(result.scene.paddingLeft, 8);
  assert.equal(result.scene.paddingRight, 8);
  assert.equal(result.scene.paddingBottom, 8);
  assert.equal(result.scene.itemSpacing, 12);
  assert.deepEqual(result.warnings, []);
});

test("infers wrapping Auto Layout from a deterministic CSS Grid", async () => {
  const result = await capture(`
    <main data-figma-source-node="Grid" data-figma-source-root
      style="box-sizing:border-box;display:grid;grid-template-columns:40px 40px;gap:10px 12px;padding:6px;width:104px;height:62px">
      <div style="height:20px;background:#eee"></div>
      <div style="height:20px;background:#ddd"></div>
      <div style="height:20px;background:#ccc"></div>
      <div style="height:20px;background:#bbb"></div>
    </main>
  `, "Grid");

  assert.equal(result.scene.layoutMode, "HORIZONTAL");
  assert.equal(result.scene.layoutWrap, "WRAP");
  assert.equal(result.scene.paddingTop, 6);
  assert.equal(result.scene.paddingLeft, 6);
  assert.equal(result.scene.itemSpacing, 12);
  assert.equal(result.scene.counterAxisSpacing, 10);
  assert.deepEqual(result.warnings, []);
});

test("keeps overlapping absolute composites as explicit fidelity blockers", async () => {
  const result = await capture(`
    <main data-figma-source-node="Overlap" data-figma-source-root
      style="position:relative;width:60px;height:40px">
      <div style="position:absolute;inset:0 20px 0 0;background:red"></div>
      <div style="position:absolute;inset:0 0 0 20px;background:blue"></div>
    </main>
  `, "Overlap");

  assert.equal(result.scene.layoutMode, "NONE");
  assert.ok(
    result.warnings.some((warning) =>
      warning.includes("cannot become Auto Layout"),
    ),
  );
});

test("preserves top-right overlays inside Auto Layout without adding them to flow", async () => {
  const result = await capture(`
    <main data-figma-source-node="Count badge" data-figma-source-root
      style="box-sizing:border-box;position:relative;display:inline-flex;align-items:center;justify-content:center;width:44px;height:36px;padding:4px">
      <span style="width:16px;height:16px;background:#111"></span>
      <span data-figma-layer="Count"
        style="box-sizing:border-box;position:absolute;right:-4px;top:-3px;display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border-radius:999px;background:#9172f8;color:white;font-size:8px">
        2
      </span>
    </main>
  `, "Count badge");

  assert.equal(result.scene.layoutMode, "HORIZONTAL");
  assert.equal(result.scene.children[1].name, "Count");
  assert.equal(result.scene.children[1].layoutPositioning, "ABSOLUTE");
  assert.deepEqual(result.scene.children[1].constraints, {
    horizontal: "MAX",
    vertical: "MIN",
  });
  assert.equal(result.scene.children[1].x, 34);
  assert.equal(result.scene.children[1].y, -3);
  assert.deepEqual(result.warnings, []);
});

test("preserves CSS auto margins as Figma Auto Layout fill sizing", async () => {
  const result = await capture(`
    <main data-figma-source-node="Pinned status" data-figma-source-root
      style="box-sizing:border-box;display:flex;align-items:center;width:174px;height:60px;padding:12px">
      <span style="display:inline-flex;width:30px;height:30px;background:#9172f8"></span>
      <div style="display:flex;justify-content:flex-end;margin-left:auto;width:50px;height:25px">
        <span style="width:22px;height:22px;background:#111"></span>
      </div>
    </main>
  `, "Pinned status");

  assert.equal(result.scene.children[1].layoutSizingHorizontal, "FILL");
  assert.equal(result.scene.children[1].primaryAxisAlignItems, "MAX");
  assert.deepEqual(result.warnings, []);
});

test("captures exactly one visible document-level portal source", async () => {
  const result = await capture(`
    <main data-figma-source-node="Dialog / Open"
      data-figma-source-selector="[data-perfect-library-source='dialog-open']">
      <p>This wrapper is not part of the component.</p>
    </main>
    <div id="portal-root">
      <section data-perfect-library-source="dialog-open"
        style="box-sizing:border-box;display:flex;width:180px;height:80px;padding:12px;background:white">
        <button>Close</button>
      </section>
    </div>
  `, "Dialog / Open");

  assert.equal(result.scene.name, "Dialog / Open");
  assert.equal(result.scene.width, 180);
  assert.equal(result.scene.children[0].name, "button");
  assert.ok(
    result.scene.children.every((child) => child.characters !== "This wrapper is not part of the component."),
  );
});

test("omits clipped accessibility-only descendants from visual Auto Layout", async () => {
  const result = await capture(`
    <main data-figma-source-node="Tooltip" data-figma-source-root
      style="display:inline-block;padding:4px 8px">
      Open Agents
      <span role="tooltip"
        style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0)">
        Open Agents
      </span>
    </main>
  `, "Tooltip");

  assert.equal(result.scene.children.length, 1);
  assert.equal(result.scene.children[0].type, "TEXT");
  assert.deepEqual(result.warnings, []);
});

test("rejects missing and ambiguous visible portal selectors", async () => {
  await assert.rejects(
    capture(`
      <main data-figma-source-node="Missing"
        data-figma-source-selector="[data-portal='missing']"></main>
    `, "Missing"),
    /must match exactly one visible element; found 0/,
  );
  await assert.rejects(
    capture(`
      <main data-figma-source-node="Ambiguous"
        data-figma-source-selector="[data-portal='duplicate']"></main>
      <div data-portal="duplicate" style="width:10px;height:10px"></div>
      <div data-portal="duplicate" style="width:10px;height:10px"></div>
    `, "Ambiguous"),
    /must match exactly one visible element; found 2/,
  );
});
