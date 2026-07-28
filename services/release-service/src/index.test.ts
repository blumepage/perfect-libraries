import assert from "node:assert/strict";
import test from "node:test";

import { handleRequest } from "./index.ts";
import type { PublicReleaseFeed } from "./model.ts";

class MemoryKv {
  readonly values = new Map<string, string>();
  readonly puts: Array<{ key: string; value: string }> = [];

  async get<T = string>(key: string, type?: "json"): Promise<T | string | null> {
    const value = this.values.get(key);
    if (value === undefined) return null;
    return type === "json" ? (JSON.parse(value) as T) : value;
  }

  async put(key: string, value: string): Promise<void> {
    this.puts.push({ key, value });
    this.values.set(key, value);
  }
}

function env(kv = new MemoryKv()): Env {
  return {
    RELEASES: kv as unknown as KVNamespace,
    RELEASE_INGEST_TOKEN: "ingest-secret",
    FIGMA_WEBHOOK_PASSCODE: "figma-secret",
    ALLOWED_LIBRARY_IDS: "dev.example.ui,org.second.library",
  };
}

function releasePayload(version = "1.2.0", libraryId = "dev.example.ui"): object {
  return {
    schemaVersion: 1,
    library: {
      id: libraryId,
      name: "Example UI",
      figmaFileKey: "Abcdefgh1234",
    },
    release: {
      version,
      createdAt: "2026-07-24T10:00:00.000Z",
      gitSha: "0123456789abcdef",
      tag: `ui-v${version}`,
      changelog: "Updated Button.",
      sourceUrl: `https://example.com/releases/ui-v${version}`,
      links: {
        storybook: "https://preview.example.com/storybook/",
      },
    },
    manifest: {
      $schema:
        "https://raw.githubusercontent.com/blumepage/perfect-libraries/main/schema/perfect-libraries-v1.schema.json",
      version: 1,
      library: {
        id: libraryId,
        name: "Example UI",
        release: version,
      },
      tokenCollections: [],
      components: [],
    },
    sources: {
      $schema:
        "https://raw.githubusercontent.com/blumepage/perfect-libraries/main/schema/perfect-libraries-sources-v1.schema.json",
      version: 1,
      library: { id: libraryId, release: version },
      generatedAt: "2026-07-24T10:00:00.000Z",
      variants: [],
    },
  };
}

