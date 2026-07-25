import type {
  BindingProperty,
  ComponentDefinition,
  ComponentPropertyDefinition,
  NestedInstanceDefinition,
  PerfectLibrariesManifest,
  TokenType,
  VariableBindingDefinition,
} from "./manifest";
import type {
  PerfectLibrariesSources,
  SourceSceneNode,
  SourceVariant,
} from "./sources";

export interface SourceContractValidationResult {
  ok: boolean;
  errors: string[];
}

interface VariantContext {
  component: ComponentDefinition;
  variantId: string;
  source: SourceVariant;
}

function findSourceLayer(
  root: SourceSceneNode,
  path: string,
): SourceSceneNode | undefined {
  if (path === "$") return root;
  const segments = path.split("/").filter(Boolean);
  let current = root;
  for (const segment of segments) {
    if (current.type !== "FRAME") return undefined;
    const matches = current.children.filter((child) => child.name === segment);
    if (matches.length !== 1) return undefined;
    current = matches[0];
  }
  return current;
}

function tokenTypes(manifest: PerfectLibrariesManifest): Map<string, TokenType> {
  return new Map(
    manifest.tokenCollections.flatMap((collection) =>
      collection.tokens.map((token) => [token.id, token.type] as const),
    ),
  );
}

function expectedTokenType(property: BindingProperty): TokenType {
  if (["fill", "stroke", "text-fill"].includes(property)) return "COLOR";
  return "FLOAT";
}

function supportsNumericBinding(
  node: SourceSceneNode,
  property: BindingProperty,
): boolean {
  if (property === "opacity") return true;
  if (["font-size", "line-height", "letter-spacing"].includes(property)) {
    return node.type === "TEXT";
  }
  if (
    [
      "padding-top",
      "padding-right",
      "padding-bottom",
      "padding-left",
      "gap",
    ].includes(property)
  ) {
    return node.type === "FRAME" && node.layoutMode !== "NONE";
  }
  return (
    [
      "radius",
      "radius-top-left",
      "radius-top-right",
      "radius-bottom-right",
      "radius-bottom-left",
      "stroke-weight",
    ].includes(property) &&
    (node.type === "FRAME" || node.type === "RECTANGLE")
  );
}

function validatePaintBinding(
  node: SourceSceneNode,
  binding: VariableBindingDefinition,
): string | undefined {
  const field = binding.property === "stroke" ? "strokes" : "fills";
  if (
    binding.property === "text-fill" &&
    node.type !== "TEXT"
  ) {
    return `requires a TEXT layer, but "${binding.layer}" is ${node.type}`;
  }
  if (
    binding.property === "fill" &&
    !["FRAME", "RECTANGLE", "TEXT"].includes(node.type)
  ) {
    return `cannot bind fills on ${node.type} layer "${binding.layer}"`;
  }
  if (
    binding.property === "stroke" &&
    !["FRAME", "RECTANGLE"].includes(node.type)
  ) {
    return `cannot bind strokes on ${node.type} layer "${binding.layer}"`;
  }
  const paints =
    field === "fills" && "fills" in node
      ? node.fills
      : field === "strokes" && "strokes" in node
        ? node.strokes
        : undefined;
  const index = binding.paintIndex ?? 0;
  if (!paints?.[index]) {
    return `layer "${binding.layer}" has no ${field} paint at index ${index}`;
  }
  if (paints[index].type !== "SOLID") {
    return `layer "${binding.layer}" ${field} paint ${index} is not SOLID`;
  }
  return undefined;
}

function validateBinding(
  context: VariantContext,
  binding: VariableBindingDefinition,
  tokens: Map<string, TokenType>,
  errors: string[],
): void {
  const prefix = `${context.component.name} / ${context.variantId}: binding "${binding.property}"`;
  const node = findSourceLayer(context.source.scene, binding.layer);
  if (!node) {
    errors.push(`${prefix} layer "${binding.layer}" was not found.`);
    return;
  }
  const expected = expectedTokenType(binding.property);
  const actual = tokens.get(binding.token);
  if (actual !== expected) {
    errors.push(
      `${prefix} requires a ${expected} token, but "${binding.token}" is ${actual ?? "missing"}.`,
    );
  }
  if (["fill", "stroke", "text-fill"].includes(binding.property)) {
    const paintError = validatePaintBinding(node, binding);
    if (paintError) errors.push(`${prefix} ${paintError}.`);
  } else if (!supportsNumericBinding(node, binding.property)) {
    errors.push(
      `${prefix} cannot be applied to "${binding.layer}" (${node.type}${
        node.type === "FRAME" ? `, layout ${node.layoutMode}` : ""
      }).`,
    );
  }
}

