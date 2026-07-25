import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  hasPendingRelease,
  normalizeReleaseSourceUrl,
  parseReleaseFeed,
  validateReleaseManifest,
} from "../dist/release-feed.mjs";

const manifest = JSON.parse(
  await readFile(new URL("../examples/basic-library.json", import.meta.url), "utf8"),
);
const feed = JSON.parse(
  await readFile(new URL("../examples/release-feed.json", import.meta.url), "utf8"),
);
const feedUrl =
  "https://raw.githubusercontent.com/example/design-system/main/examples/release-feed.json";

test("release feeds resolve relative manifest URLs", () => {
  const result = parseReleaseFeed(feed, feedUrl);

  assert.equal(result.ok, true);
  assert.equal(result.release?.release, "1.0.0");
  assert.equal(result.release?.status, "pending");
  assert.equal(
    result.release?.manifestUrl,
    "https://raw.githubusercontent.com/example/design-system/main/examples/basic-library.json",
  );
});

test("release URLs normalize without browser APIs in the Figma sandbox", () => {
  const originalUrl = globalThis.URL;
  try {
    globalThis.URL = undefined;
    assert.equal(
      normalizeReleaseSourceUrl(
        " https://ui-libraries.blume-page.com/v1/libraries/page.blume.ui/releases/latest ",
      ),
      "https://ui-libraries.blume-page.com/v1/libraries/page.blume.ui/releases/latest",
    );
    assert.equal(
      normalizeReleaseSourceUrl("http://localhost:8787/v1/releases/latest"),
      "http://localhost:8787/v1/releases/latest",
    );
    assert.equal(
      normalizeReleaseSourceUrl("http://example.com/releases/latest"),
      undefined,
    );
  } finally {
    globalThis.URL = originalUrl;
  }
});

test("release feeds reject unknown publication states", () => {
  const invalid = structuredClone(feed);
  invalid.latest.status = "shipping";

  const result = parseReleaseFeed(invalid, feedUrl);

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("latest.status")));
});

test("a direct library manifest can be used as a release source", () => {
  const result = parseReleaseFeed(manifest, feedUrl);

  assert.equal(result.ok, true);
  assert.equal(result.release?.libraryId, "dev.example.starter");
  assert.equal(result.release?.manifest, manifest);
});

test("fetched manifests must match their release feed", () => {
  const result = parseReleaseFeed(feed, feedUrl);
  assert.ok(result.release);
  const wrongManifest = structuredClone(manifest);
  wrongManifest.library.release = "2.0.0";

  const validated = validateReleaseManifest(result.release, wrongManifest);

  assert.equal(validated.ok, false);
  assert.match(validated.errors[0], /does not match feed release/);
});

test("inline manifests must match the feed library", () => {
  const inlineFeed = structuredClone(feed);
  delete inlineFeed.latest.manifestUrl;
  inlineFeed.latest.manifest = structuredClone(manifest);
  inlineFeed.library.id = "another.library";

  const result = parseReleaseFeed(inlineFeed, feedUrl);

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("library.id")));
});

test("a release is pending until that exact release is applied", () => {
  assert.equal(hasPendingRelease(undefined, "1.0.0"), true);
  assert.equal(hasPendingRelease("0.9.0", "1.0.0"), true);
  assert.equal(hasPendingRelease("1.0.0", "1.0.0"), false);
});
