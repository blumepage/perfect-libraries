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
  sourcesUrl?: string;
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
  sourcesUrl?: string;
  manifest?: PerfectLibrariesManifest;
  manifestUrl?: string;
}

export interface ReleaseFeedResult {
  ok: boolean;
  errors: string[];
  release?: ResolvedRelease;
}

interface AbsoluteHttpUrl {
  protocol: "http:" | "https:";
  authority: string;
  hostname: string;
  pathname: string;
  search: string;
  hash: string;
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

function parseAbsoluteHttpUrl(value: string): AbsoluteHttpUrl | undefined {
  const trimmed = value.trim();
  const schemeEnd = trimmed.indexOf("://");
  if (schemeEnd < 1) return undefined;

  const protocol = `${trimmed.slice(0, schemeEnd).toLowerCase()}:`;
  if (protocol !== "http:" && protocol !== "https:") return undefined;

  const remainder = trimmed.slice(schemeEnd + 3);
  const authorityEndCandidates = [
    remainder.indexOf("/"),
    remainder.indexOf("?"),
    remainder.indexOf("#"),
  ].filter((index) => index >= 0);
  const authorityEnd =
    authorityEndCandidates.length > 0
      ? Math.min(...authorityEndCandidates)
      : remainder.length;
  const authority = remainder.slice(0, authorityEnd);
  if (
    !authority ||
    authority.includes("@") ||
    /[\s\\]/.test(authority)
  ) {
    return undefined;
  }

  let hostname = authority;
  let port = "";
  if (authority.startsWith("[")) {
    const closingBracket = authority.indexOf("]");
    if (closingBracket < 2) return undefined;
    hostname = authority.slice(0, closingBracket + 1);
    const portSuffix = authority.slice(closingBracket + 1);
    if (portSuffix) {
      if (!/^:\d+$/.test(portSuffix)) return undefined;
      port = portSuffix.slice(1);
    }
  } else {
    const lastColon = authority.lastIndexOf(":");
    if (lastColon >= 0) {
      if (authority.indexOf(":") !== lastColon) return undefined;
      hostname = authority.slice(0, lastColon);
      port = authority.slice(lastColon + 1);
      if (!port || !/^\d+$/.test(port)) return undefined;
    }
  }
  if (!hostname || /[\s/?#]/.test(hostname)) return undefined;
  if (port && (Number(port) < 1 || Number(port) > 65_535)) return undefined;

  const suffix = remainder.slice(authorityEnd);
  const hashIndex = suffix.indexOf("#");
  const hash = hashIndex >= 0 ? suffix.slice(hashIndex) : "";
  const withoutHash = hashIndex >= 0 ? suffix.slice(0, hashIndex) : suffix;
  const searchIndex = withoutHash.indexOf("?");
  const search = searchIndex >= 0 ? withoutHash.slice(searchIndex) : "";
  const pathname =
    (searchIndex >= 0 ? withoutHash.slice(0, searchIndex) : withoutHash) || "/";
  if (!pathname.startsWith("/") || /[\s\\]/.test(pathname + search + hash)) {
    return undefined;
  }

  return {
    protocol,
    authority,
    hostname: hostname.toLowerCase(),
    pathname,
    search,
    hash,
  };
}

function serializeHttpUrl(url: AbsoluteHttpUrl): string {
  return `${url.protocol}//${url.authority}${url.pathname}${url.search}${url.hash}`;
}

function normalizePath(pathname: string): string {
  const trailingSlash = pathname.endsWith("/");
  const segments: string[] = [];
  for (const segment of pathname.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  const normalized = `/${segments.join("/")}`;
  return trailingSlash && normalized !== "/" ? `${normalized}/` : normalized;
}

export function normalizeReleaseSourceUrl(value: string): string | undefined {
  const parsed = parseAbsoluteHttpUrl(value);
  if (!parsed) return undefined;
  const localDevelopmentHost = ["localhost", "127.0.0.1"].includes(
    parsed.hostname,
  );
  if (
    parsed.protocol !== "https:" &&
    !(parsed.protocol === "http:" && localDevelopmentHost)
  ) {
    return undefined;
  }
  return serializeHttpUrl(parsed);
}

function resolveHttpUrl(value: string, baseUrl: string): string | undefined {
  const trimmed = value.trim();
  const absolute = parseAbsoluteHttpUrl(trimmed);
  if (absolute) return serializeHttpUrl(absolute);

  const base = parseAbsoluteHttpUrl(baseUrl);
  if (!base || !trimmed || /[\s\\]/.test(trimmed)) return undefined;
  if (trimmed.startsWith("//")) {
    const protocolRelative = parseAbsoluteHttpUrl(
      `${base.protocol}${trimmed}`,
    );
    return protocolRelative
      ? serializeHttpUrl(protocolRelative)
      : undefined;
  }

  const hashIndex = trimmed.indexOf("#");
  const hash = hashIndex >= 0 ? trimmed.slice(hashIndex) : "";
  const withoutHash = hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed;
  const searchIndex = withoutHash.indexOf("?");
  const search = searchIndex >= 0 ? withoutHash.slice(searchIndex) : "";
  const relativePath =
    searchIndex >= 0 ? withoutHash.slice(0, searchIndex) : withoutHash;

  let pathname: string;
  if (!relativePath) {
    pathname = base.pathname;
  } else if (relativePath.startsWith("/")) {
    pathname = normalizePath(relativePath);
  } else {
    const directory = base.pathname.slice(
      0,
      base.pathname.lastIndexOf("/") + 1,
    );
    pathname = normalizePath(`${directory}${relativePath}`);
  }

  return `${base.protocol}//${base.authority}${pathname}${
    search || (!relativePath && !withoutHash ? base.search : "")
  }${hash}`;
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
    if (!optionalString(latest.sourcesUrl)) {
      errors.push("latest.sourcesUrl must be a string.");
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
    if (
      nonEmptyString(latest.sourcesUrl) &&
      !resolveHttpUrl(latest.sourcesUrl, feedUrl)
    ) {
      errors.push("latest.sourcesUrl must resolve to an HTTP(S) URL.");
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
      ...(nonEmptyString(latest.sourcesUrl)
        ? { sourcesUrl: resolveHttpUrl(latest.sourcesUrl, feedUrl) }
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
