import assert from "node:assert/strict";
import test from "node:test";
import {
  isSingleLineSourceText,
  selectSourceFontName,
} from "../dist/source-text.mjs";

const fonts = [
  { fontName: { family: "Inter", style: "Regular" } },
  { fontName: { family: "Inter", style: "Semi Bold" } },
  { fontName: { family: "SN Pro", style: "Regular" } },
  { fontName: { family: "SN Pro", style: "SemiBold" } },
  { fontName: { family: "SN Pro", style: "Bold" } },
  { fontName: { family: "Gelica", style: "Medium" } },
];

test("maps variable webfont family names to installed Figma families", () => {
  assert.deepEqual(
    selectSourceFontName("SN Pro Variable", "SemiBold", fonts),
    { family: "SN Pro", style: "SemiBold" },
  );
  assert.deepEqual(
    selectSourceFontName("Gelica", "Medium", fonts),
    { family: "Gelica", style: "Medium" },
  );
});

test("falls back to the matching family's regular face", () => {
  assert.deepEqual(
    selectSourceFontName("SN Pro Variable", "Unknown", fonts),
    { family: "SN Pro", style: "Regular" },
  );
  assert.equal(
    selectSourceFontName("Missing Variable", "Regular", fonts),
    undefined,
  );
});

test("maps generic browser sans-serif families to Inter without losing weight", () => {
  assert.deepEqual(
    selectSourceFontName("ui-sans-serif", "SemiBold", fonts),
    { family: "Inter", style: "Semi Bold" },
  );
});

test("distinguishes one-line labels from wrapped text", () => {
  assert.equal(
    isSingleLineSourceText({
      characters: "Continue",
      height: 18,
      lineHeight: 20,
    }),
    true,
  );
  assert.equal(
    isSingleLineSourceText({
      characters: "First line\nSecond line",
      height: 40,
      lineHeight: 20,
    }),
    false,
  );
  assert.equal(
    isSingleLineSourceText({
      characters: "Wrapped description",
      height: 42,
      lineHeight: 20,
    }),
    false,
  );
});
