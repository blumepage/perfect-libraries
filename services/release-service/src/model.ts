export const PERFECT_LIBRARIES_MANIFEST_SCHEMA =
  "https://raw.githubusercontent.com/blumepage/perfect-libraries/main/schema/perfect-libraries-v1.schema.json";

export const PERFECT_LIBRARIES_RELEASE_FEED_SCHEMA =
  "https://raw.githubusercontent.com/blumepage/perfect-libraries/main/schema/perfect-libraries-release-feed-v1.schema.json";

export interface LibraryRelease {
  schemaVersion: 1;
  library: {
    id: string;
    name: string;
    figmaFileKey?: string;
  };
  release: {
    version: string;
    status: "pending" | "published";
    createdAt: string;
    changelog: string;
    manifestUrl: string;
    sourceUrl?: string;
    gitSha?: string;
    tag?: string;
    links?: Record<string, string>;
    published?: {
      at: string;
      by?: string;
      description?: string;
    };
  };
}

export interface ReleaseIngest {
  schemaVersion: 1;
  library: {
    id: string;
    name: string;
    figmaFileKey?: string;
  };
  release: {
    version: string;
    createdAt: string;
    changelog: string;
    sourceUrl?: string;
    gitSha?: string;
    tag?: string;
    links?: Record<string, string>;
  };
  manifest: Record<string, unknown>;
}

export interface PublicReleaseFeed {
  $schema: typeof PERFECT_LIBRARIES_RELEASE_FEED_SCHEMA;
  version: 1;
  library: {
    id: string;
    name: string;
  };
  latest: {
    release: string;
    status: "pending" | "published";
    changelog: string;
    manifestUrl: string;
    sourceUrl?: string;
    publishedAt?: string;
  };
}

export interface FigmaLibraryPublishEvent {
  event_type: "LIBRARY_PUBLISH";
  passcode: string;
  timestamp: string;
  webhook_id: string;
  file_key: string;
  file_name: string;
  description?: string;
  triggered_by?: {
    id?: string;
    handle?: string;
  };
}

export interface FigmaPingEvent {
  event_type: "PING";
  passcode: string;
  timestamp: string;
  webhook_id: string;
}

const SEMVER =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const LIBRARY_ID = /^[a-z0-9][a-z0-9._-]{1,99}$/i;
const GIT_SHA = /^[a-f0-9]{7,64}$/i;
const FIGMA_FILE_KEY = /^[a-zA-Z0-9_-]{8,128}$/;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(
  value: unknown,
  max: number,
): value is string | undefined {
  return (
    value === undefined ||
    (typeof value === "string" && value.length <= max)
  );
}

