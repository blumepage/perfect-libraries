import {
  formatVariantName,
  validateManifest,
  type BindingProperty,
  type ComponentDefinition,
  type ComponentPropertyDefinition,
  type ComponentVariantDefinition,
  type PerfectLibrariesManifest,
  type NestedInstanceDefinition,
  type TokenDefinition,
  type TokenValue,
  type VariableBindingDefinition,
} from "./manifest";
import {
  hasPendingRelease,
  normalizeReleaseSourceUrl,
  parseReleaseFeed,
  validateReleaseManifest,
  type ResolvedRelease,
} from "./release-feed";
import {
  validateSources,
  type PerfectLibrariesSources,
  type SourceEffect,
  type SourceFrameNode,
  type SourcePaint,
  type SourceSceneNode,
  type SourceTextNode,
} from "./sources";
import { validateSourceContract } from "./source-contract";
import { SerialOperationQueue } from "./serial-operation-queue";
import {
  isSingleLineSourceText,
  selectSourceFontName,
} from "./source-text";
import { shouldWarnMissingAutoLayout } from "./source-audit";
import {
  missingSourceContextError,
  selectReleaseSourcesUrl,
} from "./source-resolution";
import { createSemanticSyncPlan } from "./semantic-sync-plan";
import {
  createDocumentationPlan,
  type DocumentationComponent,
  type DocumentationGroup,
} from "./documentation-plan";

declare const __html__: string;

const PLUGIN_NAMESPACE = "perfectLibraries";
const RELEASE_FEED_STORAGE_KEY = "releaseFeedUrl";
const APPLIED_RELEASES_KEY = "appliedReleases";
const UI_WIDTH = 420;
const UI_HEIGHT = 760;
const MAX_FEED_BYTES = 12_000_000;

type ManagedSceneNode = SceneNode & PluginDataMixin;
type ManagedPage = PageNode & PluginDataMixin;
type ManagedVariable = Variable & PluginDataMixin;
type ManagedCollection = VariableCollection & PluginDataMixin;
type ComponentOwner = ComponentNode | ComponentSetNode;

interface SyncCounters {
  collectionsCreated: number;
  collectionsUpdated: number;
  variablesCreated: number;
  variablesUpdated: number;
  componentsCreated: number;
  componentsUpdated: number;
  componentSetsCreated: number;
  nestedInstancesCreated: number;
  bindingsApplied: number;
  componentPropertiesApplied: number;
  documentationPagesCreated: number;
  documentationCardsCreated: number;
}

interface Report {
  ok: boolean;
  title: string;
  errors: string[];
  warnings: string[];
  details: string[];
  counters?: SyncCounters;
  publishHandoff?: {
    libraryName: string;
    release: string;
  };
}

interface SourceLookup {
  nodes: Map<string, SceneNode>;
  warnings: string[];
  errors: string[];
}

interface ResolvedSourceLookup {
  lookup: SourceLookup;
  warnings: string[];
  sourceErrors: string[];
}

interface ComponentRuntime {
  definition: ComponentDefinition;
  variants: Map<string, ComponentNode>;
  owner: ComponentOwner;
}

type UiMessage =
  | { type: "initialize" }
  | { type: "inspect"; manifest: unknown; sourcesUrl?: string }
  | { type: "apply"; manifest: unknown; sourcesUrl?: string }
  | { type: "save-feed"; url: string }
  | { type: "check-feed" }
  | { type: "clear-feed" }
  | { type: "resize"; height: number }
  | { type: "close" };

interface ReleaseState {
  type: "release-state";
  configuredUrl: string;
  loading: boolean;
  error?: string;
  currentRelease?: string;
  release?: {
    libraryId: string;
    libraryName: string;
    release: string;
    status?: "pending" | "published";
    changelog: string;
    publishedAt?: string;
    sourceUrl?: string;
    sourcesUrl?: string;
    pending: boolean;
    manifest: PerfectLibrariesManifest;
  };
}

let configuredFeedUrl = "";
let cachedRelease: ResolvedRelease | undefined;
const manifestOperationQueue = new SerialOperationQueue();

figma.showUI(__html__, {
  width: UI_WIDTH,
  height: UI_HEIGHT,
  themeColors: true,
});

figma.ui.onmessage = async (message: UiMessage) => {
  if (message.type === "initialize") {
    await initializeReleaseFeed();
    return;
  }

  if (message.type === "close") {
    figma.closePlugin();
    return;
  }

  if (message.type === "resize") {
    figma.ui.resize(UI_WIDTH, Math.max(420, Math.min(820, message.height)));
    return;
  }

  if (message.type === "save-feed") {
    const normalized = normalizeReleaseSourceUrl(message.url);
    if (!normalized) {
      postReleaseState({
        configuredUrl: message.url.trim(),
        loading: false,
        error:
          "Enter a valid HTTPS manifest or release-feed URL, or a localhost URL in development.",
      });
      return;
    }
    configuredFeedUrl = normalized;
    await figma.clientStorage.setAsync(
      RELEASE_FEED_STORAGE_KEY,
      configuredFeedUrl,
    );
    await checkReleaseFeed();
    return;
  }

  if (message.type === "check-feed") {
    await checkReleaseFeed();
    return;
  }

  if (message.type === "clear-feed") {
    configuredFeedUrl = "";
    cachedRelease = undefined;
    await figma.clientStorage.deleteAsync(RELEASE_FEED_STORAGE_KEY);
    postReleaseState({ configuredUrl: "", loading: false });
    return;
  }

  if (message.type === "inspect") {
    figma.ui.postMessage({ type: "busy", busy: true });
    try {
      figma.ui.postMessage(
        await manifestOperationQueue.run(() =>
          inspect(message.manifest, message.sourcesUrl),
        ),
      );
    } finally {
      figma.ui.postMessage({ type: "busy", busy: false });
    }
    return;
  }

  if (message.type === "apply") {
    figma.ui.postMessage({ type: "busy", busy: true });
    try {
      const report = await manifestOperationQueue.run(() =>
        apply(message.manifest, message.sourcesUrl),
      );
      figma.ui.postMessage(report);
      if (report.ok && cachedRelease) {
        postResolvedRelease(cachedRelease);
      }
    } finally {
      figma.ui.postMessage({ type: "busy", busy: false });
    }
    return;
  }
};

async function initializeReleaseFeed(): Promise<void> {
  const stored = await figma.clientStorage.getAsync(RELEASE_FEED_STORAGE_KEY);
  configuredFeedUrl = typeof stored === "string" ? stored : "";
  postReleaseState({ configuredUrl: configuredFeedUrl, loading: false });
  if (configuredFeedUrl) await checkReleaseFeed();
}

function postReleaseState(
  state: Omit<ReleaseState, "type">,
): void {
  figma.ui.postMessage({ type: "release-state", ...state } satisfies ReleaseState);
}

async function checkReleaseFeed(): Promise<void> {
  if (!configuredFeedUrl) {
    postReleaseState({ configuredUrl: "", loading: false });
    return;
  }

  postReleaseState({ configuredUrl: configuredFeedUrl, loading: true });
  try {
    const feedPayload = await fetchJson(configuredFeedUrl);
    const parsed = parseReleaseFeed(feedPayload, configuredFeedUrl);
    if (!parsed.ok || !parsed.release) {
      throw new Error(parsed.errors.join("\n"));
    }

    let release = parsed.release;
    if (!release.manifest && release.manifestUrl) {
      const manifestPayload = await fetchJson(release.manifestUrl);
      const validated = validateReleaseManifest(release, manifestPayload);
      if (!validated.ok || !validated.release) {
        throw new Error(validated.errors.join("\n"));
      }
      release = validated.release;
    }
    if (!release.manifest) {
      throw new Error("The release did not resolve to a library manifest.");
    }

    cachedRelease = release;
    postResolvedRelease(release);
  } catch (error) {
    cachedRelease = undefined;
    postReleaseState({
      configuredUrl: configuredFeedUrl,
      loading: false,
      error:
        error instanceof Error
          ? error.message
          : "The release feed could not be checked.",
    });
  }
}

function postResolvedRelease(release: ResolvedRelease): void {
  if (!release.manifest) return;
  const currentRelease = findAppliedRelease(release.libraryId);
  postReleaseState({
    configuredUrl: configuredFeedUrl,
    loading: false,
    currentRelease,
    release: {
      libraryId: release.libraryId,
      libraryName: release.libraryName,
      release: release.release,
      ...(release.status ? { status: release.status } : {}),
      changelog: release.changelog,
      ...(release.publishedAt ? { publishedAt: release.publishedAt } : {}),
      ...(release.sourceUrl ? { sourceUrl: release.sourceUrl } : {}),
      ...(release.sourcesUrl ? { sourcesUrl: release.sourcesUrl } : {}),
      pending: hasPendingRelease(currentRelease, release.release),
      manifest: release.manifest,
    },
  });
}

function findAppliedRelease(libraryId: string): string | undefined {
  const recorded = readAppliedReleases()[libraryId];
  if (recorded) return recorded;
  const releases = new Set(
    findManagedSceneNodes(libraryId)
      .map((node) => node.getSharedPluginData(PLUGIN_NAMESPACE, "release"))
      .filter((release) => release.length > 0),
  );
  return releases.size === 1 ? [...releases][0] : undefined;
}

function readAppliedReleases(): Record<string, string> {
  const stored = figma.root.getSharedPluginData(
    PLUGIN_NAMESPACE,
    APPLIED_RELEASES_KEY,
  );
  if (!stored) return {};
  try {
    const parsed = JSON.parse(stored);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === "string" && entry[1].length > 0,
      ),
    );
  } catch {
    return {};
  }
}

function recordAppliedRelease(manifest: PerfectLibrariesManifest): void {
  const releases = readAppliedReleases();
  releases[manifest.library.id] = manifest.library.release;
  figma.root.setSharedPluginData(
    PLUGIN_NAMESPACE,
    APPLIED_RELEASES_KEY,
    JSON.stringify(releases),
  );
}

