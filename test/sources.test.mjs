import assert from "node:assert/strict";
import test from "node:test";

import {
  PERFECT_LIBRARIES_SOURCES_SCHEMA,
  validateSources,
} from "../dist/sources.mjs";

function sources() {
  return {
    $schema: PERFECT_LIBRARIES_SOURCES_SCHEMA,
    version: 1,
    library: { id: "dev.example.ui", release: "1.2.0" },
    generatedAt: "2026-07-25T10:00:00.000Z",
    variants: [
      {
        id: "button-primary",
        sourceNode: "Button / Primary",
        scene: {
          type: "FRAME",
          name: "Button / Primary",
          width: 120,
          height: 40,
          layoutMode: "HORIZONTAL",
          itemSpacing: 8,
          children: [
            {
              type: "TEXT",
              name: "label",
              width: 80,
              height: 20,
              characters: "Continue",
              fontFamily: "Inter",
              fontStyle: "Regular",
              fontSize: 14,
            },
          ],
        },
      },
    ],
  };
}

test("validates a nested Auto Layout Storybook source bundle", () => {
  const result = validateSources(sources());
  assert.equal(result.ok, true);
  assert.equal(result.sources?.variants[0].scene.layoutMode, "HORIZONTAL");
});

test("validates absolute child positioning and rejects unsupported constraints", () => {
  const input = sources();
  input.variants[0].scene.children[0].layoutPositioning = "ABSOLUTE";
  input.variants[0].scene.children[0].constraints = {
    horizontal: "MAX",
    vertical: "MIN",
  };

  assert.equal(validateSources(input).ok, true);

  input.variants[0].scene.children[0].constraints.horizontal = "RIGHT";
  const invalid = validateSources(input);
  assert.equal(invalid.ok, false);
  assert.ok(
    invalid.errors.some((error) =>
      error.includes("constraints.horizontal is invalid"),
    ),
  );
});

test("validates Auto Layout fill sizing exported from CSS auto margins", () => {
  const input = sources();
  input.variants[0].scene.children[0].layoutSizingHorizontal = "FILL";
  assert.equal(validateSources(input).ok, true);

  input.variants[0].scene.children[0].layoutSizingHorizontal = "STRETCH";
  const invalid = validateSources(input);
  assert.equal(invalid.ok, false);
  assert.ok(
    invalid.errors.some((error) =>
      error.includes("layoutSizingHorizontal is invalid"),
    ),
  );
});

test("rejects mismatched source names and invalid dimensions", () => {
  const input = sources();
  input.variants[0].scene.name = "Wrong name";
  input.variants[0].scene.width = 0;
  const result = validateSources(input);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("scene.name")));
  assert.ok(result.errors.some((error) => error.includes("width")));
});

test("validates gradients, shadows, asymmetric radii, and per-side borders", () => {
  const input = sources();
  Object.assign(input.variants[0].scene, {
    fills: [
      {
        type: "GRADIENT_LINEAR",
        gradientTransform: [[0, -1, 1], [1, 0, 0]],
        gradientStops: [
          { position: 0, color: { r: 0.25, g: 0.24, b: 0.2, a: 1 } },
          { position: 1, color: { r: 0.15, g: 0.13, b: 0.1, a: 1 } },
        ],
      },
    ],
    topLeftRadius: 4,
    topRightRadius: 8,
    bottomRightRadius: 12,
    bottomLeftRadius: 16,
    strokes: [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.1 } }],
    strokeTopWeight: 1,
    strokeRightWeight: 2,
    strokeBottomWeight: 3,
    strokeLeftWeight: 4,
    strokeAlign: "INSIDE",
    effects: [
      {
        type: "INNER_SHADOW",
        color: { r: 1, g: 1, b: 1, a: 0.16 },
        offset: { x: 0, y: 1 },
        radius: 0,
      },
      {
        type: "DROP_SHADOW",
        color: { r: 0.15, g: 0.12, b: 0.05, a: 0.3 },
        offset: { x: 0, y: 1 },
        radius: 2,
        spread: -1,
      },
    ],
  });

  const result = validateSources(input);
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(result.sources?.variants[0].scene.effects.length, 2);
  assert.equal(result.sources?.variants[0].scene.fills[0].type, "GRADIENT_LINEAR");
});

test("rejects malformed gradient stops and shadow effects", () => {
  const input = sources();
  Object.assign(input.variants[0].scene, {
    fills: [
      {
        type: "GRADIENT_LINEAR",
        gradientTransform: [[1, 0], [0, 1, 0]],
        gradientStops: [
          { position: -0.2, color: { r: 2, g: 0, b: 0 } },
        ],
      },
    ],
    effects: [
      {
        type: "DROP_SHADOW",
        color: { r: 0, g: 0, b: 0 },
        offset: { x: "left", y: 1 },
        radius: -1,
      },
    ],
  });

  const result = validateSources(input);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("gradientTransform")));
  assert.ok(result.errors.some((error) => error.includes("at least two stops")));
  assert.ok(result.errors.some((error) => error.includes("offset")));
  assert.ok(result.errors.some((error) => error.includes("radius")));
});

test("validates embedded raster image sources and their geometry", () => {
  const input = sources();
  input.variants[0].scene.children.push({
    type: "IMAGE",
    name: "Avatar",
    width: 32,
    height: 32,
    data: "iVBORw0KGgo=",
    mimeType: "image/png",
    scaleMode: "FIT",
    cornerRadius: 16,
  });

  const result = validateSources(input);
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(result.sources?.variants[0].scene.children[1].type, "IMAGE");
});

test("rejects malformed or unsupported raster image sources", () => {
  const input = sources();
  input.variants[0].scene.children.push({
    type: "IMAGE",
    name: "Avatar",
    width: 32,
    height: 32,
    data: "not base64!",
    mimeType: "image/webp",
    scaleMode: "STRETCH",
  });

  const result = validateSources(input);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes(".data")));
  assert.ok(result.errors.some((error) => error.includes(".mimeType")));
  assert.ok(result.errors.some((error) => error.includes(".scaleMode")));
});
