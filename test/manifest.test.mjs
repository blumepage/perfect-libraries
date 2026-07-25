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

test("component documentation metadata is accepted and validated", () => {
  const manifest = structuredClone(example);
  manifest.components[0].documentation = {
    groupId: "controls",
    group: "Controls",
    controls: [
      {
        name: "variant",
        type: "select",
        options: ["primary", "secondary"],
        defaultValue: "primary",
      },
    ],
  };

  assert.equal(validateManifest(manifest).ok, true);
  manifest.components[0].documentation.group = "";
  assert.equal(validateManifest(manifest).ok, false);
});

test("malformed component documentation returns errors without throwing", () => {
  const controlsObject = structuredClone(example);
  controlsObject.components[0].documentation = {
    group: "Controls",
    controls: {},
  };
  const invalidOptions = structuredClone(example);
  invalidOptions.components[0].documentation = {
    group: "Controls",
    controls: [{ name: "variant", type: "select", options: [{}] }],
  };

  assert.doesNotThrow(() => validateManifest(controlsObject));
  assert.equal(validateManifest(controlsObject).ok, false);
  assert.equal(validateManifest(invalidOptions).ok, false);
});

test("the built Figma manifest resolves bundle paths beside itself", () => {
  assert.equal(pluginManifest.id, "1662573031327668831");
  assert.equal(pluginManifest.main, "code.js");
  assert.equal(pluginManifest.ui, "ui.html");
  assert.deepEqual(pluginManifest.networkAccess.allowedDomains, [
    "https://ui-libraries.blume-page.com",
    "https://raw.githubusercontent.com",
  ]);
  assert.deepEqual(pluginManifest.networkAccess.devAllowedDomains, [
    "http://localhost:3000",
    "http://localhost:8787",
  ]);
  assert.match(pluginManifest.networkAccess.reasoning, /never uploads/i);
});