function optionalUrl(value: unknown): value is string | undefined {
  if (value === undefined) return true;
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function validLinks(value: unknown): value is Record<string, string> | undefined {
  if (value === undefined) return true;
  if (!record(value) || Object.keys(value).length > 20) return false;
  return Object.entries(value).every(
    ([key, url]) =>
      /^[a-z][a-z0-9_-]{0,39}$/i.test(key) && optionalUrl(url),
  );
}

function validManifest(
  value: unknown,
  libraryId: string,
  libraryName: string,
  release: string,
): value is Record<string, unknown> {
  if (!record(value)) return false;
  const library = value.library;
  return (
    value.$schema === PERFECT_LIBRARIES_MANIFEST_SCHEMA &&
    value.version === 1 &&
    record(library) &&
    library.id === libraryId &&
    library.name === libraryName &&
    library.release === release &&
    Array.isArray(value.tokenCollections) &&
    Array.isArray(value.components)
  );
}

export function parseReleaseIngest(value: unknown): ReleaseIngest | null {
  if (!record(value) || value.schemaVersion !== 1) return null;
  const library = value.library;
  const release = value.release;
  if (!record(library) || !record(release)) return null;
  if (
    typeof library.id !== "string" ||
    !LIBRARY_ID.test(library.id) ||
    typeof library.name !== "string" ||
    library.name.length < 1 ||
    library.name.length > 120 ||
    (library.figmaFileKey !== undefined &&
      (typeof library.figmaFileKey !== "string" ||
        !FIGMA_FILE_KEY.test(library.figmaFileKey)))
  ) {
    return null;
  }
  if (
    typeof release.version !== "string" ||
    !SEMVER.test(release.version) ||
    typeof release.createdAt !== "string" ||
    !Number.isFinite(Date.parse(release.createdAt)) ||
    typeof release.changelog !== "string" ||
    release.changelog.trim().length < 1 ||
    release.changelog.length > 20_000 ||
    !optionalUrl(release.sourceUrl) ||
    !optionalString(release.gitSha, 64) ||
    (release.gitSha !== undefined &&
      (typeof release.gitSha !== "string" || !GIT_SHA.test(release.gitSha))) ||
    !optionalString(release.tag, 120) ||
    !validLinks(release.links) ||
    !validManifest(
      value.manifest,
      library.id,
      library.name,
      release.version,
    )
  ) {
    return null;
  }

  return {
    schemaVersion: 1,
    library: {
      id: library.id,
      name: library.name,
      ...(typeof library.figmaFileKey === "string"
        ? { figmaFileKey: library.figmaFileKey }
        : {}),
    },
    release: {
      version: release.version,
      createdAt: release.createdAt,
      changelog: release.changelog,
      ...(typeof release.sourceUrl === "string"
        ? { sourceUrl: release.sourceUrl }
        : {}),
      ...(typeof release.gitSha === "string"
        ? { gitSha: release.gitSha }
        : {}),
      ...(typeof release.tag === "string" ? { tag: release.tag } : {}),
      ...(release.links ? { links: release.links } : {}),
    },
    manifest: value.manifest,
  };
}

export function toPublicReleaseFeed(
  release: LibraryRelease,
): PublicReleaseFeed {
  return {
    $schema: PERFECT_LIBRARIES_RELEASE_FEED_SCHEMA,
    version: 1,
    library: {
      id: release.library.id,
      name: release.library.name,
    },
    latest: {
      release: release.release.version,
      status: release.release.status,
      changelog: release.release.changelog,
      manifestUrl: release.release.manifestUrl,
      ...(release.release.sourceUrl
        ? { sourceUrl: release.release.sourceUrl }
        : {}),
      ...(release.release.published?.at
        ? { publishedAt: release.release.published.at }
        : {}),
    },
  };
}

export function parseFigmaEvent(
  value: unknown,
): FigmaPingEvent | FigmaLibraryPublishEvent | null {
  if (!record(value) || typeof value.passcode !== "string") return null;
  if (value.event_type === "PING") {
    if (
      typeof value.timestamp !== "string" ||
      typeof value.webhook_id !== "string"
    ) {
      return null;
    }
    return {
      event_type: "PING",
      passcode: value.passcode,
      timestamp: value.timestamp,
      webhook_id: value.webhook_id,
    };
  }
  if (
    value.event_type !== "LIBRARY_PUBLISH" ||
    typeof value.timestamp !== "string" ||
    !Number.isFinite(Date.parse(value.timestamp)) ||
    typeof value.webhook_id !== "string" ||
    typeof value.file_key !== "string" ||
    !FIGMA_FILE_KEY.test(value.file_key) ||
    typeof value.file_name !== "string"
  ) {
    return null;
  }
  return {
    event_type: "LIBRARY_PUBLISH",
    passcode: value.passcode,
    timestamp: value.timestamp,
    webhook_id: value.webhook_id,
    file_key: value.file_key,
    file_name: value.file_name,
    ...(typeof value.description === "string"
      ? { description: value.description }
      : {}),
    ...(record(value.triggered_by)
      ? {
          triggered_by: {
            ...(typeof value.triggered_by.id === "string"
              ? { id: value.triggered_by.id }
              : {}),
            ...(typeof value.triggered_by.handle === "string"
              ? { handle: value.triggered_by.handle }
              : {}),
          },
        }
      : {}),
  };
}

export function compareSemver(left: string, right: string): number {
  const [leftCore, leftPrerelease] = left.split("-", 2);
  const [rightCore, rightPrerelease] = right.split("-", 2);
  const leftParts = leftCore.split(".").map(Number);
  const rightParts = rightCore.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index];
    }
  }
  if (leftPrerelease === rightPrerelease) return 0;
  if (!leftPrerelease) return 1;
  if (!rightPrerelease) return -1;
  const leftIdentifiers = leftPrerelease.split(".");
  const rightIdentifiers = rightPrerelease.split(".");
  const count = Math.max(leftIdentifiers.length, rightIdentifiers.length);
  for (let index = 0; index < count; index += 1) {
    const leftIdentifier = leftIdentifiers[index];
    const rightIdentifier = rightIdentifiers[index];
    if (leftIdentifier === rightIdentifier) continue;
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;
    const leftNumber = /^\d+$/.test(leftIdentifier)
      ? Number(leftIdentifier)
      : null;
    const rightNumber = /^\d+$/.test(rightIdentifier)
      ? Number(rightIdentifier)
      : null;
    if (leftNumber !== null && rightNumber !== null) {
      return leftNumber - rightNumber;
    }
    if (leftNumber !== null) return -1;
    if (rightNumber !== null) return 1;
    return leftIdentifier.localeCompare(rightIdentifier);
  }
  return 0;
}