async function fetchJson(url: string): Promise<unknown> {
  const normalized = normalizeReleaseSourceUrl(url);
  if (!normalized) {
    throw new Error(
      "Release sources must use HTTPS or a local development URL.",
    );
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error("The release source did not respond within 15 seconds.")),
      15_000,
    );
  });

  let response: Awaited<ReturnType<typeof fetch>>;
  try {
    response = await Promise.race([
      fetch(normalized, {
        method: "GET",
        headers: { Accept: "application/json" },
      }),
      timeoutPromise,
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new Error(`Request failed with ${response.status} ${response.statusText}.`);
  }

  const figmaResponse = response as typeof response & {
    headersObject?: Record<string, string>;
  };
  const declaredLength = Number(
    figmaResponse.headersObject?.["content-length"] ??
      response.headers?.get?.("content-length") ??
      "0",
  );
  if (declaredLength > MAX_FEED_BYTES) {
    throw new Error("The response is larger than the 12 MB safety limit.");
  }
  const source = await response.text();
  if (source.length > MAX_FEED_BYTES) {
    throw new Error("The response is larger than the 12 MB safety limit.");
  }
  try {
    return JSON.parse(source);
  } catch {
    throw new Error("The configured URL did not return valid JSON.");
  }
}

async function inspect(
  input: unknown,
  requestedSourcesUrl?: string,
): Promise<Report & { type: "report" }> {
  const validation = validateManifest(input);
  if (!validation.ok || !validation.manifest || !validation.summary) {
    return {
      type: "report",
      ok: false,
      title: "Manifest needs attention",
      errors: validation.errors,
      warnings: validation.warnings,
      details: [],
    };
  }

  await figma.loadAllPagesAsync();
  const sourcesUrl = selectReleaseSourcesUrl({
    libraryId: validation.manifest.library.id,
    release: validation.manifest.library.release,
    requestedSourcesUrl,
    cachedRelease,
  });
  await selectManagedSourcePage(validation.manifest, sourcesUrl);
  const resolvedSources = await resolveSourceLookup(
    validation.manifest,
    sourcesUrl,
  );
  const sourceLookup = resolvedSources.lookup;
  const managed = findManagedSceneNodes(validation.manifest.library.id);
  const autoLayoutWarnings = auditSourceAutoLayout(sourceLookup.nodes);

  return {
    type: "report",
    ok:
      resolvedSources.sourceErrors.length === 0 &&
      sourceLookup.errors.length === 0,
    title:
      resolvedSources.sourceErrors.length === 0 &&
      sourceLookup.errors.length === 0
        ? "Ready to forge"
        : "Source frames need attention",
    errors: [...resolvedSources.sourceErrors, ...sourceLookup.errors],
    warnings: [
      ...validation.warnings,
      ...resolvedSources.warnings,
      ...sourceLookup.warnings,
      ...autoLayoutWarnings,
    ],
    details: [
      `${validation.summary.collections} token collections`,
      `${validation.summary.tokens} variables`,
      `${validation.summary.components} components`,
      `${validation.summary.variants} variants`,
      `${managed.length} previously managed Figma nodes found in this file`,
    ],
  };
}

async function apply(
  input: unknown,
  requestedSourcesUrl?: string,
): Promise<Report & { type: "report" }> {
  const validation = validateManifest(input);
  if (!validation.ok || !validation.manifest) {
    return {
      type: "report",
      ok: false,
      title: "Manifest needs attention",
      errors: validation.errors,
      warnings: validation.warnings,
      details: [],
    };
  }

  const manifest = validation.manifest;
  await figma.loadAllPagesAsync();
  const sourcesUrl = selectReleaseSourcesUrl({
    libraryId: manifest.library.id,
    release: manifest.library.release,
    requestedSourcesUrl,
    cachedRelease,
  });
  await selectManagedSourcePage(manifest, sourcesUrl);
  const resolvedSources = await resolveSourceLookup(manifest, sourcesUrl);
  const sourceLookup = resolvedSources.lookup;
  const sourceWarnings = resolvedSources.warnings;
  if (resolvedSources.sourceErrors.length > 0) {
    return {
      type: "report",
      ok: false,
      title: "Storybook source export needs attention",
      errors: resolvedSources.sourceErrors,
      warnings: validation.warnings,
      details: [
        "The release manifest is valid, but its rendered Storybook source bundle is not.",
      ],
    };
  }
  if (sourceLookup.errors.length > 0) {
    return {
      type: "report",
      ok: false,
      title: "Nothing changed",
      errors: sourceLookup.errors,
      warnings: [...validation.warnings, ...sourceWarnings, ...sourceLookup.warnings],
      details: ["Resolve source-frame errors and inspect again before applying."],
    };
  }

  const counters: SyncCounters = {
    collectionsCreated: 0,
    collectionsUpdated: 0,
    variablesCreated: 0,
    variablesUpdated: 0,
    componentsCreated: 0,
    componentsUpdated: 0,
    componentSetsCreated: 0,
    nestedInstancesCreated: 0,
    bindingsApplied: 0,
    componentPropertiesApplied: 0,
    documentationPagesCreated: 0,
    documentationCardsCreated: 0,
  };
  const warnings = [...validation.warnings, ...sourceWarnings, ...sourceLookup.warnings];

  try {
    const variables = await syncVariables(manifest, counters);
    const orderedComponents = sortComponents(manifest.components);
    const componentRuntime = new Map<string, ComponentRuntime>();

    for (const component of orderedComponents) {
      const runtime = syncComponentFrames(
        manifest,
        component,
        sourceLookup.nodes,
        variables,
        counters,
        warnings,
      );
      componentRuntime.set(component.id, runtime);
    }

    for (const step of createSemanticSyncPlan(
      orderedComponents.map((component) => component.id),
    )) {
      const runtime = componentRuntime.get(step.componentId);
      if (!runtime) continue;
      if (step.phase === "nested-instances") {
        syncNestedInstances(runtime, componentRuntime, counters, warnings);
      } else {
        syncComponentProperties(runtime, componentRuntime, counters, warnings);
      }
    }

    const coverPage = await syncDocumentationPages(
      manifest,
      componentRuntime,
      variables,
      counters,
    );
    const managedNodes = findManagedSceneNodes(manifest.library.id);
    const auditWarnings = auditManagedComponents(managedNodes);
    warnings.push(...auditWarnings);

    await figma.setCurrentPageAsync(coverPage);
    const coverRoot = findManagedSceneNode(
      manifest.library.id,
      "documentation-root",
      "cover",
    );
    figma.currentPage.selection =
      coverRoot && coverRoot.type === "FRAME" ? [coverRoot] : [];
    if (figma.currentPage.selection.length > 0) {
      figma.viewport.scrollAndZoomIntoView(figma.currentPage.selection);
    }
    recordAppliedRelease(manifest);

    return {
      type: "report",
      ok: true,
      title: `Forged ${manifest.library.name} ${manifest.library.release}`,
      errors: [],
      warnings,
      details: [
        `${counters.variablesCreated} variables created, ${counters.variablesUpdated} updated`,
        `${counters.componentsCreated} variants created, ${counters.componentsUpdated} updated`,
        `${counters.nestedInstancesCreated} nested instances linked`,
        `${counters.bindingsApplied} variable bindings applied`,
        `${counters.documentationPagesCreated} documentation pages and ${counters.documentationCardsCreated} component cards generated`,
        "Review the selected components, then use Figma’s native library publishing flow.",
      ],
      counters,
      publishHandoff: {
        libraryName: manifest.library.name,
        release: manifest.library.release,
      },
    };
  } catch (error) {
    return {
      type: "report",
      ok: false,
      title: "Sync stopped",
      errors: [
        error instanceof Error ? error.message : "An unknown Figma error occurred.",
      ],
      warnings,
      details: [
        "Perfect Libraries never prunes unmanaged content. Changes completed before this error remain tagged and can be safely resumed.",
      ],
      counters,
    };
  }
}

async function resolveSourceLookup(
  manifest: PerfectLibrariesManifest,
  sourcesUrl?: string,
): Promise<ResolvedSourceLookup> {
  if (!sourcesUrl) {
    const lookup = findSourceNodes(manifest);
    const variantCount = manifest.components.reduce(
      (count, component) => count + component.variants.length,
      0,
    );
    if (variantCount > 0 && lookup.nodes.size === 0) {
      return {
        lookup: {
          nodes: lookup.nodes,
          warnings: lookup.warnings,
          errors: [missingSourceContextError(variantCount)],
        },
        warnings: [],
        sourceErrors: [],
      };
    }
    return {
      lookup,
      warnings: [],
      sourceErrors: [],
    };
  }

  try {
    const input = await fetchJson(sourcesUrl);
    const sources = validateSources(input);
    if (!sources.ok || !sources.sources) {
      return {
        lookup: { nodes: new Map(), warnings: [], errors: [] },
        warnings: [],
        sourceErrors: sources.errors,
      };
    }
    const contract = validateSourceContract(manifest, sources.sources);
    if (!contract.ok) {
      return {
        lookup: { nodes: new Map(), warnings: [], errors: [] },
        warnings: [],
        sourceErrors: contract.errors,
      };
    }
    const warnings = await materializeSources(manifest, sources.sources);
    return {
      lookup: findSourceNodes(manifest),
      warnings,
      sourceErrors: [],
    };
  } catch (error) {
    return {
      lookup: { nodes: new Map(), warnings: [], errors: [] },
      warnings: [],
      sourceErrors: [
        error instanceof Error
          ? error.message
          : "The Storybook source bundle could not be loaded.",
      ],
    };
  }
}

function sourcePaints(paints: SourcePaint[] | undefined): Paint[] {
  return (paints ?? []).map((paint): Paint => {
    if (paint.type === "GRADIENT_LINEAR") {
      return {
        type: "GRADIENT_LINEAR",
        gradientTransform: paint.gradientTransform,
        gradientStops: paint.gradientStops.map((stop) => ({
          position: stop.position,
          color: stop.color,
        })),
        opacity: paint.opacity ?? 1,
      };
    }
    return {
      type: "SOLID",
      color: paint.color,
      opacity: paint.opacity ?? paint.color.a ?? 1,
    };
  });
}

function sourceEffects(effects: SourceEffect[] | undefined): Effect[] {
  return (effects ?? []).map((effect) => ({
    type: effect.type,
    color: effect.color,
    offset: effect.offset,
    radius: effect.radius,
    ...(effect.spread !== undefined ? { spread: effect.spread } : {}),
    visible: true,
    blendMode: "NORMAL",
  }));
}

function applySourceGeometry(
  node: FrameNode | RectangleNode,
  source:
    | SourceFrameNode
    | Extract<SourceSceneNode, { type: "RECTANGLE" | "IMAGE" }>,
): void {
  if (source.topLeftRadius !== undefined) {
    node.topLeftRadius = source.topLeftRadius;
    node.topRightRadius = source.topRightRadius ?? source.topLeftRadius;
    node.bottomRightRadius = source.bottomRightRadius ?? source.topLeftRadius;
    node.bottomLeftRadius = source.bottomLeftRadius ?? source.topLeftRadius;
  } else {
    node.cornerRadius = source.cornerRadius ?? 0;
  }
  node.strokeAlign = source.strokeAlign ?? "CENTER";
  if (source.strokeTopWeight !== undefined) {
    node.strokeTopWeight = source.strokeTopWeight;
    node.strokeRightWeight = source.strokeRightWeight ?? source.strokeTopWeight;
    node.strokeBottomWeight = source.strokeBottomWeight ?? source.strokeTopWeight;
    node.strokeLeftWeight = source.strokeLeftWeight ?? source.strokeTopWeight;
  } else {
    node.strokeWeight = source.strokeWeight ?? 0;
  }
  node.effects = sourceEffects(source.effects);
}

async function sourceFont(
  source: SourceTextNode,
  fonts: readonly Font[],
  loaded: Set<string>,
): Promise<FontName> {
  const sourceMatch = selectSourceFontName(
    source.fontFamily,
    source.fontStyle,
    fonts,
  );
  const fallback =
    fonts.find(
      (font) =>
        font.fontName.family === "Inter" &&
        font.fontName.style === "Regular",
    ) ?? fonts[0];
  const selected = sourceMatch
    ? fonts.find(
        (font) =>
          font.fontName.family === sourceMatch.family &&
          font.fontName.style === sourceMatch.style,
      )
    : fallback;
  if (!selected) throw new Error("Figma did not report any available fonts.");
  const key = `${selected.fontName.family}\u0000${selected.fontName.style}`;
  if (!loaded.has(key)) {
    await figma.loadFontAsync(selected.fontName);
    loaded.add(key);
  }
  return selected.fontName;
}

async function createSourceSceneNode(
  source: SourceSceneNode,
  fonts: readonly Font[],
  loadedFonts: Set<string>,
): Promise<SceneNode> {
  if (source.type === "TEXT") {
    const text = figma.createText();
    text.name = source.name;
    text.fontName = await sourceFont(source, fonts, loadedFonts);
    text.characters = source.characters || " ";
    text.fontSize = source.fontSize;
    text.lineHeight = source.lineHeight
      ? { unit: "PIXELS", value: source.lineHeight }
      : { unit: "AUTO" };
    text.letterSpacing = {
      unit: "PIXELS",
      value: source.letterSpacing ?? 0,
    };
    text.textAlignHorizontal = source.textAlignHorizontal ?? "LEFT";
    text.fills = sourcePaints(source.fills);
    text.opacity = source.opacity ?? 1;
    if (isSingleLineSourceText(source)) {
      text.textAutoResize = "WIDTH_AND_HEIGHT";
    } else {
      text.textAutoResize = "NONE";
      text.resize(Math.max(1, source.width), Math.max(1, source.height));
    }
    text.x = source.x ?? 0;
    text.y = source.y ?? 0;
    return text;
  }

  if (source.type === "VECTOR") {
    const vector = figma.createNodeFromSvg(source.svg);
    vector.name = source.name;
    vector.setSharedPluginData(
      PLUGIN_NAMESPACE,
      "sourceRole",
      "vector-artwork",
    );
    vector.resize(Math.max(1, source.width), Math.max(1, source.height));
    vector.x = source.x ?? 0;
    vector.y = source.y ?? 0;
    vector.opacity = source.opacity ?? 1;
    return vector;
  }

  if (source.type === "IMAGE") {
    const rectangle = figma.createRectangle();
    const image = figma.createImage(figma.base64Decode(source.data));
    rectangle.name = source.name;
    rectangle.resize(Math.max(1, source.width), Math.max(1, source.height));
    rectangle.x = source.x ?? 0;
    rectangle.y = source.y ?? 0;
    rectangle.opacity = source.opacity ?? 1;
    rectangle.fills = [
      {
        type: "IMAGE",
        imageHash: image.hash,
        scaleMode: source.scaleMode ?? "FILL",
      },
    ];
    rectangle.strokes = sourcePaints(source.strokes);
    applySourceGeometry(rectangle, source);
    return rectangle;
  }

  if (source.type === "RECTANGLE") {
    const rectangle = figma.createRectangle();
    rectangle.name = source.name;
    rectangle.resize(Math.max(1, source.width), Math.max(1, source.height));
    rectangle.x = source.x ?? 0;
    rectangle.y = source.y ?? 0;
    rectangle.opacity = source.opacity ?? 1;
    rectangle.fills = sourcePaints(source.fills);
    rectangle.strokes = sourcePaints(source.strokes);
    applySourceGeometry(rectangle, source);
    return rectangle;
  }

  const frame = figma.createFrame();
  frame.name = source.name;
  frame.resizeWithoutConstraints(
    Math.max(1, source.width),
    Math.max(1, source.height),
  );
  frame.x = source.x ?? 0;
  frame.y = source.y ?? 0;
  frame.opacity = source.opacity ?? 1;
  frame.fills = sourcePaints(source.fills);
  frame.strokes = sourcePaints(source.strokes);
  applySourceGeometry(frame, source);
  frame.clipsContent = source.clipsContent ?? false;
  frame.layoutMode = source.layoutMode;
  if (source.layoutMode !== "NONE") {
    frame.primaryAxisAlignItems = source.primaryAxisAlignItems ?? "MIN";
    frame.counterAxisAlignItems = source.counterAxisAlignItems ?? "MIN";
    frame.paddingTop = source.paddingTop ?? 0;
    frame.paddingRight = source.paddingRight ?? 0;
    frame.paddingBottom = source.paddingBottom ?? 0;
    frame.paddingLeft = source.paddingLeft ?? 0;
    frame.itemSpacing = source.itemSpacing ?? 0;
    if ("layoutWrap" in frame) {
      frame.layoutWrap = source.layoutWrap ?? "NO_WRAP";
      frame.counterAxisSpacing = source.counterAxisSpacing ?? 0;
    }
  }
  for (const childSource of source.children) {
    const child = await createSourceSceneNode(
      childSource,
      fonts,
      loadedFonts,
    );
    frame.appendChild(child);
    if (source.layoutMode === "NONE") {
      child.x = childSource.x ?? 0;
      child.y = childSource.y ?? 0;
    }
  }
  if (source.layoutMode !== "NONE") {
    frame.primaryAxisSizingMode = source.primaryAxisSizingMode ?? "FIXED";
    frame.counterAxisSizingMode = source.counterAxisSizingMode ?? "FIXED";
  }
  return frame;
}

async function materializeSources(
  manifest: PerfectLibrariesManifest,
  sources: PerfectLibrariesSources,
): Promise<string[]> {
  if (
    sources.library.id !== manifest.library.id ||
    sources.library.release !== manifest.library.release
  ) {
    throw new Error(
      `Storybook sources ${sources.library.id}@${sources.library.release} do not match ${manifest.library.id}@${manifest.library.release}.`,
    );
  }
  const expected = new Map(
    manifest.components.flatMap((component) =>
      component.variants.map((variant) => [variant.id, variant] as const),
    ),
  );
  const provided = new Map(sources.variants.map((variant) => [variant.id, variant]));
  for (const [id, variant] of expected) {
    const source = provided.get(id);
    if (!source || source.sourceNode !== variant.sourceNode) {
      throw new Error(
        `Storybook source bundle is missing ${id} (${variant.sourceNode}).`,
      );
    }
  }

  const managedContainers = findManagedSceneNodesByEntity(
    manifest.library.id,
    "source-container",
    manifest.library.id,
  );
  if (managedContainers.some((candidate) => candidate.type !== "FRAME")) {
    throw new Error("The managed Storybook source container is not a frame.");
  }
  let [container, ...duplicateContainers] = managedContainers;
  for (const duplicate of duplicateContainers) duplicate.remove();
  if (!container) {
    container = figma.createFrame();
    figma.currentPage.appendChild(container);
  }
  const frame = container as FrameNode;
  for (const child of [...frame.children]) child.remove();
  frame.name = `${manifest.library.name} · Storybook sources · ${manifest.library.release}`;
  frame.layoutMode = "VERTICAL";
  frame.primaryAxisSizingMode = "AUTO";
  frame.counterAxisSizingMode = "AUTO";
  frame.itemSpacing = 48;
  frame.paddingTop = 48;
  frame.paddingRight = 48;
  frame.paddingBottom = 48;
  frame.paddingLeft = 48;
  frame.fills = [];
  frame.visible = false;
  tagManaged(
    frame as ManagedSceneNode,
    manifest,
    "source-container",
    manifest.library.id,
  );

  const fonts = await figma.listAvailableFontsAsync();
  const loadedFonts = new Set<string>();
  const warnings: string[] = [];
  for (const component of manifest.components) {
    for (const variant of component.variants) {
      const source = provided.get(variant.id);
      if (!source) continue;
      const node = await createSourceSceneNode(
        source.scene,
        fonts,
        loadedFonts,
      );
      if (node.type !== "FRAME") {
        node.remove();
        throw new Error(`Storybook source "${source.sourceNode}" is not a frame.`);
      }
      node.name = source.sourceNode;
      frame.appendChild(node);
      tagManaged(node as ManagedSceneNode, manifest, "source", variant.id);
      warnings.push(...(source.warnings ?? []).map((warning) => `${source.sourceNode}: ${warning}`));
    }
  }
  return warnings;
}

function findSourceNodes(manifest: PerfectLibrariesManifest): SourceLookup {
  const requested = new Map(
    manifest.components.flatMap((component) =>
      component.variants.map(
        (variant) => [variant.sourceNode, variant.id] as const,
      ),
    ),
  );
  const requestedNames = new Set(requested.keys());
  const matches = new Map<string, SceneNode[]>();
  for (const name of requestedNames) matches.set(name, []);

  for (const node of figma.currentPage.findAll()) {
    if (
      requestedNames.has(node.name) &&
      ["FRAME", "COMPONENT", "INSTANCE"].includes(node.type)
    ) {
      matches.get(node.name)?.push(node);
    }
  }

  const nodes = new Map<string, SceneNode>();
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const name of requestedNames) {
    const named = matches.get(name) ?? [];
    const expectedEntityId = requested.get(name);
    const managedSources = named.filter(
      (candidate) =>
        "getSharedPluginData" in candidate &&
        candidate.getSharedPluginData(PLUGIN_NAMESPACE, "libraryId") ===
          manifest.library.id &&
        candidate.getSharedPluginData(PLUGIN_NAMESPACE, "entityType") ===
          "source" &&
        candidate.getSharedPluginData(PLUGIN_NAMESPACE, "entityId") ===
          expectedEntityId &&
        candidate.getSharedPluginData(PLUGIN_NAMESPACE, "release") ===
          manifest.library.release,
    );
    const candidates = managedSources.length > 0 ? managedSources : named;
    if (candidates.length === 0) {
      errors.push(`Source node "${name}" was not found on the current page.`);
      continue;
    }
    if (candidates.length > 1) {
      errors.push(
        `Source node "${name}" is ambiguous; ${candidates.length} import frames have that exact name.`,
      );
      continue;
    }
    const node = candidates[0];
    if (!["FRAME", "COMPONENT", "INSTANCE"].includes(node.type)) {
      errors.push(
        `Source node "${name}" is ${node.type}; use a Frame, Component, or Instance.`,
      );
      continue;
    }
    const managedEntityType =
      "getSharedPluginData" in node
        ? node.getSharedPluginData(PLUGIN_NAMESPACE, "entityType")
        : "";
    if (
      isManaged(node, manifest.library.id) &&
      managedEntityType !== "source"
    ) {
      errors.push(
        `Source node "${name}" is already managed output. Keep imported source frames separate from the generated library.`,
      );
      continue;
    }
    nodes.set(name, node);
  }

  if (requestedNames.size === 0) {
    warnings.push("The manifest contains no component source nodes.");
  }
  return { nodes, errors, warnings };
}