function ingestRequest(payload = releasePayload(), token = "ingest-secret"): Request {
  return new Request("https://service.test/v1/releases", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

test("ingests a release and exposes a public feed and immutable manifest", async () => {
  const testEnv = env();
  const unauthorized = await handleRequest(
    ingestRequest(releasePayload(), "wrong"),
    testEnv,
  );
  assert.equal(unauthorized.status, 401);

  const ingested = await handleRequest(ingestRequest(), testEnv);
  assert.equal(ingested.status, 201);

  const feed = await handleRequest(
    new Request(
      "https://service.test/v1/libraries/dev.example.ui/releases/latest",
    ),
    testEnv,
  );
  assert.equal(feed.status, 200);
  const release = (await feed.json()) as PublicReleaseFeed;
  assert.equal(
    release.$schema,
    "https://raw.githubusercontent.com/blumepage/perfect-libraries/main/schema/perfect-libraries-release-feed-v1.schema.json",
  );
  assert.equal(release.latest.status, "pending");
  assert.equal(release.latest.release, "1.2.0");
  assert.equal(
    release.latest.sourcesUrl,
    "https://service.test/v1/libraries/dev.example.ui/releases/1.2.0/sources",
  );

  const manifest = await handleRequest(
    new Request(
      "https://service.test/v1/libraries/dev.example.ui/releases/1.2.0/manifest",
    ),
    testEnv,
  );
  assert.equal(manifest.status, 200);
  assert.match(manifest.headers.get("cache-control") ?? "", /immutable/);
  assert.equal(
    ((await manifest.json()) as { library: { release: string } }).library
      .release,
    "1.2.0",
  );

  const sources = await handleRequest(
    new Request(
      "https://service.test/v1/libraries/dev.example.ui/releases/1.2.0/sources",
    ),
    testEnv,
  );
  assert.equal(sources.status, 200);
  assert.match(sources.headers.get("cache-control") ?? "", /immutable/);
  assert.deepEqual(
    ((await sources.json()) as { library: object }).library,
    { id: "dev.example.ui", release: "1.2.0" },
  );
});

test("enforces configured library ids and rejects a release downgrade", async () => {
  const testEnv = env();
  const disallowed = await handleRequest(
    ingestRequest(releasePayload("1.0.0", "org.unconfigured")),
    testEnv,
  );
  assert.equal(disallowed.status, 403);

  for (const version of ["2.0.0", "1.9.9"]) {
    const response = await handleRequest(
      ingestRequest(releasePayload(version)),
      testEnv,
    );
    assert.equal(response.status, version === "2.0.0" ? 201 : 409);
  }
});

test("keeps a pending release immutable across different versions", async () => {
  const testEnv = env();
  const first = await handleRequest(
    ingestRequest(releasePayload("1.2.0")),
    testEnv,
  );
  assert.equal(first.status, 201);

  const replacement = await handleRequest(
    ingestRequest(releasePayload("1.3.0")),
    testEnv,
  );
  assert.equal(replacement.status, 409);
  assert.deepEqual(await replacement.json(), {
    error:
      "Cannot replace pending release 1.2.0 with 1.3.0. Publish or clear the pending release first.",
  });

  const feed = await handleRequest(
    new Request(
      "https://service.test/v1/libraries/dev.example.ui/releases/latest",
    ),
    testEnv,
  );
  assert.equal(feed.status, 200);
  const release = (await feed.json()) as PublicReleaseFeed;
  assert.equal(release.latest.release, "1.2.0");
  assert.equal(release.latest.status, "pending");
});

test("allows an idempotent retry of the same pending release version", async () => {
  const kv = new MemoryKv();
  const testEnv = env(kv);
  const payload = releasePayload("1.2.0");

  const first = await handleRequest(ingestRequest(payload), testEnv);
  assert.equal(first.status, 201);
  const putsAfterFirstIngest = kv.puts.length;

  const retried = await handleRequest(ingestRequest(payload), testEnv);
  assert.equal(retried.status, 200);
  const response = (await retried.json()) as {
    idempotent: boolean;
    release: PublicReleaseFeed;
  };
  assert.equal(response.idempotent, true);
  assert.equal(response.release.latest.release, "1.2.0");
  assert.equal(response.release.latest.status, "pending");
  assert.equal(kv.puts.length, putsAfterFirstIngest);
});

test("rejects same-version pending release drift before any writes", async (t) => {
  const driftCases: Array<{
    name: string;
    mutate: (payload: Record<string, any>) => void;
  }> = [
    {
      name: "changelog",
      mutate: (payload) => {
        payload.release.changelog = "Changed release notes.";
      },
    },
    {
      name: "release source URL",
      mutate: (payload) => {
        payload.release.sourceUrl =
          "https://example.com/releases/a-different-build";
      },
    },
    {
      name: "release git SHA",
      mutate: (payload) => {
        payload.release.gitSha = "fedcba9876543210";
      },
    },
    {
      name: "manifest content",
      mutate: (payload) => {
        payload.manifest.components = [{ id: "changed-button" }];
      },
    },
    {
      name: "source content",
      mutate: (payload) => {
        payload.sources.variants = [{ id: "changed-button-default" }];
      },
    },
    {
      name: "removed source artifact",
      mutate: (payload) => {
        delete payload.sources;
      },
    },
    {
      name: "library metadata",
      mutate: (payload) => {
        payload.library.name = "Changed UI";
        payload.manifest.library.name = "Changed UI";
      },
    },
  ];

  for (const driftCase of driftCases) {
    await t.test(driftCase.name, async () => {
      const kv = new MemoryKv();
      const testEnv = env(kv);
      const original = releasePayload("1.2.0");
      const first = await handleRequest(ingestRequest(original), testEnv);
      assert.equal(first.status, 201);

      const storedBefore = new Map(kv.values);
      const putsBefore = kv.puts.length;
      const changed = structuredClone(original) as Record<string, any>;
      driftCase.mutate(changed);

      const retry = await handleRequest(ingestRequest(changed), testEnv);
      assert.equal(retry.status, 409);
      assert.deepEqual(await retry.json(), {
        error: "Release 1.2.0 already exists with different content.",
      });
      assert.equal(kv.puts.length, putsBefore);
      assert.deepEqual(kv.values, storedBefore);

      const manifest = await handleRequest(
        new Request(
          "https://service.test/v1/libraries/dev.example.ui/releases/1.2.0/manifest",
        ),
        testEnv,
      );
      assert.deepEqual(
        await manifest.json(),
        (original as Record<string, any>).manifest,
      );
      const sources = await handleRequest(
        new Request(
          "https://service.test/v1/libraries/dev.example.ui/releases/1.2.0/sources",
        ),
        testEnv,
      );
      assert.deepEqual(
        await sources.json(),
        (original as Record<string, any>).sources,
      );
    });
  }
});

test("treats reordered object keys as an exact pending-release retry", async () => {
  const original = releasePayload("1.2.0") as Record<string, any>;
  const retry = structuredClone(original);
  retry.release.links = {
    documentation: "https://preview.example.com/docs/",
    ...retry.release.links,
  };
  original.release.links = {
    ...original.release.links,
    documentation: "https://preview.example.com/docs/",
  };

  const newKv = new MemoryKv();
  const newEnv = env(newKv);
  assert.equal(
    (await handleRequest(ingestRequest(original), newEnv)).status,
    201,
  );
  const putsBefore = newKv.puts.length;
  const response = await handleRequest(ingestRequest(retry), newEnv);
  assert.equal(response.status, 200);
  assert.equal(newKv.puts.length, putsBefore);
});

test("rejects adding sources to a source-less pending release", async () => {
  const kv = new MemoryKv();
  const testEnv = env(kv);
  const original = releasePayload("1.2.0") as Record<string, any>;
  const sources = original.sources;
  delete original.sources;
  assert.equal(
    (await handleRequest(ingestRequest(original), testEnv)).status,
    201,
  );
  const storedBefore = new Map(kv.values);
  const putsBefore = kv.puts.length;

  const changed = structuredClone(original);
  changed.sources = sources;
  const response = await handleRequest(ingestRequest(changed), testEnv);

  assert.equal(response.status, 409);
  assert.equal(kv.puts.length, putsBefore);
  assert.deepEqual(kv.values, storedBefore);
});

test("allows an exact retry of a source-less pending release", async () => {
  const kv = new MemoryKv();
  const testEnv = env(kv);
  const payload = releasePayload("1.2.0") as Record<string, any>;
  delete payload.sources;
  assert.equal(
    (await handleRequest(ingestRequest(payload), testEnv)).status,
    201,
  );
  const putsBefore = kv.puts.length;

  const response = await handleRequest(ingestRequest(payload), testEnv);

  assert.equal(response.status, 200);
  assert.equal(
    ((await response.json()) as { idempotent: boolean }).idempotent,
    true,
  );
  assert.equal(kv.puts.length, putsBefore);
});

test("does not reopen an already published release on a same-version retry", async () => {
  const testEnv = env();
  const payload = releasePayload("1.2.0");
  await handleRequest(ingestRequest(payload), testEnv);
  await handleRequest(
    new Request("https://service.test/v1/figma/webhooks", {
      method: "POST",
      body: JSON.stringify({
        event_type: "LIBRARY_PUBLISH",
        passcode: "figma-secret",
        timestamp: "2026-07-24T11:00:00.000Z",
        webhook_id: "event-published",
        file_key: "Abcdefgh1234",
        file_name: "Example UI",
      }),
    }),
    testEnv,
  );

  const retried = await handleRequest(ingestRequest(payload), testEnv);
  assert.equal(retried.status, 200);
  const response = (await retried.json()) as {
    alreadyPublished: boolean;
    release: PublicReleaseFeed;
  };
  assert.equal(response.alreadyPublished, true);
  assert.equal(response.release.latest.release, "1.2.0");
  assert.equal(response.release.latest.status, "published");

  const feed = await handleRequest(
    new Request(
      "https://service.test/v1/libraries/dev.example.ui/releases/latest",
    ),
    testEnv,
  );
  assert.equal(feed.status, 200);
  assert.equal(
    ((await feed.json()) as PublicReleaseFeed).latest.status,
    "published",
  );
});

test("preserves a published same-version release when retry content drifts", async () => {
  const kv = new MemoryKv();
  const testEnv = env(kv);
  const payload = releasePayload("1.2.0") as Record<string, any>;
  await handleRequest(ingestRequest(payload), testEnv);
  await handleRequest(
    new Request("https://service.test/v1/figma/webhooks", {
      method: "POST",
      body: JSON.stringify({
        event_type: "LIBRARY_PUBLISH",
        passcode: "figma-secret",
        timestamp: "2026-07-24T11:00:00.000Z",
        webhook_id: "event-published",
        file_key: "Abcdefgh1234",
        file_name: "Example UI",
      }),
    }),
    testEnv,
  );
  const storedBefore = new Map(kv.values);
  const putsBefore = kv.puts.length;
  const changed = structuredClone(payload);
  changed.release.changelog = "A later retry with different content.";
  changed.manifest.components = [{ id: "changed-button" }];

  const retried = await handleRequest(ingestRequest(changed), testEnv);

  assert.equal(retried.status, 200);
  assert.equal(
    ((await retried.json()) as { alreadyPublished: boolean })
      .alreadyPublished,
    true,
  );
  assert.equal(kv.puts.length, putsBefore);
  assert.deepEqual(kv.values, storedBefore);
});

test("records an idempotent Figma publish event in the public feed", async () => {
  const kv = new MemoryKv();
  const testEnv = env(kv);
  await handleRequest(ingestRequest(), testEnv);

  const event = {
    event_type: "LIBRARY_PUBLISH",
    passcode: "figma-secret",
    timestamp: "2026-07-24T11:00:00.000Z",
    webhook_id: "23",
    file_key: "Abcdefgh1234",
    file_name: "Example UI",
    triggered_by: { handle: "Reviewer" },
  };
  const published = await handleRequest(
    new Request("https://service.test/v1/figma/webhooks", {
      method: "POST",
      body: JSON.stringify(event),
    }),
    testEnv,
  );
  assert.equal(published.status, 200);

  const repeated = await handleRequest(
    new Request("https://service.test/v1/figma/webhooks", {
      method: "POST",
      body: JSON.stringify({
        ...event,
        timestamp: "2026-07-24T12:00:00.000Z",
      }),
    }),
    testEnv,
  );
  assert.equal(repeated.status, 200);

  const feed = await handleRequest(
    new Request(
      "https://service.test/v1/libraries/dev.example.ui/releases/latest",
    ),
    testEnv,
  );
  const release = (await feed.json()) as PublicReleaseFeed;
  assert.equal(release.latest.status, "published");
  assert.equal(release.latest.publishedAt, "2026-07-24T11:00:00.000Z");
});

test("ignores publication events for untracked Figma files", async () => {
  const response = await handleRequest(
    new Request("https://service.test/v1/figma/webhooks", {
      method: "POST",
      body: JSON.stringify({
        event_type: "LIBRARY_PUBLISH",
        passcode: "figma-secret",
        timestamp: "2026-07-24T11:00:00.000Z",
        webhook_id: "23",
        file_key: "Untracked1234",
        file_name: "Another UI",
      }),
    }),
    env(),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    ignored: "Untracked Figma file.",
  });
});
