import assert from "node:assert/strict";
import test from "node:test";

import { PERFECT_LIBRARIES_SCHEMA } from "../dist/manifest.mjs";
import {
  validateSourceContract,
} from "../dist/source-contract.mjs";
import { PERFECT_LIBRARIES_SOURCES_SCHEMA } from "../dist/sources.mjs";

function fixture() {
  const manifest = {
    $schema: PERFECT_LIBRARIES_SCHEMA,
    version: 1,
    library: {
      id: "dev.example.ui",
      name: "Example UI",
      release: "1.2.0",
    },
    tokenCollections: [
      {
        id: "theme",
        name: "Theme",
        modes: ["Default"],
        tokens: [
          {
            id: "surface",
            name: "Surface",
            type: "COLOR",
            scopes: ["FRAME_FILL"],
            values: { Default: "#ffffff" },
          },
        ],
      },
    ],
    components: [
      {
        id: "icon",
        name: "Icon",
        properties: [
          {
            type: "BOOLEAN",
            name: "Visible",
            layer: "$",
            defaultValue: true,
          },
        ],
        variants: [
          {
            id: "icon-default",
            sourceNode: "Icon / Default",
            properties: { State: "Default" },
          },
        ],
      },
      {
        id: "button",
        name: "Button",
        dependencies: ["icon"],
        properties: [
          {
            type: "TEXT",
            name: "Label",
            layer: "label",
            defaultValue: "Continue",
          },
          {
            type: "INSTANCE_SWAP",
            name: "Icon",
            layer: "icon",
            defaultComponent: "icon",
          },
        ],
        variants: [
          {
            id: "button-primary",
            sourceNode: "Button / Primary",
            properties: { Style: "Primary" },
            bindings: [
              {
                layer: "$",
                property: "fill",
                token: "surface",
              },
            ],
            nestedInstances: [
              {
                layer: "icon",
                component: "icon",
                variant: { State: "Default" },
                properties: { Visible: true },
              },
            ],
          },
        ],
      },
    ],
  };
  const sources = {
    $schema: PERFECT_LIBRARIES_SOURCES_SCHEMA,
    version: 1,
    library: { id: "dev.example.ui", release: "1.2.0" },
    generatedAt: "2026-07-25T10:00:00.000Z",
    variants: [
      {
        id: "icon-default",
        sourceNode: "Icon / Default",
        scene: {
          type: "FRAME",
          name: "Icon / Default",
          width: 16,
          height: 16,
          layoutMode: "NONE",
          fills: [],
          children: [],
        },
      },
      {
        id: "button-primary",
        sourceNode: "Button / Primary",
        scene: {
          type: "FRAME",
          name: "Button / Primary",
          width: 120,
          height: 40,
          layoutMode: "HORIZONTAL",
          fills: [
            {
              type: "SOLID",
              color: { r: 1, g: 1, b: 1 },
            },
          ],
          children: [
            {
              type: "FRAME",
              name: "icon",
              width: 16,
              height: 16,
              layoutMode: "NONE",
              fills: [],
              children: [],
            },
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
  return { manifest, sources };
}

test("accepts exact sources with resolvable declared semantics", () => {
  const { manifest, sources } = fixture();
  const result = validateSourceContract(manifest, sources);
  assert.deepEqual(result, { ok: true, errors: [] });
});

test("requires exact variant coverage and source-node identity", () => {
  const { manifest, sources } = fixture();
  sources.variants[0].sourceNode = "Wrong icon";
  sources.variants.push({
    id: "unexpected",
    sourceNode: "Unexpected",
    scene: {
      type: "FRAME",
      name: "Unexpected",
      width: 10,
      height: 10,
      layoutMode: "NONE",
      children: [],
    },
  });
  const result = validateSourceContract(manifest, sources);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('icon-default')));
  assert.ok(result.errors.some((error) => error.includes('unexpected variant "unexpected"')));
});

test("blocks missing and mistyped component-property layers", () => {
  const { manifest, sources } = fixture();
  manifest.components[1].properties[0].layer = "button/label";
  manifest.components[0].properties[0] = {
    type: "TEXT",
    name: "Text",
    layer: "$",
    defaultValue: "Icon",
  };
  const result = validateSourceContract(manifest, sources);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('layer "button/label" was not found')));
  assert.ok(result.errors.some((error) => error.includes("requires a TEXT layer")));
});

test("blocks incompatible binding targets and token types", () => {
  const { manifest, sources } = fixture();
  manifest.components[1].variants[0].bindings.push({
    layer: "label",
    property: "gap",
    token: "surface",
  });
  sources.variants[1].scene.fills = [];
  const result = validateSourceContract(manifest, sources);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("has no fills paint")));
  assert.ok(result.errors.some((error) => error.includes("requires a FLOAT token")));
  assert.ok(result.errors.some((error) => error.includes("cannot be applied")));
});

test("blocks unresolved nested layers, variants, and properties", () => {
  const { manifest, sources } = fixture();
  const nested = manifest.components[1].variants[0].nestedInstances[0];
  nested.layer = "missing-icon";
  nested.variant = { State: "Missing" };
  nested.properties = { Unknown: "value", Visible: "yes" };
  const result = validateSourceContract(manifest, sources);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('layer "missing-icon" was not found')));
  assert.ok(result.errors.some((error) => error.includes("has no variant matching")));
  assert.ok(result.errors.some((error) => error.includes('unknown property "Unknown"')));
  assert.ok(result.errors.some((error) => error.includes('property "Visible" requires a boolean')));
});