function auditSourceAutoLayout(nodes: Map<string, SceneNode>): string[] {
  const warnings: string[] = [];
  for (const [sourceName, node] of nodes) {
    const offenders = [node, ...("findAll" in node ? node.findAll() : [])].filter(
      (candidate): candidate is FrameNode | ComponentNode | InstanceNode =>
        shouldWarnMissingAutoLayout({
          type: candidate.type,
          childCount: "children" in candidate ? candidate.children.length : 0,
          layoutMode:
            "layoutMode" in candidate ? candidate.layoutMode : undefined,
          sourceRole: candidate.getSharedPluginData(
            PLUGIN_NAMESPACE,
            "sourceRole",
          ),
        }),
    );
    if (offenders.length > 0) {
      warnings.push(
        `"${sourceName}" contains ${offenders.length} multi-child frame${offenders.length === 1 ? "" : "s"} without Auto Layout.`,
      );
    }
  }
  return warnings;
}

function findManagedSceneNodes(libraryId: string): ManagedSceneNode[] {
  return figma.root
    .findAllWithCriteria({
      sharedPluginData: {
        namespace: PLUGIN_NAMESPACE,
        keys: ["libraryId", "entityId", "entityType"],
      },
    })
    .filter(
      (node): node is ManagedSceneNode =>
        node.type !== "PAGE" &&
        "getSharedPluginData" in node &&
        node.getSharedPluginData(PLUGIN_NAMESPACE, "libraryId") === libraryId,
    );
}

