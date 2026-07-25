import assert from "node:assert/strict";
import test from "node:test";
import { shouldWarnMissingAutoLayout } from "../dist/source-audit.mjs";

test("warns for a genuine multi-child frame without Auto Layout", () => {
  assert.equal(
    shouldWarnMissingAutoLayout({
      type: "FRAME",
      childCount: 3,
      layoutMode: "NONE",
    }),
    true,
  );
});

test("does not treat SVG artwork wrappers as layout containers", () => {
  assert.equal(
    shouldWarnMissingAutoLayout({
      type: "FRAME",
      childCount: 7,
      layoutMode: "NONE",
      sourceRole: "vector-artwork",
    }),
    false,
  );
});

test("does not warn for single-child or Auto Layout containers", () => {
  assert.equal(
    shouldWarnMissingAutoLayout({
      type: "FRAME",
      childCount: 1,
      layoutMode: "NONE",
    }),
    false,
  );
  assert.equal(
    shouldWarnMissingAutoLayout({
      type: "COMPONENT",
      childCount: 4,
      layoutMode: "HORIZONTAL",
    }),
    false,
  );
});
