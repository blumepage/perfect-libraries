import {
  compareSemver,
  parseFigmaEvent,
  parseReleaseIngest,
  toPublicReleaseFeed,
  type LibraryRelease,
} from "./model.ts";

const MAX_REQUEST_BYTES = 1_500_000;

function corsHeaders(cacheControl = "no-store"): HeadersInit {
  return {
    "access-control-allow-origin": "*",
    "cache-control": cacheControl,
    "content-type": "application/json; charset=utf-8",
  };
}

function json(
  body: unknown,
  status = 200,
  cacheControl = "no-store",
): Response {
  return Response.json(body, {
    status,
    headers: corsHeaders(cacheControl),
  });
}

async function readJsonLimited(request: Request): Promise<unknown> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    throw new Error("payload-too-large");
  }
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new Error("payload-too-large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

async function sameSecret(
  actual: string | null,
  expected: string | undefined,
): Promise<boolean> {
  if (!actual || !expected) return false;
  const encoder = new TextEncoder();
  const [actualDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(actual)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const workerSubtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual?: (left: BufferSource, right: BufferSource) => boolean;
  };
  if (workerSubtle.timingSafeEqual) {
    return workerSubtle.timingSafeEqual(actualDigest, expectedDigest);
  }
  const actualBytes = new Uint8Array(actualDigest);
  const expectedBytes = new Uint8Array(expectedDigest);
  let difference = actualBytes.byteLength ^ expectedBytes.byteLength;
  for (
    let index = 0;
    index < Math.max(actualBytes.byteLength, expectedBytes.byteLength);
    index += 1
  ) {
    difference |=
      actualBytes[index % actualBytes.byteLength] ^
      expectedBytes[index % expectedBytes.byteLength];
  }
  return difference === 0;
}

function bearer(request: Request): string | null {
  const value = request.headers.get("authorization")?.trim();
  if (!value?.toLowerCase().startsWith("bearer ")) return null;
  return value.slice(7).trim() || null;
}

function feedKey(libraryId: string): string {
  return `library:${libraryId}:latest`;
}

function manifestKey(libraryId: string, version: string): string {
  return `library:${libraryId}:manifest:${version}`;
}

function fileKey(figmaFileKey: string): string {
  return `figma-file:${figmaFileKey}`;
}

function feedUrl(request: Request, libraryId: string): string {
  return new URL(
    `/v1/libraries/${encodeURIComponent(libraryId)}/releases/latest`,
    request.url,
  ).toString();
}

function immutableManifestUrl(
  request: Request,
  libraryId: string,
  version: string,
): string {
  return new URL(
    `/v1/libraries/${encodeURIComponent(libraryId)}/releases/${encodeURIComponent(version)}/manifest`,
    request.url,
  ).toString();
}

function libraryAllowed(libraryId: string, configured: string | undefined): boolean {
  if (!configured?.trim()) return true;
  return configured
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .includes(libraryId);
}

async function ingestRelease(request: Request, env: Env): Promise<Response> {
  if (!(await sameSecret(bearer(request), env.RELEASE_INGEST_TOKEN))) {
    return json({ error: "Unauthorized." }, 401);
  }

  let raw: unknown;
  try {
    raw = await readJsonLimited(request);
  } catch (error) {
    const tooLarge =
      error instanceof Error && error.message === "payload-too-large";
    return json(
      {
        error: tooLarge
          ? "Payload exceeds 1.5 MB."
          : "Invalid JSON payload.",
      },
      tooLarge ? 413 : 400,
    );
  }
  const input = parseReleaseIngest(raw);
  if (!input) return json({ error: "Invalid release payload." }, 400);
  if (!libraryAllowed(input.library.id, env.ALLOWED_LIBRARY_IDS)) {
    return json({ error: "Library is not configured for this service." }, 403);
  }

  const existing = await env.RELEASES.get<LibraryRelease>(
    feedKey(input.library.id),
    "json",
  );
  if (
    existing &&
    compareSemver(input.release.version, existing.release.version) < 0
  ) {
    return json(
      {
        error: `Cannot replace ${existing.release.version} with older ${input.release.version}.`,
      },
      409,
    );
  }

  const manifestUrl = immutableManifestUrl(
    request,
    input.library.id,
    input.release.version,
  );
  const release: LibraryRelease = {
    schemaVersion: 1,
    library: input.library,
    release: {
      ...input.release,
      status: "pending",
      manifestUrl,
    },
  };
  await Promise.all([
    env.RELEASES.put(
      manifestKey(input.library.id, input.release.version),
      JSON.stringify(input.manifest),
    ),
    env.RELEASES.put(feedKey(input.library.id), JSON.stringify(release)),
    input.library.figmaFileKey
      ? env.RELEASES.put(fileKey(input.library.figmaFileKey), input.library.id)
      : Promise.resolve(),
  ]);
  return json(
    {
      ok: true,
      feedUrl: feedUrl(request, input.library.id),
      manifestUrl,
      release: toPublicReleaseFeed(release),
    },
    201,
  );
}

async function latestRelease(
  libraryId: string,
  env: Env,
): Promise<Response> {
  const release = await env.RELEASES.get<LibraryRelease>(
    feedKey(libraryId),
    "json",
  );
  return release
    ? json(
        toPublicReleaseFeed(release),
        200,
        "public, max-age=60, stale-while-revalidate=300",
      )
    : json({ error: "Library release not found." }, 404);
}

async function manifest(
  libraryId: string,
  version: string,
  env: Env,
): Promise<Response> {
  const value = await env.RELEASES.get(manifestKey(libraryId, version));
  if (!value) return json({ error: "Manifest not found." }, 404);
  return new Response(value, {
    headers: corsHeaders("public, max-age=31536000, immutable"),
  });
}

async function figmaWebhook(request: Request, env: Env): Promise<Response> {
  let raw: unknown;
  try {
    raw = await readJsonLimited(request);
  } catch {
    return json({ error: "Invalid webhook payload." }, 400);
  }
  const event = parseFigmaEvent(raw);
  if (
    !event ||
    !(await sameSecret(event.passcode, env.FIGMA_WEBHOOK_PASSCODE))
  ) {
    return json({ error: "Invalid Figma webhook passcode." }, 400);
  }
  if (event.event_type === "PING") {
    return json({ ok: true, event: "PING" });
  }

  const libraryId = await env.RELEASES.get(fileKey(event.file_key));
  if (!libraryId) {
    return json({ ok: true, ignored: "Untracked Figma file." });
  }
  const current = await env.RELEASES.get<LibraryRelease>(
    feedKey(libraryId),
    "json",
  );
  if (!current) return json({ ok: true, ignored: "No pending release." });

  const updated: LibraryRelease = {
    ...current,
    release: {
      ...current.release,
      status: "published",
      published: current.release.published ?? {
        at: event.timestamp,
        ...(event.triggered_by?.handle
          ? { by: event.triggered_by.handle }
          : {}),
        ...(event.description ? { description: event.description } : {}),
      },
    },
  };
  await env.RELEASES.put(feedKey(libraryId), JSON.stringify(updated));
  return json({
    ok: true,
    libraryId,
    version: updated.release.version,
    status: updated.release.status,
  });
}

function pathParts(pathname: string): string[] {
  return pathname
    .split("/")
    .filter(Boolean)
    .map((part) => decodeURIComponent(part));
}

export async function handleRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);
  const parts = pathParts(url.pathname);
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "authorization,content-type",
        "access-control-max-age": "86400",
      },
    });
  }
  if (request.method === "GET" && url.pathname === "/health") {
    return json({ ok: true, service: "perfect-libraries-release-service" });
  }
  if (request.method === "POST" && url.pathname === "/v1/releases") {
    return ingestRelease(request, env);
  }
  if (
    request.method === "POST" &&
    url.pathname === "/v1/figma/webhooks"
  ) {
    return figmaWebhook(request, env);
  }
  if (
    request.method === "GET" &&
    parts.length === 5 &&
    parts[0] === "v1" &&
    parts[1] === "libraries" &&
    parts[3] === "releases" &&
    parts[4] === "latest"
  ) {
    return latestRelease(parts[2], env);
  }
  if (
    request.method === "GET" &&
    parts.length === 6 &&
    parts[0] === "v1" &&
    parts[1] === "libraries" &&
    parts[3] === "releases" &&
    parts[5] === "manifest"
  ) {
    return manifest(parts[2], parts[4], env);
  }
  return json({ error: "Not found." }, 404);
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
} satisfies ExportedHandler<Env>;
