import assert from "node:assert/strict";
import test from "node:test";

import {
  localDiagnosticUrlForReleaseSource,
  missingSourceContextError,
  selectReleaseSourcesUrl,
} from "../dist/source-resolution.mjs";

const cachedRelease = {
  libraryId: "page.blume.ui",
  libraryName: "Blume UI",
  release: "1.1.1",
  changelog: "Local preview",
  sourcesUrl: "http://localhost:3000/perfect-libraries-sources.json",
};

test("action-bound source URL survives independently of cached release state", () => {
  assert.equal(
    selectReleaseSourcesUrl({
      libraryId: "page.blume.ui",
      release: "1.1.1",
      requestedSourcesUrl:
        "http://localhost:3000/perfect-libraries-sources.json",
    }),
    "http://localhost:3000/perfect-libraries-sources.json",
  );
});

test("diagnostics stay on the configured local release origin", () => {
  assert.equal(
    localDiagnosticUrlForReleaseSource(
      "http://localhost:3000/release-feed.json",
    ),
    "http://localhost:3000/plugin-report",
  );
  assert.equal(
    localDiagnosticUrlForReleaseSource(
      "http://localhost:8787/v1/libraries/example",
    ),
    "http://localhost:8787/plugin-report",
  );
  assert.equal(
    localDiagnosticUrlForReleaseSource(
      "http://127.0.0.1:8787/v1/libraries/example",
    ),
    undefined,
  );
  assert.equal(
    localDiagnosticUrlForReleaseSource(
      "http://localhost:9999/v1/libraries/example",
    ),
    undefined,
  );
  assert.equal(
    localDiagnosticUrlForReleaseSource(
      "https://ui-libraries.blume-page.com/v1/libraries/example",
    ),
    undefined,
  );
});

test("matching cached release remains a backwards-compatible fallback", () => {
  assert.equal(
    selectReleaseSourcesUrl({
      libraryId: "page.blume.ui",
      release: "1.1.1",
      cachedRelease,
    }),
    cachedRelease.sourcesUrl,
  );
  assert.equal(
    selectReleaseSourcesUrl({
      libraryId: "page.blume.ui",
      release: "2.0.0",
      cachedRelease,
    }),
    undefined,
  );
});

test("missing release context produces one actionable source error", () => {
  assert.equal(
    missingSourceContextError(118),
    "No rendered source bundle is attached to this manifest, and none of its 118 source frames exist on the current page. Load the manifest from its release feed or import its source frames before inspecting.",
  );
});
