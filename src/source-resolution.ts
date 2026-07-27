import { normalizeReleaseSourceUrl, type ResolvedRelease } from "./release-feed";

export interface SourceResolutionRequest {
  libraryId: string;
  release: string;
  requestedSourcesUrl?: string;
  cachedRelease?: ResolvedRelease;
}

export function selectReleaseSourcesUrl({
  libraryId,
  release,
  requestedSourcesUrl,
  cachedRelease,
}: SourceResolutionRequest): string | undefined {
  if (requestedSourcesUrl) {
    const normalized = normalizeReleaseSourceUrl(requestedSourcesUrl);
    if (!normalized) {
      throw new Error(
        "The rendered Storybook source bundle must use HTTPS or a local development URL.",
      );
    }
    return normalized;
  }

  if (
    cachedRelease?.libraryId === libraryId &&
    cachedRelease.release === release
  ) {
    return cachedRelease.sourcesUrl;
  }
  return undefined;
}

export function missingSourceContextError(variantCount: number): string {
  return `No rendered source bundle is attached to this manifest, and none of its ${variantCount} source frames exist on the current page. Load the manifest from its release feed or import its source frames before inspecting.`;
}

export function localDiagnosticUrlForReleaseSource(
  releaseSourceUrl: string,
): string | undefined {
  const normalized = normalizeReleaseSourceUrl(releaseSourceUrl);
  const match = normalized?.match(
    /^(http:\/\/localhost:(?:3000|8787))(?:\/|$)/i,
  );
  return match ? `${match[1]}/plugin-report` : undefined;
}
