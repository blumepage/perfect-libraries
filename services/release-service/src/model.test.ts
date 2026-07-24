import assert from "node:assert/strict";
import test from "node:test";

import {
  compareSemver,
  parseFigmaEvent,
  parseReleaseIngest,
  toPublicReleaseFeed,
  type LibraryRelease,
} from "./model.ts";

function manifest(release = "1.2.0"): Record<string, unknown> {
  return {
    $schema:
      "https://raw.githubusercontent.com/blumepage/perfect-libraries/main/schema/perfect-libraries-v1.schema.json",
    version: 1,
    library: {
      id: "dev.example.ui",
      name: "Example UI",
      release,
    },
    tokenCollections: [],
    components: [],
  };
}

test("parses a generic valid release ingest payload", () => {
  const parsed = parseReleaseIngest({
    schemaVersion: 1,
    library: {
      id: "dev.example.ui",
      name: "Example UI",
      figmaFileKey: "Abcdefgh1234",
    },
    release: {
      version: "1.2.0",
      createdAt: "2026-07-24T10:00:00.000Z",
      changelog: "Updated buttons.",
      gitSha: "0123456789abcdef",
      tag: "ui-v1.2.0",
      sourceUrl: "https://example.com/releases/ui-v1.2.0",
      links: {
        storybook: "https://example.com/storybook/",
        review: "https://example.com/review/12",
      },
    },
    manifest: manifest(),
  });
  assert.equal(parsed?.release.version, "1.2.0");
  assert.equal(parsed?.library.id, "dev.example.ui");
});

test("rejects mismatched manifests, unsafe URLs, and malformed identifiers", () => {
  assert.equal(
    parseReleaseIngest({
      schemaVersion: 1,
      library: { id: "!", name: "Example UI" },
      release: {
        version: "latest",
        createdAt: "today",
        changelog: "",
        sourceUrl: "http://example.com",
      },
      manifest: manifest("2.0.0"),
    }),
    null,
  );

  const mismatched = manifest();
  (mismatched.library as Record<string, unknown>).id = "another.library";
  assert.equal(
    parseReleaseIngest({
      schemaVersion: 1,
      library: { id: "dev.example.ui", name: "Example UI" },
      release: {
        version: "1.2.0",
        createdAt: "2026-07-24T10:00:00.000Z",
        changelog: "Mismatch.",
      },
      manifest: mismatched,
    }),
    null,
  );
});

test("creates a plugin-compatible public feed with publication state", () => {
  const release: LibraryRelease = {
    schemaVersion: 1,
    library: { id: "dev.example.ui", name: "Example UI" },
    release: {
      version: "1.2.0",
      status: "published",
      createdAt: "2026-07-24T10:00:00.000Z",
      changelog: "Updated buttons.",
      manifestUrl:
        "https://releases.example.com/v1/libraries/dev.example.ui/releases/1.2.0/manifest",
      published: {
        at: "2026-07-24T11:00:00.000Z",
        by: "Reviewer",
      },
    },
  };

  const feed = toPublicReleaseFeed(release);

  assert.equal(feed.version, 1);
  assert.equal(feed.latest.release, "1.2.0");
  assert.equal(feed.latest.status, "published");
  assert.equal(feed.latest.publishedAt, "2026-07-24T11:00:00.000Z");
});

test("orders semantic versions and prereleases", () => {
  assert.ok(compareSemver("1.2.0", "1.1.9") > 0);
  assert.ok(compareSemver("1.2.0-beta.1", "1.2.0") < 0);
  assert.equal(compareSemver("2.0.0", "2.0.0"), 0);
});

test("parses supported Figma webhook events only", () => {
  assert.equal(
    parseFigmaEvent({
      event_type: "PING",
      passcode: "secret",
      timestamp: "2026-07-24T10:00:00.000Z",
      webhook_id: "22",
    })?.event_type,
    "PING",
  );
  assert.equal(
    parseFigmaEvent({
      event_type: "LIBRARY_PUBLISH",
      passcode: "secret",
      timestamp: "2026-07-24T10:00:00.000Z",
      webhook_id: "23",
      file_key: "Abcdefgh1234",
      file_name: "Example UI",
    })?.event_type,
    "LIBRARY_PUBLISH",
  );
  assert.equal(
    parseFigmaEvent({ event_type: "FILE_UPDATE", passcode: "secret" }),
    null,
  );
});