function findManagedSceneNode(
  libraryId: string,
  entityType: string,
  entityId: string,
): ManagedSceneNode | undefined {
  return findManagedSceneNodes(libraryId).find(
    (node) =>
      node.getSharedPluginData(PLUGIN_NAMESPACE, "entityType") === entityType &&
      node.getSharedPluginData(PLUGIN_NAMESPACE, "entityId") === entityId,
  );
}

function findManagedSceneNodesByEntity(
  libraryId: string,
  entityType: string,
  entityId: string,
): ManagedSceneNode[] {
  return findManagedSceneNodes(libraryId).filter(
    (node) =>
      node.getSharedPluginData(PLUGIN_NAMESPACE, "entityType") === entityType &&
      node.getSharedPluginData(PLUGIN_NAMESPACE, "entityId") === entityId,
  );
}

function isManaged(node: SceneNode, libraryId: string): boolean {
  return (
    "getSharedPluginData" in node &&
    node.getSharedPluginData(PLUGIN_NAMESPACE, "libraryId") === libraryId
  );
}

function tagManaged(
  entity: ManagedSceneNode | ManagedPage | ManagedVariable | ManagedCollection,
  manifest: PerfectLibrariesManifest,
  entityType: string,
  entityId: string,
): void {
  entity.setSharedPluginData(
    PLUGIN_NAMESPACE,
    "libraryId",
    manifest.library.id,
  );
  entity.setSharedPluginData(PLUGIN_NAMESPACE, "entityType", entityType);
  entity.setSharedPluginData(PLUGIN_NAMESPACE, "entityId", entityId);
  entity.setSharedPluginData(
    PLUGIN_NAMESPACE,
    "release",
    manifest.library.release,
  );
}

async function syncVariables(
  manifest: PerfectLibrariesManifest,
  counters: SyncCounters,
): Promise<Map<string, Variable>> {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const variables = await figma.variables.getLocalVariablesAsync();
  const byTokenId = new Map<string, Variable>();
  const collectionByDefinition = new Map<string, VariableCollection>();

  for (const definition of manifest.tokenCollections) {
    let collection = collections.find(
      (candidate) =>
        candidate.getSharedPluginData(PLUGIN_NAMESPACE, "libraryId") ===
          manifest.library.id &&
        candidate.getSharedPluginData(PLUGIN_NAMESPACE, "entityType") ===
          "collection" &&
        candidate.getSharedPluginData(PLUGIN_NAMESPACE, "entityId") ===
          definition.id,
    );

    if (!collection) {
      const nameConflict = collections.find(
        (candidate) => candidate.name === definition.name,
      );
      if (nameConflict) {
        throw new Error(
          `Collection "${definition.name}" already exists but is not managed by this manifest. Rename it or change the manifest collection name; Perfect Libraries will not adopt it automatically.`,
        );
      }
      collection = figma.variables.createVariableCollection(definition.name);
      tagManaged(
        collection as ManagedCollection,
        manifest,
        "collection",
        definition.id,
      );
      counters.collectionsCreated += 1;
      collections.push(collection);
    } else {
      collection.name = definition.name;
      counters.collectionsUpdated += 1;
    }

    syncCollectionModes(collection, definition.modes);
    collectionByDefinition.set(definition.id, collection);

    for (const token of definition.tokens) {
      let variable = variables.find(
        (candidate) =>
          candidate.getSharedPluginData(PLUGIN_NAMESPACE, "libraryId") ===
            manifest.library.id &&
          candidate.getSharedPluginData(PLUGIN_NAMESPACE, "entityType") ===
            "variable" &&
          candidate.getSharedPluginData(PLUGIN_NAMESPACE, "entityId") === token.id,
      );

      if (variable && variable.resolvedType !== token.type) {
        throw new Error(
          `Token "${token.id}" changed type from ${variable.resolvedType} to ${token.type}. Figma cannot change a variable's type in place.`,
        );
      }

      if (!variable) {
        const nameConflict = variables.find(
          (candidate) =>
            candidate.variableCollectionId === collection?.id &&
            candidate.name === token.name,
        );
        if (nameConflict) {
          throw new Error(
            `Variable "${definition.name}/${token.name}" exists but is not managed by this manifest. Perfect Libraries will not overwrite it.`,
          );
        }
        variable = figma.variables.createVariable(
          token.name,
          collection,
          token.type,
        );
        tagManaged(
          variable as ManagedVariable,
          manifest,
          "variable",
          token.id,
        );
        counters.variablesCreated += 1;
        variables.push(variable);
      } else {
        if (variable.variableCollectionId !== collection.id) {
          throw new Error(
            `Token "${token.id}" moved between collections. Create a new token id to preserve existing Figma references.`,
          );
        }
        variable.name = token.name;
        counters.variablesUpdated += 1;
      }

      variable.description = token.description ?? "";
      if (token.type !== "BOOLEAN") {
        variable.scopes = token.scopes as VariableScope[];
      }
      for (const [platform, syntax] of Object.entries(token.codeSyntax ?? {})) {
        if (syntax) {
          variable.setVariableCodeSyntax(platform as CodeSyntaxPlatform, syntax);
        }
      }
      byTokenId.set(token.id, variable);
    }
  }

  for (const collectionDefinition of manifest.tokenCollections) {
    const collection = collectionByDefinition.get(collectionDefinition.id);
    if (!collection) continue;
    const modes = new Map(collection.modes.map((mode) => [mode.name, mode.modeId]));
    for (const token of collectionDefinition.tokens) {
      const variable = byTokenId.get(token.id);
      if (!variable) continue;
      for (const [modeName, rawValue] of Object.entries(token.values)) {
        const modeId = modes.get(modeName);
        if (!modeId) {
          throw new Error(
            `Mode "${modeName}" does not exist in collection "${collection.name}".`,
          );
        }
        variable.setValueForMode(
          modeId,
          resolveTokenValue(token, rawValue, byTokenId),
        );
      }
    }
  }

  return byTokenId;
}

function syncCollectionModes(
  collection: VariableCollection,
  requestedModes: string[],
): void {
  const existingByName = new Map(
    collection.modes.map((mode) => [mode.name, mode.modeId]),
  );

  if (
    collection.modes.length === 1 &&
    collection.modes[0].name === "Mode 1" &&
    !existingByName.has(requestedModes[0])
  ) {
    collection.renameMode(collection.modes[0].modeId, requestedModes[0]);
    existingByName.delete("Mode 1");
    existingByName.set(requestedModes[0], collection.modes[0].modeId);
  }

  for (const mode of requestedModes) {
    if (!existingByName.has(mode)) {
      const id = collection.addMode(mode);
      existingByName.set(mode, id);
    }
  }
}

function resolveTokenValue(
  token: TokenDefinition,
  rawValue: TokenValue,
  variables: Map<string, Variable>,
): VariableValue {
  if (typeof rawValue === "object" && rawValue !== null && "alias" in rawValue) {
    const target = variables.get(rawValue.alias);
    if (!target) {
      throw new Error(
        `Token "${token.id}" references missing alias "${rawValue.alias}".`,
      );
    }
    if (target.resolvedType !== token.type) {
      throw new Error(
        `Token "${token.id}" (${token.type}) cannot alias "${rawValue.alias}" (${target.resolvedType}).`,
      );
    }
    return figma.variables.createVariableAlias(target);
  }

  if (token.type === "COLOR") {
    return normalizeColor(rawValue);
  }
  if (
    token.type === "FLOAT" &&
    typeof rawValue !== "number"
  ) {
    throw new Error(`Token "${token.id}" expects a numeric value.`);
  }
  if (
    token.type === "STRING" &&
    typeof rawValue !== "string"
  ) {
    throw new Error(`Token "${token.id}" expects a string value.`);
  }
  if (
    token.type === "BOOLEAN" &&
    typeof rawValue !== "boolean"
  ) {
    throw new Error(`Token "${token.id}" expects a boolean value.`);
  }
  return rawValue as VariableValue;
}

