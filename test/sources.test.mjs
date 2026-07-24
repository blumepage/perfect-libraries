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

test("rejects mismatched source names and invalid dimensions", () => {
  const input = sources();
  input.variants[0].scene.name = "Wrong name";
  input.variants[0].scene.width = 0;
  const result = validateSources(input);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("scene.name")));
  assert.ok(result.errors.some((error) => error.includes("width")));
});