function validateProperty(
  context: VariantContext,
  property: ComponentPropertyDefinition,
  errors: string[],
): void {
  const prefix = `${context.component.name} / ${context.variantId}: property "${property.name}"`;
  const node = findSourceLayer(context.source.scene, property.layer);
  if (!node) {
    errors.push(`${prefix} layer "${property.layer}" was not found.`);
    return;
  }
  if (property.type === "TEXT" && node.type !== "TEXT") {
    errors.push(
      `${prefix} requires a TEXT layer, but "${property.layer}" is ${node.type}.`,
    );
  }
  if (
    property.type === "INSTANCE_SWAP" &&
    !(context.component.variants
      .find((variant) => variant.id === context.variantId)
      ?.nestedInstances ?? [])
      .some((nested) => nested.layer === property.layer)
  ) {
    errors.push(
      `${prefix} requires a nested instance declaration at layer "${property.layer}".`,
    );
  }
}

function nestedTarget(
  manifest: PerfectLibrariesManifest,
  nested: NestedInstanceDefinition,
): ComponentDefinition | undefined {
  return manifest.components.find(
    (component) => component.id === nested.component,
  );
}

function validateNestedInstance(
  manifest: PerfectLibrariesManifest,
  context: VariantContext,
  nested: NestedInstanceDefinition,
  errors: string[],
): void {
  const prefix = `${context.component.name} / ${context.variantId}: nested instance "${nested.component}"`;
  if (!findSourceLayer(context.source.scene, nested.layer)) {
    errors.push(`${prefix} layer "${nested.layer}" was not found.`);
  }
  const target = nestedTarget(manifest, nested);
  if (!target) return;
  const requested = nested.variant ?? {};
  if (
    Object.keys(requested).length > 0 &&
    !target.variants.some((variant) =>
      Object.entries(requested).every(
        ([key, value]) => variant.properties[key] === value,
      ),
    )
  ) {
    errors.push(
      `${prefix} has no variant matching ${JSON.stringify(requested)}.`,
    );
  }
  const targetProperties = new Map(
    (target.properties ?? []).map((property) => [property.name, property]),
  );
  for (const [name, value] of Object.entries(nested.properties ?? {})) {
    const property = targetProperties.get(name);
    if (!property) {
      errors.push(`${prefix} references unknown property "${name}".`);
      continue;
    }
    const expected =
      property.type === "BOOLEAN" ? "boolean" : "string";
    if (typeof value !== expected) {
      errors.push(
        `${prefix} property "${name}" requires a ${expected} value.`,
      );
    }
  }
}

export function validateSourceContract(
  manifest: PerfectLibrariesManifest,
  sources: PerfectLibrariesSources,
): SourceContractValidationResult {
  const errors: string[] = [];
  if (
    sources.library.id !== manifest.library.id ||
    sources.library.release !== manifest.library.release
  ) {
    errors.push(
      `Storybook sources ${sources.library.id}@${sources.library.release} do not match ${manifest.library.id}@${manifest.library.release}.`,
    );
  }

  const expectedVariants = new Map(
    manifest.components.flatMap((component) =>
      component.variants.map((variant) => [
        variant.id,
        { component, variant },
      ] as const),
    ),
  );
  const providedVariants = new Map(
    sources.variants.map((variant) => [variant.id, variant]),
  );

  for (const [id, { variant }] of expectedVariants) {
    const source = providedVariants.get(id);
    if (!source) {
      errors.push(
        `Storybook source bundle is missing "${id}" (${variant.sourceNode}).`,
      );
    } else if (source.sourceNode !== variant.sourceNode) {
      errors.push(
        `Storybook source "${id}" is named "${source.sourceNode}", expected "${variant.sourceNode}".`,
      );
    }
  }
  for (const source of sources.variants) {
    if (!expectedVariants.has(source.id)) {
      errors.push(
        `Storybook source bundle contains unexpected variant "${source.id}" (${source.sourceNode}).`,
      );
    }
  }

  const tokens = tokenTypes(manifest);
  for (const [id, { component, variant }] of expectedVariants) {
    const source = providedVariants.get(id);
    if (!source || source.sourceNode !== variant.sourceNode) continue;
    const context = { component, variantId: id, source };
    for (const property of component.properties ?? []) {
      validateProperty(context, property, errors);
    }
    for (const binding of variant.bindings ?? []) {
      validateBinding(context, binding, tokens, errors);
    }
    for (const nested of variant.nestedInstances ?? []) {
      validateNestedInstance(manifest, context, nested, errors);
    }
  }

  return { ok: errors.length === 0, errors };
}
