import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  PERFECT_LIBRARIES_SCHEMA,
  formatVariantName,
  parseManifestJson,
  validateManifest,
} from "../dist/manifest.mjs";

const example = JSON.parse(
  await readFile(new URL("../examples/basic-library.json", import.meta.url), "utf8"),
);
const pluginManifest = JSON.parse(
  await readFile(new URL("../dist/manifest.json", import.meta.url), "utf8"),
);

test("the published example is a valid v1 manifest", () => {
  const result = validateManifest(example);

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.summary?.collections, 3);
  assert.equal(result.summary?.tokens, 9);
  assert.equal(result.summary?.components, 1);
  assert.equal(result.summary?.variants, 2);
});

test("invalid JSON is reported without throwing", () => {
  const result = parseManifestJson("{ nope");

  assert.equal(result.ok, false);
  assert.match(result.errors[0], /^Invalid JSON:/);
});

test("unknown aliases are rejected", () => {
  const manifest = structuredClone(example);
  manifest.tokenCollections[1].tokens[0].values.Light = {
    alias: "missing-token",
  };

  const result = validateManifest(manifest);

  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((error) => error.includes('unknown alias "missing-token"')),
  );
});

test("unknown binding tokens are rejected", () => {
  const manifest = structuredClone(example);
  manifest.components[0].variants[0].bindings[0].token = "missing-token";

  const result = validateManifest(manifest);

  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((error) =>
      error.includes('references unknown token "missing-token"'),
    ),
  );
});

test("duplicate component and variant ids are rejected", () => {
  const manifest = structuredClone(example);
  const duplicate = structuredClone(manifest.components[0]);
  manifest.components.push(duplicate);

  const result = validateManifest(manifest);

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('duplicate id "button"')));
  assert.ok(
    result.errors.some((error) =>
      error.includes('duplicate id "button-primary-small"'),
    ),
  );
});

test("WEB syntax without var() produces an actionable warning", () => {
  const manifest = structuredClone(example);
  manifest.tokenCollections[0].tokens[0].codeSyntax.WEB = "--white";

  const result = validateManifest(manifest);

  assert.equal(result.ok, true);
  assert.ok(result.warnings.some((warning) => warning.includes("full var(")));
});

test("variant names use Figma's Property=Value convention", () => {
  assert.equal(
    formatVariantName({ Size: "Small", State: "Default" }),
    "Size=Small, State=Default",
  );
});

test("the schema URL is stable", () => {
  assert.equal(
    PERFECT_LIBRARIES_SCHEMA,
    "https://raw.githubusercontent.com/blumepage/perfect-libraries/main/schema/perfect-libraries-v1.schema.json",
  );
});

test("the built Figma manifest resolves bundle paths beside itself", () => {
  assert.equal(pluginManifest.main, "code.js");
  assert.equal(pluginManifest.ui, "ui.html");
  assert.deepEqual(pluginManifest.networkAccess, { allowedDomains: ["none"] });
});