function normalizeColor(value: TokenValue): RGB | RGBA {
  if (typeof value === "string") {
    const normalized = value.trim().replace(/^#/, "");
    if (![3, 4, 6, 8].includes(normalized.length)) {
      throw new Error(`Invalid color value "#${normalized}".`);
    }
    const expanded =
      normalized.length <= 4
        ? normalized
            .split("")
            .map((character) => `${character}${character}`)
            .join("")
        : normalized;
    const r = Number.parseInt(expanded.slice(0, 2), 16) / 255;
    const g = Number.parseInt(expanded.slice(2, 4), 16) / 255;
    const b = Number.parseInt(expanded.slice(4, 6), 16) / 255;
    if (expanded.length === 8) {
      return {
        r,
        g,
        b,
        a: Number.parseInt(expanded.slice(6, 8), 16) / 255,
      };
    }
    return { r, g, b };
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "r" in value &&
    "g" in value &&
    "b" in value
  ) {
    return {
      r: value.r,
      g: value.g,
      b: value.b,
      ...("a" in value && value.a !== undefined ? { a: value.a } : {}),
    };
  }
  throw new Error("COLOR tokens must use a hex string or r/g/b object.");
}

function sortComponents(
  components: ComponentDefinition[],
): ComponentDefinition[] {
  const byId = new Map(components.map((component) => [component.id, component]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: ComponentDefinition[] = [];

  function visit(id: string): void {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      throw new Error(`Component dependency cycle detected at "${id}".`);
    }
    const component = byId.get(id);
    if (!component) return;
    visiting.add(id);
    for (const dependency of component.dependencies ?? []) visit(dependency);
    for (const variant of component.variants) {
      for (const nested of variant.nestedInstances ?? []) {
        if (nested.component !== id) visit(nested.component);
      }
    }
    visiting.delete(id);
    visited.add(id);
    ordered.push(component);
  }

  for (const component of components) visit(component.id);
  return ordered;
}

function syncComponentFrames(
  manifest: PerfectLibrariesManifest,
  component: ComponentDefinition,
  sourceNodes: Map<string, SceneNode>,
  variables: Map<string, Variable>,
  counters: SyncCounters,
  warnings: string[],
): ComponentRuntime {
  const variants = new Map<string, ComponentNode>();
  let createdVariantInThisComponent = false;

  for (const variant of component.variants) {
    const source = sourceNodes.get(variant.sourceNode);
    if (!source) {
      throw new Error(`Source node "${variant.sourceNode}" disappeared.`);
    }
    const existing =
      component.variants.length === 1
        ? findManagedSceneNode(
            manifest.library.id,
            "component",
            component.id,
          )
        : findManagedSceneNode(
            manifest.library.id,
            "variant",
            variant.id,
          );
    let target: ComponentNode;

    if (existing) {
      if (existing.type !== "COMPONENT") {
        throw new Error(
          `Managed variant "${variant.id}" is unexpectedly ${existing.type}.`,
        );
      }
      target = existing;
      replaceComponentContents(target, source);
      counters.componentsUpdated += 1;
    } else {
      target = createComponentFromSource(source);
      counters.componentsCreated += 1;
      createdVariantInThisComponent = true;
    }

    target.name = formatVariantName(variant.properties);
    target.description = component.description ?? "";
    tagManaged(target, manifest, "variant", variant.id);
    applyBindings(target, variant.bindings ?? [], variables, counters);
    variants.set(variant.id, target);
  }

  let owner: ComponentOwner;
  let ownerIsNew = false;
  if (component.variants.length === 1) {
    owner = variants.get(component.variants[0].id) as ComponentNode;
    owner.name = component.name;
    tagManaged(owner, manifest, "component", component.id);
    ownerIsNew = createdVariantInThisComponent;
  } else {
    const existingSet = findManagedSceneNode(
      manifest.library.id,
      "component-set",
      component.id,
    );
    if (existingSet && existingSet.type !== "COMPONENT_SET") {
      throw new Error(
        `Managed component set "${component.id}" is unexpectedly ${existingSet.type}.`,
      );
    }

    if (existingSet?.type === "COMPONENT_SET") {
      owner = existingSet;
      for (const variant of variants.values()) {
        if (variant.parent !== owner) owner.appendChild(variant);
      }
    } else {
      owner = figma.combineAsVariants([...variants.values()], figma.currentPage);
      counters.componentSetsCreated += 1;
      ownerIsNew = true;
    }

    owner.name = component.name;
    owner.description = component.description ?? "";
    tagManaged(owner, manifest, "component-set", component.id);
    layoutVariantGrid(owner, component);
  }

  if (component.documentationUrl) {
    owner.documentationLinks = [{ uri: component.documentationUrl }];
  }
  if (ownerIsNew) placeNewOwner(owner);

  const variantIds = new Set(component.variants.map((variant) => variant.id));
  if (owner.type === "COMPONENT_SET") {
    const stale = owner.children.filter(
      (child) =>
        child.type === "COMPONENT" &&
        child.getSharedPluginData(PLUGIN_NAMESPACE, "libraryId") ===
          manifest.library.id &&
        !variantIds.has(
          child.getSharedPluginData(PLUGIN_NAMESPACE, "entityId"),
        ),
    );
    if (stale.length > 0) {
      warnings.push(
        `${component.name} has ${stale.length} stale managed variant${stale.length === 1 ? "" : "s"}; Perfect Libraries does not prune automatically.`,
      );
    }
  }

  return { definition: component, variants, owner };
}

function createComponentFromSource(source: SceneNode): ComponentNode {
  const clone = source.clone();
  if (clone.type === "COMPONENT") return clone;
  if (clone.type === "INSTANCE") {
    const detached = clone.detachInstance();
    return figma.createComponentFromNode(detached);
  }
  if (clone.type === "FRAME") {
    return figma.createComponentFromNode(clone);
  }
  clone.remove();
  throw new Error(`Cannot create a component from ${source.type}.`);
}

function replaceComponentContents(
  target: ComponentNode,
  source: SceneNode,
): void {
  const clone = source.clone();
  const frame: FrameNode | ComponentNode | SceneNode =
    clone.type === "INSTANCE" ? clone.detachInstance() : clone;
  if (!["FRAME", "COMPONENT"].includes(frame.type)) {
    frame.remove();
    throw new Error(`Cannot update a component from ${source.type}.`);
  }
  const sourceFrame = frame as FrameNode | ComponentNode;

  copyFrameProperties(target, sourceFrame);
  for (const child of [...target.children]) child.remove();
  for (const child of [...sourceFrame.children]) target.appendChild(child);
  sourceFrame.remove();
}

function copyFrameProperties(
  target: ComponentNode,
  source: FrameNode | ComponentNode,
): void {
  target.layoutMode = source.layoutMode;
  target.primaryAxisSizingMode = source.primaryAxisSizingMode;
  target.counterAxisSizingMode = source.counterAxisSizingMode;
  target.primaryAxisAlignItems = source.primaryAxisAlignItems;
  target.counterAxisAlignItems = source.counterAxisAlignItems;
  target.paddingTop = source.paddingTop;
  target.paddingRight = source.paddingRight;
  target.paddingBottom = source.paddingBottom;
  target.paddingLeft = source.paddingLeft;
  target.itemSpacing = source.itemSpacing;
  target.clipsContent = source.clipsContent;
  target.opacity = source.opacity;
  target.blendMode = source.blendMode;
  target.cornerRadius = source.cornerRadius;
  target.strokeTopWeight = source.strokeTopWeight;
  target.strokeRightWeight = source.strokeRightWeight;
  target.strokeBottomWeight = source.strokeBottomWeight;
  target.strokeLeftWeight = source.strokeLeftWeight;
  target.strokeAlign = source.strokeAlign;
  if (Array.isArray(source.fills)) target.fills = clonePaints(source.fills);
  if (Array.isArray(source.strokes)) target.strokes = clonePaints(source.strokes);
  target.effects = source.effects.map((effect) => ({ ...effect }));
  target.resizeWithoutConstraints(source.width, source.height);
}

function clonePaints(paints: readonly Paint[]): Paint[] {
  return JSON.parse(JSON.stringify(paints)) as Paint[];
}

function applyBindings(
  root: ComponentNode,
  bindings: VariableBindingDefinition[],
  variables: Map<string, Variable>,
  counters: SyncCounters,
): void {
  for (const binding of bindings) {
    const node = findLayer(root, binding.layer);
    if (!node) {
      throw new Error(
        `Binding layer "${binding.layer}" was not found in "${root.name}".`,
      );
    }
    const variable = variables.get(binding.token);
    if (!variable) {
      throw new Error(`Binding token "${binding.token}" was not created.`);
    }
    bindVariable(node, binding, variable);
    counters.bindingsApplied += 1;
  }
}

function bindVariable(
  node: SceneNode,
  binding: VariableBindingDefinition,
  variable: Variable,
): void {
  const property = binding.property;
  if (property === "fill" || property === "text-fill") {
    bindPaint(node, "fills", binding.paintIndex ?? 0, variable);
    return;
  }
  if (property === "stroke") {
    bindPaint(node, "strokes", binding.paintIndex ?? 0, variable);
    return;
  }

  const field = bindingField(property);
  if (!field || !("setBoundVariable" in node)) {
    throw new Error(
      `Property "${property}" cannot be bound on layer "${node.name}" (${node.type}).`,
    );
  }

  if (property === "radius") {
    for (const radiusField of [
      "topLeftRadius",
      "topRightRadius",
      "bottomRightRadius",
      "bottomLeftRadius",
    ] as const) {
      node.setBoundVariable(radiusField, variable);
    }
    return;
  }

  node.setBoundVariable(field, variable);
}

function bindingField(
  property: BindingProperty,
): VariableBindableNodeField | VariableBindableTextField | undefined {
  const fields: Partial<
    Record<
      BindingProperty,
      VariableBindableNodeField | VariableBindableTextField
    >
  > = {
    "padding-top": "paddingTop",
    "padding-right": "paddingRight",
    "padding-bottom": "paddingBottom",
    "padding-left": "paddingLeft",
    gap: "itemSpacing",
    "radius-top-left": "topLeftRadius",
    "radius-top-right": "topRightRadius",
    "radius-bottom-right": "bottomRightRadius",
    "radius-bottom-left": "bottomLeftRadius",
    "stroke-weight": "strokeWeight",
    opacity: "opacity",
    "font-size": "fontSize",
    "line-height": "lineHeight",
    "letter-spacing": "letterSpacing",
  };
  return fields[property];
}

function bindPaint(
  node: SceneNode,
  field: "fills" | "strokes",
  index: number,
  variable: Variable,
): void {
  const paints =
    field === "fills" && "fills" in node
      ? node.fills
      : field === "strokes" && "strokes" in node
        ? node.strokes
        : undefined;
  if (!Array.isArray(paints) || !paints[index]) {
    throw new Error(
      `Layer "${node.name}" has no ${field} paint at index ${index}.`,
    );
  }
  if (paints[index].type !== "SOLID") {
    throw new Error(
      `Layer "${node.name}" ${field} paint ${index} is ${paints[index].type}; only solid paint colors can be bound.`,
    );
  }
  const next = clonePaints(paints);
  next[index] = figma.variables.setBoundVariableForPaint(
    next[index] as SolidPaint,
    "color",
    variable,
  );
  if (field === "fills" && "fills" in node) {
    node.fills = next;
  } else if (field === "strokes" && "strokes" in node) {
    node.strokes = next;
  }
}

function findLayer(root: SceneNode, path: string): SceneNode | undefined {
  if (path === "$") return root;
  const segments = path.split("/").filter(Boolean);
  let current: SceneNode = root;
  for (const segment of segments) {
    if (!("children" in current)) return undefined;
    const matches = current.children.filter(
      (child): child is SceneNode =>
        "name" in child && child.name === segment && "visible" in child,
    );
    if (matches.length !== 1) return undefined;
    current = matches[0];
  }
  return current;
}

function layoutVariantGrid(
  componentSet: ComponentSetNode,
  component: ComponentDefinition,
): void {
  const requested = component.variants
    .map((variant) => ({
      definition: variant,
      node: componentSet.children.find(
        (child) =>
          child.type === "COMPONENT" &&
          child.getSharedPluginData(PLUGIN_NAMESPACE, "entityId") === variant.id,
      ),
    }))
    .filter(
      (
        item,
      ): item is { definition: ComponentVariantDefinition; node: ComponentNode } =>
        item.node?.type === "COMPONENT",
    );
  const requestedIds = new Set(requested.map(({ node }) => node.id));
  const stale = componentSet.children
    .filter(
      (node): node is ComponentNode =>
        node.type === "COMPONENT" && !requestedIds.has(node.id),
    )
    .map((node) => ({
      definition: {
        id: node.id,
        sourceNode: node.name,
        properties: {},
      },
      node,
    }));
  const ordered = [...requested, ...stale];

  const columns = Math.min(5, Math.max(1, Math.ceil(Math.sqrt(ordered.length))));
  const rows = Math.ceil(ordered.length / columns);
  const gap = 24;
  const padding = 40;
  const columnWidths = Array.from({ length: columns }, () => 0);
  const rowHeights = Array.from({ length: rows }, () => 0);

  ordered.forEach(({ node }, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    columnWidths[column] = Math.max(columnWidths[column], node.width);
    rowHeights[row] = Math.max(rowHeights[row], node.height);
  });

  ordered.forEach(({ node }, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    node.x =
      padding +
      columnWidths.slice(0, column).reduce((sum, width) => sum + width, 0) +
      column * gap;
    node.y =
      padding +
      rowHeights.slice(0, row).reduce((sum, height) => sum + height, 0) +
      row * gap;
  });

  componentSet.resizeWithoutConstraints(
    padding * 2 +
      columnWidths.reduce((sum, width) => sum + width, 0) +
      Math.max(0, columns - 1) * gap,
    padding * 2 +
      rowHeights.reduce((sum, height) => sum + height, 0) +
      Math.max(0, rows - 1) * gap,
  );
}

function placeNewOwner(owner: ComponentOwner): void {
  const siblings = figma.currentPage.children.filter((node) => node !== owner);
  const rightEdge = siblings.reduce(
    (maximum, node) => Math.max(maximum, node.x + node.width),
    0,
  );
  owner.x = Math.max(80, rightEdge + 160);
  owner.y = 80;
}

function syncNestedInstances(
  runtime: ComponentRuntime,
  runtimes: Map<string, ComponentRuntime>,
  counters: SyncCounters,
  warnings: string[],
): void {
  for (const variantDefinition of runtime.definition.variants) {
    const variant = runtime.variants.get(variantDefinition.id);
    if (!variant) continue;
    for (const nested of variantDefinition.nestedInstances ?? []) {
      if (nested.component === runtime.definition.id) {
        throw new Error(
          `Component "${runtime.definition.id}" cannot nest an instance of itself.`,
        );
      }
      const marker = findLayer(variant, nested.layer);
      if (!marker) {
        throw new Error(
          `Nested-instance layer "${nested.layer}" was not found in "${variant.name}".`,
        );
      }
      if (
        marker.type === "INSTANCE" &&
        marker.getSharedPluginData(PLUGIN_NAMESPACE, "nestedComponent") ===
          nested.component
      ) {
        continue;
      }
      const target = resolveNestedTarget(nested, runtimes);
      replaceWithInstance(marker, target, nested);
      counters.nestedInstancesCreated += 1;
    }
  }

  if ((runtime.definition.dependencies ?? []).length === 0) {
    const inferred = new Set(
      runtime.definition.variants.flatMap((variant) =>
        (variant.nestedInstances ?? []).map((nested) => nested.component),
      ),
    );
    if (inferred.size > 0) {
      warnings.push(
        `${runtime.definition.name} inferred ${inferred.size} nested dependenc${inferred.size === 1 ? "y" : "ies"}; declare dependencies to make build order explicit.`,
      );
    }
  }
}

function resolveNestedTarget(
  nested: NestedInstanceDefinition,
  runtimes: Map<string, ComponentRuntime>,
): ComponentNode {
  const targetRuntime = runtimes.get(nested.component);
  if (!targetRuntime) {
    throw new Error(`Nested component "${nested.component}" was not created.`);
  }
  const requested = nested.variant ?? {};
  const definition = targetRuntime.definition.variants.find((variant) =>
    Object.entries(requested).every(
      ([key, value]) => variant.properties[key] === value,
    ),
  );
  const selectedDefinition = definition ?? targetRuntime.definition.variants[0];
  const target = targetRuntime.variants.get(selectedDefinition.id);
  if (!target) {
    throw new Error(
      `No generated variant was found for nested component "${nested.component}".`,
    );
  }
  return target;
}

function replaceWithInstance(
  marker: SceneNode,
  target: ComponentNode,
  nested: NestedInstanceDefinition,
): void {
  const parent = marker.parent;
  if (!parent || !("insertChild" in parent)) {
    throw new Error(`Layer "${marker.name}" cannot be replaced in its parent.`);
  }
  const index = parent.children.indexOf(marker);
  const x = marker.x;
  const y = marker.y;
  const width = marker.width;
  const height = marker.height;
  const horizontal =
    "layoutSizingHorizontal" in marker
      ? marker.layoutSizingHorizontal
      : "FIXED";
  const vertical =
    "layoutSizingVertical" in marker ? marker.layoutSizingVertical : "FIXED";

  const instance = target.createInstance();
  instance.name = marker.name;
  parent.insertChild(index, instance);
  marker.remove();
  instance.resizeWithoutConstraints(width, height);

  if ("layoutMode" in parent && parent.layoutMode !== "NONE") {
    try {
      instance.layoutSizingHorizontal = horizontal;
      instance.layoutSizingVertical = vertical;
    } catch {}
  } else {
    instance.x = x;
    instance.y = y;
  }
  instance.setSharedPluginData(
    PLUGIN_NAMESPACE,
    "nestedComponent",
    nested.component,
  );
  setFriendlyInstanceProperties(instance, nested.properties ?? {});
}

function syncComponentProperties(
  runtime: ComponentRuntime,
  runtimes: Map<string, ComponentRuntime>,
  counters: SyncCounters,
  warnings: string[],
): void {
  for (const definition of runtime.definition.properties ?? []) {
    const key = ensureComponentProperty(runtime.owner, definition, runtimes);
    for (const variant of runtime.variants.values()) {
      const node = findLayer(variant, definition.layer);
      if (!node) {
        warnings.push(
          `${runtime.definition.name}: property layer "${definition.layer}" was not found in "${variant.name}".`,
        );
        continue;
      }
      const current = node.componentPropertyReferences ?? {};
      if (definition.type === "TEXT") {
        if (node.type !== "TEXT") {
          throw new Error(
            `TEXT property "${definition.name}" requires a Text layer, but "${definition.layer}" is ${node.type}.`,
          );
        }
        node.componentPropertyReferences = { ...current, characters: key };
      } else if (definition.type === "BOOLEAN") {
        node.componentPropertyReferences = { ...current, visible: key };
      } else {
        if (node.type !== "INSTANCE") {
          throw new Error(
            `INSTANCE_SWAP property "${definition.name}" requires an Instance layer, but "${definition.layer}" is ${node.type}.`,
          );
        }
        node.componentPropertyReferences = { ...current, mainComponent: key };
      }
      counters.componentPropertiesApplied += 1;
    }
  }
}

function ensureComponentProperty(
  owner: ComponentOwner,
  definition: ComponentPropertyDefinition,
  runtimes: Map<string, ComponentRuntime>,
): string {
  const existing = Object.keys(owner.componentPropertyDefinitions).find(
    (key) => key === definition.name || key.startsWith(`${definition.name}#`),
  );
  if (existing) {
    const current = owner.componentPropertyDefinitions[existing];
    if (current.type !== definition.type) {
      throw new Error(
        `Component property "${definition.name}" changed type from ${current.type} to ${definition.type}.`,
      );
    }
    return existing;
  }

  if (definition.type === "TEXT") {
    return owner.addComponentProperty(
      definition.name,
      "TEXT",
      definition.defaultValue,
    );
  }
  if (definition.type === "BOOLEAN") {
    return owner.addComponentProperty(
      definition.name,
      "BOOLEAN",
      definition.defaultValue,
    );
  }

  const target = runtimes.get(definition.defaultComponent);
  if (!target) {
    throw new Error(
      `Default component "${definition.defaultComponent}" for "${definition.name}" was not created.`,
    );
  }
  const defaultVariant = target.variants.values().next().value as
    | ComponentNode
    | undefined;
  if (!defaultVariant) {
    throw new Error(
      `Default component "${definition.defaultComponent}" has no variants.`,
    );
  }
  return owner.addComponentProperty(
    definition.name,
    "INSTANCE_SWAP",
    defaultVariant.id,
  );
}

function setFriendlyInstanceProperties(
  instance: InstanceNode,
  values: Record<string, string | boolean>,
): void {
  const definitions = instance.componentProperties;
  const resolved: Record<string, string | boolean> = {};
  for (const [friendlyName, value] of Object.entries(values)) {
    const key = Object.keys(definitions).find(
      (candidate) =>
        candidate === friendlyName || candidate.startsWith(`${friendlyName}#`),
    );
    if (!key) {
      throw new Error(
        `Instance "${instance.name}" has no component property "${friendlyName}".`,
      );
    }
    resolved[key] = value;
  }
  if (Object.keys(resolved).length > 0) instance.setProperties(resolved);
}

interface DocumentationFonts {
  heading: FontName;
  body: FontName;
  bodyMedium: FontName;
}

const DOCUMENTATION_COLORS = {
  canvas: "#f4ead6",
  card: "#fbf4e2",
  inner: "#f7ecd5",
  subtle: "#efe2c8",
  borderCard: "#e5d8ba",
  borderSubtle: "#dfcfad",
  textStrong: "#2f2a22",
  textBody: "#51493d",
  textMuted: "#7b705f",
};

function findManagedPage(
  libraryId: string,
  entityId: string,
): ManagedPage | undefined {
  return figma.root.children.find(
    (page) =>
      page.getSharedPluginData(PLUGIN_NAMESPACE, "libraryId") === libraryId &&
      page.getSharedPluginData(PLUGIN_NAMESPACE, "entityType") ===
        "documentation-page" &&
      page.getSharedPluginData(PLUGIN_NAMESPACE, "entityId") === entityId,
  ) as ManagedPage | undefined;
}

async function selectManagedSourcePage(
  manifest: PerfectLibrariesManifest,
  sourcesUrl?: string,
): Promise<void> {
  if (!sourcesUrl) return;
  let page = findManagedPage(manifest.library.id, "sources");
  if (!page) {
    page = figma.createPage() as ManagedPage;
    tagManaged(page, manifest, "documentation-page", "sources");
  }
  page.name = "98 · Import sources";
  page.backgrounds = [documentationPaint(DOCUMENTATION_COLORS.canvas)];
  await figma.setCurrentPageAsync(page);
}

function ensureManagedPage(
  manifest: PerfectLibrariesManifest,
  entityId: string,
  name: string,
  counters: SyncCounters,
): ManagedPage {
  let page = findManagedPage(manifest.library.id, entityId);
  if (!page) {
    page = figma.createPage() as ManagedPage;
    tagManaged(page, manifest, "documentation-page", entityId);
    counters.documentationPagesCreated += 1;
  }
  page.name = name;
  page.backgrounds = [documentationPaint(DOCUMENTATION_COLORS.canvas)];
  return page;
}

function documentationPaint(
  hex: string,
  variable?: Variable,
): SolidPaint {
  const normalized = normalizeColor(hex);
  const paint: SolidPaint = {
    type: "SOLID",
    color: { r: normalized.r, g: normalized.g, b: normalized.b },
    ...("a" in normalized && normalized.a !== undefined
      ? { opacity: normalized.a }
      : {}),
  };
  return variable
    ? figma.variables.setBoundVariableForPaint(paint, "color", variable)
    : paint;
}

function setDocumentationFill(
  node: FrameNode | TextNode,
  fallback: string,
  tokenId: string,
  variables: Map<string, Variable>,
): void {
  node.fills = [documentationPaint(fallback, variables.get(tokenId))];
}

function setDocumentationStroke(
  node: FrameNode,
  fallback: string,
  tokenId: string,
  variables: Map<string, Variable>,
): void {
  node.strokes = [documentationPaint(fallback, variables.get(tokenId))];
}

function setDocumentationRadius(
  node: FrameNode,
  fallback: number,
  tokenId: string,
  variables: Map<string, Variable>,
): void {
  node.cornerRadius = fallback;
  const variable = variables.get(tokenId);
  if (!variable) return;
  node.setBoundVariable("topLeftRadius", variable);
  node.setBoundVariable("topRightRadius", variable);
  node.setBoundVariable("bottomRightRadius", variable);
  node.setBoundVariable("bottomLeftRadius", variable);
}

function chooseDocumentationFont(
  fonts: readonly Font[],
  preferences: Array<[string, string]>,
): FontName {
  for (const [family, style] of preferences) {
    const match = fonts.find(
      (font) =>
        font.fontName.family === family && font.fontName.style === style,
    );
    if (match) return match.fontName;
  }
  const fallback = fonts[0];
  if (!fallback) throw new Error("Figma did not report any available fonts.");
  return fallback.fontName;
}

async function loadDocumentationFonts(): Promise<DocumentationFonts> {
  const available = await figma.listAvailableFontsAsync();
  const heading = chooseDocumentationFont(available, [
    ["Gelica", "Medium"],
    ["Gelica", "Regular"],
    ["Inter", "Medium"],
    ["Inter", "Regular"],
  ]);
  const body = chooseDocumentationFont(available, [
    ["SN Pro", "Regular"],
    ["Inter", "Regular"],
  ]);
  const bodyMedium = chooseDocumentationFont(available, [
    ["SN Pro", "Medium"],
    ["Inter", "Medium"],
    ["Inter", "Regular"],
  ]);
  for (const font of [heading, body, bodyMedium]) {
    await figma.loadFontAsync(font);
  }
  return { heading, body, bodyMedium };
}

function createDocumentationFrame(
  name: string,
  width: number,
  gap: number,
  padding: number,
): FrameNode {
  const frame = figma.createFrame();
  frame.name = name;
  frame.layoutMode = "VERTICAL";
  frame.primaryAxisSizingMode = "AUTO";
  frame.counterAxisSizingMode = "FIXED";
  frame.primaryAxisAlignItems = "MIN";
  frame.counterAxisAlignItems = "MIN";
  frame.itemSpacing = gap;
  frame.paddingTop = padding;
  frame.paddingRight = padding;
  frame.paddingBottom = padding;
  frame.paddingLeft = padding;
  frame.resizeWithoutConstraints(width, 100);
  frame.clipsContent = false;
  return frame;
}

function createDocumentationText(
  characters: string,
  font: FontName,
  fontSize: number,
  lineHeight: number,
  width: number,
  fallback: string,
  tokenId: string,
  variables: Map<string, Variable>,
): TextNode {
  const text = figma.createText();
  text.fontName = font;
  text.characters = characters || " ";
  text.fontSize = fontSize;
  text.lineHeight = { unit: "PIXELS", value: lineHeight };
  text.textAutoResize = "HEIGHT";
  text.resize(width, lineHeight);
  setDocumentationFill(text, fallback, tokenId, variables);
  return text;
}

function appendDocumentationText(
  parent: FrameNode,
  text: TextNode,
): void {
  parent.appendChild(text);
  text.layoutSizingHorizontal = "FILL";
}

function clearDocumentationRoot(
  page: PageNode,
  manifest: PerfectLibrariesManifest,
  entityId: string,
): void {
  for (const node of page.children) {
    if (
      "getSharedPluginData" in node &&
      node.getSharedPluginData(PLUGIN_NAMESPACE, "libraryId") ===
        manifest.library.id &&
      node.getSharedPluginData(PLUGIN_NAMESPACE, "entityType") ===
        "documentation-root" &&
      node.getSharedPluginData(PLUGIN_NAMESPACE, "entityId") === entityId
    ) {
      node.remove();
    }
  }
}

function addDocumentationSection(
  card: FrameNode,
  title: string,
  lines: string[],
  fonts: DocumentationFonts,
  variables: Map<string, Variable>,
): void {
  if (lines.length === 0) return;
  const section = createDocumentationFrame(title, 1120, 10, 0);
  section.fills = [];
  card.appendChild(section);
  section.layoutSizingHorizontal = "FILL";
  appendDocumentationText(
    section,
    createDocumentationText(
      title,
      fonts.heading,
      20,
      28,
      1120,
      DOCUMENTATION_COLORS.textStrong,
      "text-strong",
      variables,
    ),
  );
  for (const line of lines) {
    appendDocumentationText(
      section,
      createDocumentationText(
        line,
        fonts.body,
        14,
        21,
        1120,
        DOCUMENTATION_COLORS.textBody,
        "text-body",
        variables,
      ),
    );
  }
}

function formatDefaultValue(value: unknown): string {
  if (typeof value === "string") return `“${value}”`;
  return JSON.stringify(value);
}

function propertyDocumentationLines(
  component: DocumentationComponent,
): string[] {
  return component.properties.map((property) => {
    const defaultValue =
      property.type === "INSTANCE_SWAP"
        ? property.defaultComponent
        : property.defaultValue;
    return `${property.name} · ${property.type.toLowerCase().replace("_", " ")} · default ${formatDefaultValue(defaultValue)}`;
  });
}

function controlDocumentationLines(
  component: DocumentationComponent,
): string[] {
  return component.controls.map((control) => {
    const details = [
      control.type,
      control.options?.length ? `options ${control.options.join(" · ")}` : "",
      control.defaultValue !== undefined
        ? `default ${formatDefaultValue(control.defaultValue)}`
        : "",
      control.category ? `category ${control.category}` : "",
    ].filter(Boolean);
    return `${control.label ?? control.name} · ${details.join(" · ")}${control.description ? `\n${control.description}` : ""}`;
  });
}

function buildCombinationGallery(
  manifest: PerfectLibrariesManifest,
  component: DocumentationComponent,
  runtime: ComponentRuntime,
  fonts: DocumentationFonts,
  variables: Map<string, Variable>,
): FrameNode {
  const gallery = figma.createFrame();
  gallery.name = "Supported combinations";
  gallery.layoutMode = "HORIZONTAL";
  gallery.layoutWrap = "WRAP";
  gallery.primaryAxisSizingMode = "FIXED";
  gallery.counterAxisSizingMode = "AUTO";
  gallery.primaryAxisAlignItems = "MIN";
  gallery.counterAxisAlignItems = "MIN";
  gallery.itemSpacing = 16;
  gallery.counterAxisSpacing = 16;
  gallery.paddingTop = 24;
  gallery.paddingRight = 24;
  gallery.paddingBottom = 24;
  gallery.paddingLeft = 24;
  gallery.resizeWithoutConstraints(1120, 100);
  setDocumentationFill(
    gallery,
    DOCUMENTATION_COLORS.inner,
    "bg-inner",
    variables,
  );
  setDocumentationStroke(
    gallery,
    DOCUMENTATION_COLORS.borderSubtle,
    "border-subtle",
    variables,
  );
  gallery.strokeWeight = 1;
  setDocumentationRadius(gallery, 14, "radius-card", variables);

  for (const combination of component.combinations) {
    const variant = runtime.variants.get(combination.variantId);
    if (!variant) continue;
    const instance = variant.createInstance();
    const tileWidth = Math.max(240, Math.min(520, instance.width + 48));
    const tile = createDocumentationFrame(
      combination.label,
      tileWidth,
      16,
      20,
    );
    setDocumentationFill(
      tile,
      DOCUMENTATION_COLORS.card,
      "bg-card",
      variables,
    );
    setDocumentationRadius(tile, 8, "radius-control", variables);
    appendDocumentationText(
      tile,
      createDocumentationText(
        combination.label,
        fonts.bodyMedium,
        13,
        18,
        tileWidth - 40,
        DOCUMENTATION_COLORS.textMuted,
        "text-muted",
        variables,
      ),
    );
    tile.appendChild(instance);
    gallery.appendChild(tile);
    tagManaged(
      tile as ManagedSceneNode,
      manifest,
      "documentation-combination",
      combination.variantId,
    );
  }
  return gallery;
}

function buildComponentDocumentationCard(
  manifest: PerfectLibrariesManifest,
  component: DocumentationComponent,
  runtime: ComponentRuntime,
  fonts: DocumentationFonts,
  variables: Map<string, Variable>,
): FrameNode {
  const card = createDocumentationFrame(component.name, 1280, 28, 40);
  setDocumentationFill(card, DOCUMENTATION_COLORS.card, "bg-card", variables);
  setDocumentationStroke(
    card,
    DOCUMENTATION_COLORS.borderCard,
    "border-card",
    variables,
  );
  card.strokeWeight = 1;
  setDocumentationRadius(card, 18, "radius-container", variables);
  card.effects = [
    {
      type: "DROP_SHADOW",
      color: { r: 0.28, g: 0.22, b: 0.14, a: 0.1 },
      offset: { x: 0, y: 8 },
      radius: 24,
      spread: 0,
      visible: true,
      blendMode: "NORMAL",
    },
  ];
  tagManaged(
    card as ManagedSceneNode,
    manifest,
    "documentation-card",
    component.id,
  );

  appendDocumentationText(
    card,
    createDocumentationText(
      component.name,
      fonts.heading,
      38,
      46,
      1200,
      DOCUMENTATION_COLORS.textStrong,
      "text-strong",
      variables,
    ),
  );
  if (component.description) {
    appendDocumentationText(
      card,
      createDocumentationText(
        component.description,
        fonts.body,
        17,
        26,
        1200,
        DOCUMENTATION_COLORS.textBody,
        "text-body",
        variables,
      ),
    );
  }
  if (component.documentationUrl) {
    const link = createDocumentationText(
      "Open this component in Storybook ↗",
      fonts.bodyMedium,
      14,
      20,
      1200,
      "#6552c8",
      "accent-bluebell",
      variables,
    );
    link.hyperlink = { type: "URL", value: component.documentationUrl };
    appendDocumentationText(card, link);
  }

  addDocumentationSection(
    card,
    "Variant axes",
    component.axes.map((axis) => `${axis.name} · ${axis.values.join(" · ")}`),
    fonts,
    variables,
  );
  addDocumentationSection(
    card,
    "Editable Figma properties",
    propertyDocumentationLines(component),
    fonts,
    variables,
  );
  addDocumentationSection(
    card,
    "Storybook controls & actions",
    controlDocumentationLines(component),
    fonts,
    variables,
  );
  addDocumentationSection(
    card,
    "Composition",
    [
      component.uses.length ? `Uses · ${component.uses.join(" · ")}` : "",
      component.usedBy.length
        ? `Used by · ${component.usedBy.join(" · ")}`
        : "",
    ].filter(Boolean),
    fonts,
    variables,
  );
  addDocumentationSection(
    card,
    `Supported combinations · ${component.combinations.length}`,
    ["The gallery below shows every supported Storybook combination exactly as declared."],
    fonts,
    variables,
  );
  const gallery = buildCombinationGallery(
    manifest,
    component,
    runtime,
    fonts,
    variables,
  );
  card.appendChild(gallery);
  gallery.layoutSizingHorizontal = "FILL";
  return card;
}

function buildGroupDocumentationRoot(
  manifest: PerfectLibrariesManifest,
  group: DocumentationGroup,
  runtimes: Map<string, ComponentRuntime>,
  fonts: DocumentationFonts,
  variables: Map<string, Variable>,
  counters: SyncCounters,
): FrameNode {
  const root = createDocumentationFrame(group.name, 1440, 40, 80);
  root.fills = [];
  tagManaged(
    root as ManagedSceneNode,
    manifest,
    "documentation-root",
    group.id,
  );
  appendDocumentationText(
    root,
    createDocumentationText(
      group.name,
      fonts.heading,
      48,
      56,
      1280,
      DOCUMENTATION_COLORS.textStrong,
      "text-strong",
      variables,
    ),
  );
  appendDocumentationText(
    root,
    createDocumentationText(
      `${group.components.length} component${group.components.length === 1 ? "" : "s"} · generated from Storybook`,
      fonts.body,
      17,
      26,
      1280,
      DOCUMENTATION_COLORS.textMuted,
      "text-muted",
      variables,
    ),
  );
  for (const component of group.components) {
    const runtime = runtimes.get(component.id);
    if (!runtime) continue;
    root.appendChild(
      buildComponentDocumentationCard(
        manifest,
        component,
        runtime,
        fonts,
        variables,
      ),
    );
    counters.documentationCardsCreated += 1;
  }
  return root;
}

function buildCoverRoot(
  manifest: PerfectLibrariesManifest,
  groups: DocumentationGroup[],
  fonts: DocumentationFonts,
  variables: Map<string, Variable>,
): FrameNode {
  const root = createDocumentationFrame("Cover", 1440, 28, 80);
  setDocumentationFill(root, DOCUMENTATION_COLORS.card, "bg-card", variables);
  setDocumentationRadius(root, 18, "radius-container", variables);
  tagManaged(
    root as ManagedSceneNode,
    manifest,
    "documentation-root",
    "cover",
  );
  appendDocumentationText(
    root,
    createDocumentationText(
      manifest.library.name,
      fonts.heading,
      64,
      72,
      1280,
      DOCUMENTATION_COLORS.textStrong,
      "text-strong",
      variables,
    ),
  );
  appendDocumentationText(
    root,
    createDocumentationText(
      `Release ${manifest.library.release}`,
      fonts.bodyMedium,
      18,
      26,
      1280,
      DOCUMENTATION_COLORS.textMuted,
      "text-muted",
      variables,
    ),
  );
  appendDocumentationText(
    root,
    createDocumentationText(
      `${manifest.components.length} components · ${manifest.components.reduce((count, component) => count + component.variants.length, 0)} exact variants · ${manifest.tokenCollections.reduce((count, collection) => count + collection.tokens.length, 0)} design variables`,
      fonts.body,
      20,
      30,
      1280,
      DOCUMENTATION_COLORS.textBody,
      "text-body",
      variables,
    ),
  );
  appendDocumentationText(
    root,
    createDocumentationText(
      "This file is generated from the Storybook catalog. Component descriptions, controls, actions, supported combinations, relationships, and previews update with each UI release.",
      fonts.body,
      18,
      28,
      1280,
      DOCUMENTATION_COLORS.textBody,
      "text-body",
      variables,
    ),
  );
  addDocumentationSection(
    root,
    "Library sections",
    groups.map(
      (group, index) =>
        `${String(index + 1).padStart(2, "0")} · ${group.name} · ${group.components.length} components`,
    ),
    fonts,
    variables,
  );
  return root;
}

function layoutLibraryAssets(
  manifest: PerfectLibrariesManifest,
  page: PageNode,
  runtimes: Map<string, ComponentRuntime>,
  fonts: DocumentationFonts,
  variables: Map<string, Variable>,
): void {
  clearDocumentationRoot(page, manifest, "assets");
  const header = createDocumentationFrame("Library assets", 1440, 12, 40);
  setDocumentationFill(header, DOCUMENTATION_COLORS.card, "bg-card", variables);
  setDocumentationRadius(header, 18, "radius-container", variables);
  tagManaged(
    header as ManagedSceneNode,
    manifest,
    "documentation-root",
    "assets",
  );
  appendDocumentationText(
    header,
    createDocumentationText(
      "Library assets",
      fonts.heading,
      40,
      48,
      1360,
      DOCUMENTATION_COLORS.textStrong,
      "text-strong",
      variables,
    ),
  );
  appendDocumentationText(
    header,
    createDocumentationText(
      "Canonical publishable components. Use the numbered pages for guidance and combination previews.",
      fonts.body,
      16,
      24,
      1360,
      DOCUMENTATION_COLORS.textBody,
      "text-body",
      variables,
    ),
  );
  page.appendChild(header);
  header.x = 80;
  header.y = 80;

  let x = 80;
  let y = header.y + header.height + 120;
  let rowHeight = 0;
  for (const runtime of [...runtimes.values()].sort((left, right) =>
    left.definition.name.localeCompare(right.definition.name),
  )) {
    const owner = runtime.owner;
    page.appendChild(owner);
    if (x > 80 && x + owner.width > 2800) {
      x = 80;
      y += rowHeight + 120;
      rowHeight = 0;
    }
    owner.x = x;
    owner.y = y;
    x += owner.width + 120;
    rowHeight = Math.max(rowHeight, owner.height);
  }
}

function reconcileDocumentationPages(
  manifest: PerfectLibrariesManifest,
  desiredEntityIds: Set<string>,
): void {
  for (const page of [...figma.root.children]) {
    if (
      page.getSharedPluginData(PLUGIN_NAMESPACE, "libraryId") !==
        manifest.library.id ||
      page.getSharedPluginData(PLUGIN_NAMESPACE, "entityType") !==
        "documentation-page"
    ) {
      continue;
    }
    const entityId = page.getSharedPluginData(
      PLUGIN_NAMESPACE,
      "entityId",
    );
    if (desiredEntityIds.has(entityId)) continue;
    for (const node of [...page.children]) {
      if (
        "getSharedPluginData" in node &&
        node.getSharedPluginData(PLUGIN_NAMESPACE, "libraryId") ===
          manifest.library.id &&
        node.getSharedPluginData(PLUGIN_NAMESPACE, "entityType") ===
          "documentation-root"
      ) {
        node.remove();
      }
    }
    if (page.children.length === 0 && page !== figma.currentPage) {
      page.remove();
      continue;
    }
    page.setSharedPluginData(PLUGIN_NAMESPACE, "libraryId", "");
    page.setSharedPluginData(PLUGIN_NAMESPACE, "entityType", "");
    page.setSharedPluginData(PLUGIN_NAMESPACE, "entityId", "");
    page.setSharedPluginData(PLUGIN_NAMESPACE, "release", "");
    if (!page.name.endsWith(" (retired)")) page.name += " (retired)";
  }
}

async function syncDocumentationPages(
  manifest: PerfectLibrariesManifest,
  runtimes: Map<string, ComponentRuntime>,
  variables: Map<string, Variable>,
  counters: SyncCounters,
): Promise<PageNode> {
  const fonts = await loadDocumentationFonts();
  const plan = createDocumentationPlan(manifest.components);
  const coverPage = ensureManagedPage(
    manifest,
    "cover",
    "00 · Cover",
    counters,
  );
  clearDocumentationRoot(coverPage, manifest, "cover");
  const coverRoot = buildCoverRoot(
    manifest,
    plan.groups,
    fonts,
    variables,
  );
  coverPage.appendChild(coverRoot);
  coverRoot.x = 80;
  coverRoot.y = 80;

  const orderedPages: PageNode[] = [coverPage];
  for (const [index, group] of plan.groups.entries()) {
    const page = ensureManagedPage(
      manifest,
      `group:${group.id}`,
      `${String(index + 1).padStart(2, "0")} · ${group.name}`,
      counters,
    );
    clearDocumentationRoot(page, manifest, group.id);
    const root = buildGroupDocumentationRoot(
      manifest,
      group,
      runtimes,
      fonts,
      variables,
      counters,
    );
    page.appendChild(root);
    root.x = 80;
    root.y = 80;
    orderedPages.push(page);
  }

  const assetsPage = ensureManagedPage(
    manifest,
    "assets",
    "99 · Library assets",
    counters,
  );
  layoutLibraryAssets(
    manifest,
    assetsPage,
    runtimes,
    fonts,
    variables,
  );
  const sourcesPage = findManagedPage(manifest.library.id, "sources");
  if (sourcesPage) orderedPages.push(sourcesPage);
  orderedPages.push(assetsPage);
  reconcileDocumentationPages(
    manifest,
    new Set([
      "cover",
      "assets",
      ...(sourcesPage ? ["sources"] : []),
      ...plan.groups.map((group) => `group:${group.id}`),
    ]),
  );
  orderedPages.forEach((page, index) => figma.root.insertChild(index, page));
  return coverPage;
}

function auditManagedComponents(nodes: ManagedSceneNode[]): string[] {
  const warnings: string[] = [];
  for (const node of nodes) {
    if (!["COMPONENT", "COMPONENT_SET"].includes(node.type)) continue;
    const descendants =
      "findAll" in node ? [node, ...node.findAll()] : [node];
    const withoutLayout = descendants.filter(
      (candidate) =>
        shouldWarnMissingAutoLayout({
          type: candidate.type,
          childCount: "children" in candidate ? candidate.children.length : 0,
          layoutMode:
            "layoutMode" in candidate ? candidate.layoutMode : undefined,
          sourceRole: candidate.getSharedPluginData(
            PLUGIN_NAMESPACE,
            "sourceRole",
          ),
        }),
    );
    if (withoutLayout.length > 0) {
      warnings.push(
        `${node.name} contains ${withoutLayout.length} multi-child frame${withoutLayout.length === 1 ? "" : "s"} without Auto Layout.`,
      );
    }
  }
  return [...new Set(warnings)];
}
