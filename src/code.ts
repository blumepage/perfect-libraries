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

declare const __html__: string;

const PLUGIN_NAMESPACE = "perfectLibraries";
const UI_WIDTH = 420;
const UI_HEIGHT = 680;

type ManagedSceneNode = SceneNode & PluginDataMixin;
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
}

interface Report {
  ok: boolean;
  title: string;
  errors: string[];
  warnings: string[];
  details: string[];
  counters?: SyncCounters;
}

interface SourceLookup {
  nodes: Map<string, SceneNode>;
  warnings: string[];
  errors: string[];
}

interface ComponentRuntime {
  definition: ComponentDefinition;
  variants: Map<string, ComponentNode>;
  owner: ComponentOwner;
}

type UiMessage =
  | { type: "inspect"; manifest: unknown }
  | { type: "apply"; manifest: unknown }
  | { type: "resize"; height: number }
  | { type: "close" };

figma.showUI(__html__, {
  width: UI_WIDTH,
  height: UI_HEIGHT,
  themeColors: true,
});

figma.ui.onmessage = async (message: UiMessage) => {
  if (message.type === "close") {
    figma.closePlugin();
    return;
  }

  if (message.type === "resize") {
    figma.ui.resize(UI_WIDTH, Math.max(420, Math.min(820, message.height)));
    return;
  }

  if (message.type === "inspect") {
    figma.ui.postMessage(await inspect(message.manifest));
    return;
  }

  if (message.type === "apply") {
    figma.ui.postMessage({ type: "busy", busy: true });
    const report = await apply(message.manifest);
    figma.ui.postMessage(report);
    figma.ui.postMessage({ type: "busy", busy: false });
  }
};

async function inspect(input: unknown): Promise<Report & { type: "report" }> {
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

  const sourceLookup = findSourceNodes(validation.manifest);
  const managed = findManagedSceneNodes(validation.manifest.library.id);
  const autoLayoutWarnings = auditSourceAutoLayout(sourceLookup.nodes);

  return {
    type: "report",
    ok: sourceLookup.errors.length === 0,
    title:
      sourceLookup.errors.length === 0
        ? "Ready to forge"
        : "Source frames need attention",
    errors: sourceLookup.errors,
    warnings: [
      ...validation.warnings,
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

async function apply(input: unknown): Promise<Report & { type: "report" }> {
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
  const sourceLookup = findSourceNodes(manifest);
  if (sourceLookup.errors.length > 0) {
    return {
      type: "report",
      ok: false,
      title: "Nothing changed",
      errors: sourceLookup.errors,
      warnings: [...validation.warnings, ...sourceLookup.warnings],
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
  };
  const warnings = [...validation.warnings, ...sourceLookup.warnings];

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

    for (const component of orderedComponents) {
      const runtime = componentRuntime.get(component.id);
      if (!runtime) continue;
      syncNestedInstances(runtime, componentRuntime, counters, warnings);
    }

    for (const component of orderedComponents) {
      const runtime = componentRuntime.get(component.id);
      if (!runtime) continue;
      syncComponentProperties(runtime, componentRuntime, counters, warnings);
    }

    const managedNodes = findManagedSceneNodes(manifest.library.id);
    const auditWarnings = auditManagedComponents(managedNodes);
    warnings.push(...auditWarnings);

    figma.currentPage.selection = [...componentRuntime.values()].map(
      (runtime) => runtime.owner,
    );
    figma.viewport.scrollAndZoomIntoView(figma.currentPage.selection);

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
        "Review the selected components, then publish the library manually.",
      ],
      counters,
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

function findSourceNodes(manifest: PerfectLibrariesManifest): SourceLookup {
  const requestedNames = new Set(
    manifest.components.flatMap((component) =>
      component.variants.map((variant) => variant.sourceNode),
    ),
  );
  const matches = new Map<string, SceneNode[]>();
  for (const name of requestedNames) matches.set(name, []);

  for (const node of figma.currentPage.findAll()) {
    if (requestedNames.has(node.name)) {
      matches.get(node.name)?.push(node);
    }
  }

  const nodes = new Map<string, SceneNode>();
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const name of requestedNames) {
    const named = matches.get(name) ?? [];
    if (named.length === 0) {
      errors.push(`Source node "${name}" was not found on the current page.`);
      continue;
    }
    if (named.length > 1) {
      errors.push(
        `Source node "${name}" is ambiguous; ${named.length} layers have that exact name.`,
      );
      continue;
    }
    const node = named[0];
    if (!["FRAME", "COMPONENT", "INSTANCE"].includes(node.type)) {
      errors.push(
        `Source node "${name}" is ${node.type}; use a Frame, Component, or Instance.`,
      );
      continue;
    }
    if (isManaged(node, manifest.library.id)) {
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
        ["FRAME", "COMPONENT", "INSTANCE"].includes(candidate.type) &&
        "children" in candidate &&
        candidate.children.length > 1 &&
        "layoutMode" in candidate &&
        candidate.layoutMode === "NONE",
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
  return figma.currentPage
    .findAllWithCriteria({
      sharedPluginData: {
        namespace: PLUGIN_NAMESPACE,
        keys: ["libraryId", "entityId", "entityType"],
      },
    })
    .filter(
      (node): node is ManagedSceneNode =>
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

function isManaged(node: SceneNode, libraryId: string): boolean {
  return (
    "getSharedPluginData" in node &&
    node.getSharedPluginData(PLUGIN_NAMESPACE, "libraryId") === libraryId
  );
}

function tagManaged(
  entity: ManagedSceneNode | ManagedVariable | ManagedCollection,
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

  if ("layoutMode" in parent && parent.layoutMode !== "NONE") {
    try {
      instance.layoutSizingHorizontal = horizontal;
      instance.layoutSizingVertical = vertical;
    } catch {
      instance.resizeWithoutConstraints(width, height);
    }
  } else {
    instance.x = x;
    instance.y = y;
    instance.resizeWithoutConstraints(width, height);
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

function auditManagedComponents(nodes: ManagedSceneNode[]): string[] {
  const warnings: string[] = [];
  for (const node of nodes) {
    if (!["COMPONENT", "COMPONENT_SET"].includes(node.type)) continue;
    const descendants =
      "findAll" in node ? [node, ...node.findAll()] : [node];
    const withoutLayout = descendants.filter(
      (candidate) =>
        ["FRAME", "COMPONENT", "INSTANCE"].includes(candidate.type) &&
        "children" in candidate &&
        candidate.children.length > 1 &&
        "layoutMode" in candidate &&
        candidate.layoutMode === "NONE",
    );
    if (withoutLayout.length > 0) {
      warnings.push(
        `${node.name} contains ${withoutLayout.length} multi-child frame${withoutLayout.length === 1 ? "" : "s"} without Auto Layout.`,
      );
    }
  }
  return [...new Set(warnings)];
}
