import {
  PERFECT_LIBRARIES_SCHEMA,
  validateManifest,
  type PerfectLibrariesManifest,
} from "./manifest";

export const PERFECT_LIBRARIES_RELEASE_FEED_SCHEMA =
  "https://raw.githubusercontent.com/blumepage/perfect-libraries/main/schema/perfect-libraries-release-feed-v1.schema.json";

export interface ReleaseFeedLatest {
  release: string;
  status?: "pending" | "published";
  changelog: string;
  manifest?: PerfectLibrariesManifest;
  manifestUrl?: string;
  publishedAt?: string;
  sourceUrl?: string;
}

export interface PerfectLibrariesReleaseFeed {
  $schema: typeof PERFECT_LIBRARIES_RELEASE_FEED_SCHEMA;
  version: 1;
  library: {
    id: string;
    name: string;
  };
  latest: ReleaseFeedLatest;
}

export interface ResolvedRelease {
  libraryId: string;
  libraryName: string;
  release: string;
  status?: "pending" | "published";
  changelog: string;
  publishedAt?: string;
  sourceUrl?: string;
  manifest?: PerfectLibrariesManifest;
  manifestUrl?: string;
}

export interface ReleaseFeedResult {
  ok: boolean;
  errors: string[];
  release?: ResolvedRelease;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function resolveHttpUrl(value: string, baseUrl: string): string | undefined {
  try {
    const resolved = new URL(value, baseUrl);
    if (!["http:", "https:"].includes(resolved.protocol)) return undefined;
    return resolved.toString();
  } catch {
    return undefined;
  }
}

function directManifestResult(input: unknown): ReleaseFeedResult | undefined {
  if (!isRecord(input) || input.$schema !== PERFECT_LIBRARIES_SCHEMA) {
    return undefined;
  }
  const validation = validateManifest(input);
  if (!validation.ok || !validation.manifest) {
    return { ok: false, errors: validation.errors };
  }
  return {
    ok: true,
    errors: [],
    release: {
      libraryId: validation.manifest.library.id,
      libraryName: validation.manifest.library.name,
      release: validation.manifest.library.release,
      changelog: "No changelog was included with this direct manifest.",
      manifest: validation.manifest,
    },
  };
}

export function parseReleaseFeed(
  input: unknown,
  feedUrl: string,
): ReleaseFeedResult {
  const direct = directManifestResult(input);
  if (direct) return direct;

  const errors: string[] = [];
  if (!isRecord(input)) {
    return { ok: false, errors: ["Release feed must be a JSON object."] };
  }
  if (input.$schema !== PERFECT_LIBRARIES_RELEASE_FEED_SCHEMA) {
    errors.push(
      `$schema must equal "${PERFECT_LIBRARIES_RELEASE_FEED_SCHEMA}".`,
    );
  }
  if (input.version !== 1) {
    errors.push("version must equal 1.");
  }

  const library = input.library;
  if (!isRecord(library)) {
    errors.push("library must be an object.");
  } else {
    if (!nonEmptyString(library.id)) {
      errors.push("library.id must be a non-empty string.");
    }
    if (!nonEmptyString(library.name)) {
      errors.push("library.name must be a non-empty string.");
    }
  }

  const latest = input.latest;
  if (!isRecord(latest)) {
    errors.push("latest must be an object.");
  } else {
    if (!nonEmptyString(latest.release)) {
      errors.push("latest.release must be a non-empty string.");
    }
    if (!nonEmptyString(latest.changelog)) {
      errors.push("latest.changelog must be a non-empty string.");
    }
    if (
      latest.status !== undefined &&
      !["pending", "published"].includes(latest.status as string)
    ) {
      errors.push('latest.status must be "pending" or "published".');
    }
    if (!optionalString(latest.publishedAt)) {
      errors.push("latest.publishedAt must be a string.");
    }
    if (!optionalString(latest.sourceUrl)) {
      errors.push("latest.sourceUrl must be a string.");
    }

    const hasInlineManifest = latest.manifest !== undefined;
    const hasManifestUrl = nonEmptyString(latest.manifestUrl);
    if (hasInlineManifest === hasManifestUrl) {
      errors.push(
        "latest must contain exactly one of manifest or manifestUrl.",
      );
    }

    if (hasManifestUrl && !resolveHttpUrl(latest.manifestUrl as string, feedUrl)) {
      errors.push("latest.manifestUrl must resolve to an HTTP(S) URL.");
    }
    if (
      nonEmptyString(latest.sourceUrl) &&
      !resolveHttpUrl(latest.sourceUrl, feedUrl)
    ) {
      errors.push("latest.sourceUrl must resolve to an HTTP(S) URL.");
    }
  }

  if (errors.length > 0 || !isRecord(library) || !isRecord(latest)) {
    return { ok: false, errors };
  }

  let manifest: PerfectLibrariesManifest | undefined;
  if (latest.manifest !== undefined) {
    const validation = validateManifest(latest.manifest);
    if (!validation.ok || !validation.manifest) {
      return {
        ok: false,
        errors: validation.errors.map((error) => `latest.manifest: ${error}`),
      };
    }
    manifest = validation.manifest;
  }

  const libraryId = library.id as string;
  const libraryName = library.name as string;
  const release = latest.release as string;
  if (manifest) {
    if (manifest.library.id !== libraryId) {
      errors.push("latest.manifest library.id does not match feed library.id.");
    }
    if (manifest.library.release !== release) {
      errors.push(
        "latest.manifest library.release does not match latest.release.",
      );
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    errors: [],
    release: {
      libraryId,
      libraryName,
      release,
      ...(latest.status === "pending" || latest.status === "published"
        ? { status: latest.status }
        : {}),
      changelog: latest.changelog as string,
      ...(typeof latest.publishedAt === "string"
        ? { publishedAt: latest.publishedAt }
        : {}),
      ...(nonEmptyString(latest.sourceUrl)
        ? { sourceUrl: resolveHttpUrl(latest.sourceUrl, feedUrl) }
        : {}),
      ...(manifest ? { manifest } : {}),
      ...(nonEmptyString(latest.manifestUrl)
        ? { manifestUrl: resolveHttpUrl(latest.manifestUrl, feedUrl) }
        : {}),
    },
  };
}

export function validateReleaseManifest(
  release: ResolvedRelease,
  input: unknown,
): ReleaseFeedResult {
  const validation = validateManifest(input);
  if (!validation.ok || !validation.manifest) {
    return { ok: false, errors: validation.errors };
  }
  if (validation.manifest.library.id !== release.libraryId) {
    return {
      ok: false,
      errors: [
        `Manifest library "${validation.manifest.library.id}" does not match feed library "${release.libraryId}".`,
      ],
    };
  }
  if (validation.manifest.library.release !== release.release) {
    return {
      ok: false,
      errors: [
        `Manifest release "${validation.manifest.library.release}" does not match feed release "${release.release}".`,
      ],
    };
  }
  return {
    ok: true,
    errors: [],
    release: { ...release, manifest: validation.manifest },
  };
}

export function hasPendingRelease(
  currentRelease: string | undefined,
  latestRelease: string,
): boolean {
  return currentRelease !== latestRelease;
}
