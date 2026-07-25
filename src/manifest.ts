export const PERFECT_LIBRARIES_SCHEMA =
  "https://raw.githubusercontent.com/blumepage/perfect-libraries/main/schema/perfect-libraries-v1.schema.json";

export type TokenType = "COLOR" | "FLOAT" | "STRING" | "BOOLEAN";

export type TokenScope =
  | "ALL_FILLS"
  | "TEXT_FILL"
  | "FRAME_FILL"
  | "SHAPE_FILL"
  | "STROKE_COLOR"
  | "EFFECT_COLOR"
  | "WIDTH_HEIGHT"
  | "GAP"
  | "CORNER_RADIUS"
  | "TEXT_CONTENT"
  | "STROKE_FLOAT"
  | "EFFECT_FLOAT"
  | "OPACITY"
  | "FONT_FAMILY"
  | "FONT_STYLE"
  | "FONT_WEIGHT"
  | "FONT_SIZE"
  | "LINE_HEIGHT"
  | "LETTER_SPACING"
  | "PARAGRAPH_SPACING"
  | "PARAGRAPH_INDENT";

export type ColorValue =
  | string
  | { r: number; g: number; b: number; a?: number };

export type TokenValue =
  | ColorValue
  | number
  | string
  | boolean
  | { alias: string };

export interface TokenDefinition {
  id: string;
  name: string;
  type: TokenType;
  description?: string;
  scopes: TokenScope[];
  codeSyntax?: Partial<Record<"WEB" | "ANDROID" | "iOS", string>>;
  values: Record<string, TokenValue>;
}

export interface TokenCollectionDefinition {
  id: string;
  name: string;
  modes: string[];
  tokens: TokenDefinition[];
}

export type BindingProperty =
  | "fill"
  | "stroke"
  | "text-fill"
  | "padding-top"
  | "padding-right"
  | "padding-bottom"
  | "padding-left"
  | "gap"
  | "radius"
  | "radius-top-left"
  | "radius-top-right"
  | "radius-bottom-right"
  | "radius-bottom-left"
  | "stroke-weight"
  | "opacity"
  | "font-size"
  | "line-height"
  | "letter-spacing";

export interface VariableBindingDefinition {
  layer: string;
  property: BindingProperty;
  token: string;
  paintIndex?: number;
}

export interface NestedInstanceDefinition {
  layer: string;
  component: string;
  variant?: Record<string, string>;
  properties?: Record<string, string | boolean>;
}

export interface TextPropertyDefinition {
  type: "TEXT";
  name: string;
  layer: string;
  defaultValue: string;
}

export interface BooleanPropertyDefinition {
  type: "BOOLEAN";
  name: string;
  layer: string;
  defaultValue: boolean;
}

export interface InstanceSwapPropertyDefinition {
  type: "INSTANCE_SWAP";
  name: string;
  layer: string;
  defaultComponent: string;
}

export type ComponentPropertyDefinition =
  | TextPropertyDefinition
  | BooleanPropertyDefinition
  | InstanceSwapPropertyDefinition;

export interface ComponentVariantDefinition {
  id: string;
  sourceNode: string;
  properties: Record<string, string>;
  bindings?: VariableBindingDefinition[];
  nestedInstances?: NestedInstanceDefinition[];
}

export interface StorybookControlDefinition {
  name: string;
  label?: string;
  description?: string;
  type: string;
  options?: Array<string | number | boolean>;
  defaultValue?: string | number | boolean | null;
  category?: string;
}

export interface ComponentDocumentationDefinition {
  group: string;
  controls?: StorybookControlDefinition[];
}

export interface ComponentDefinition {
  id: string;
  name: string;
  description?: string;
  documentationUrl?: string;
  documentation?: ComponentDocumentationDefinition;
  dependencies?: string[];
  properties?: ComponentPropertyDefinition[];
  variants: ComponentVariantDefinition[];
}

export interface PerfectLibrariesManifest {
  $schema: typeof PERFECT_LIBRARIES_SCHEMA;
  version: 1;
  library: {
    id: string;
    name: string;
    release: string;
  };
  tokenCollections: TokenCollectionDefinition[];
  components: ComponentDefinition[];
}

export interface ManifestSummary {
  libraryName: string;
  release: string;
  collections: number;
  tokens: number;
  components: number;
  variants: number;
  sourceNodes: string[];
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  manifest?: PerfectLibrariesManifest;
  summary?: ManifestSummary;
}

const TOKEN_TYPES = new Set<TokenType>([
  "COLOR",
  "FLOAT",
  "STRING",
  "BOOLEAN",
]);

const TOKEN_SCOPES = new Set<TokenScope>([
  "ALL_FILLS",
  "TEXT_FILL",
  "FRAME_FILL",
  "SHAPE_FILL",
  "STROKE_COLOR",
  "EFFECT_COLOR",
  "WIDTH_HEIGHT",
  "GAP",
  "CORNER_RADIUS",
  "TEXT_CONTENT",
  "STROKE_FLOAT",
  "EFFECT_FLOAT",
  "OPACITY",
  "FONT_FAMILY",
  "FONT_STYLE",
  "FONT_WEIGHT",
  "FONT_SIZE",
  "LINE_HEIGHT",
  "LETTER_SPACING",
  "PARAGRAPH_SPACING",
  "PARAGRAPH_INDENT",
]);

const BINDING_PROPERTIES = new Set<BindingProperty>([
  "fill",
  "stroke",
  "text-fill",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "gap",
  "radius",
  "radius-top-left",
  "radius-top-right",
  "radius-bottom-right",
  "radius-bottom-left",
  "stroke-weight",
  "opacity",
  "font-size",
  "line-height",
  "letter-spacing",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function pathLabel(path: string, message: string): string {
  return `${path}: ${message}`;
}

export function formatVariantName(properties: Record<string, string>): string {
  return Object.entries(properties)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
}

export function validateManifest(input: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isRecord(input)) {
    return { ok: false, errors: ["Manifest must be a JSON object."], warnings };
  }

  if (input.$schema !== PERFECT_LIBRARIES_SCHEMA) {
    errors.push(
      pathLabel(
        "$schema",
        `must equal "${PERFECT_LIBRARIES_SCHEMA}"`,
      ),
    );
  }
  if (input.version !== 1) {
    errors.push(pathLabel("version", "must equal 1"));
  }

  const library = input.library;
  if (!isRecord(library)) {
    errors.push(pathLabel("library", "must be an object"));
  } else {
    for (const key of ["id", "name", "release"] as const) {
      if (!nonEmptyString(library[key])) {
        errors.push(pathLabel(`library.${key}`, "must be a non-empty string"));
      }
    }
  }

  if (!Array.isArray(input.tokenCollections)) {
    errors.push(pathLabel("tokenCollections", "must be an array"));
  }
  if (!Array.isArray(input.components)) {
    errors.push(pathLabel("components", "must be an array"));
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }

  const manifest = input as unknown as PerfectLibrariesManifest;
  const tokenIds = new Set<string>();
  const tokenTypes = new Map<string, TokenType>();
  const collectionIds = new Set<string>();
  const componentIds = new Set<string>();
  const variantIds = new Set<string>();
  const sourceNodes: string[] = [];

  manifest.tokenCollections.forEach((collection, collectionIndex) => {
    const path = `tokenCollections[${collectionIndex}]`;
    if (!nonEmptyString(collection.id)) {
      errors.push(pathLabel(`${path}.id`, "must be a non-empty string"));
    } else if (collectionIds.has(collection.id)) {
      errors.push(pathLabel(`${path}.id`, `duplicate id "${collection.id}"`));
    }
    collectionIds.add(collection.id);

    if (!nonEmptyString(collection.name)) {
      errors.push(pathLabel(`${path}.name`, "must be a non-empty string"));
    }
    if (!Array.isArray(collection.modes) || collection.modes.length === 0) {
      errors.push(pathLabel(`${path}.modes`, "must contain at least one mode"));
    } else if (new Set(collection.modes).size !== collection.modes.length) {
      errors.push(pathLabel(`${path}.modes`, "mode names must be unique"));
    }
    if (!Array.isArray(collection.tokens)) {
      errors.push(pathLabel(`${path}.tokens`, "must be an array"));
      return;
    }

    collection.tokens.forEach((token, tokenIndex) => {
      const tokenPath = `${path}.tokens[${tokenIndex}]`;
      if (!nonEmptyString(token.id)) {
        errors.push(pathLabel(`${tokenPath}.id`, "must be a non-empty string"));
      } else if (tokenIds.has(token.id)) {
        errors.push(pathLabel(`${tokenPath}.id`, `duplicate id "${token.id}"`));
      }
      tokenIds.add(token.id);
      if (!nonEmptyString(token.name)) {
        errors.push(pathLabel(`${tokenPath}.name`, "must be a non-empty string"));
      }
      if (!TOKEN_TYPES.has(token.type)) {
        errors.push(pathLabel(`${tokenPath}.type`, "is not supported"));
      } else {
        tokenTypes.set(token.id, token.type);
      }
      if (!Array.isArray(token.scopes)) {
        errors.push(pathLabel(`${tokenPath}.scopes`, "must be an array"));
      } else {
        for (const scope of token.scopes) {
          if (!TOKEN_SCOPES.has(scope)) {
            errors.push(
              pathLabel(`${tokenPath}.scopes`, `contains unsupported scope "${scope}"`),
            );
          }
        }
        if (token.type === "BOOLEAN" && token.scopes.length > 0) {
          errors.push(
            pathLabel(`${tokenPath}.scopes`, "BOOLEAN variables cannot have scopes"),
          );
        }
      }
      if (!isRecord(token.values)) {
        errors.push(pathLabel(`${tokenPath}.values`, "must be an object"));
      } else {
        for (const mode of collection.modes) {
          if (!(mode in token.values)) {
            errors.push(
              pathLabel(`${tokenPath}.values.${mode}`, "is required"),
            );
          }
        }
        for (const [mode, value] of Object.entries(token.values)) {
          if (!validTokenValue(token.type, value)) {
            errors.push(
              pathLabel(
                `${tokenPath}.values.${mode}`,
                `is not a valid ${token.type} value or alias`,
              ),
            );
          }
        }
      }
      if (token.codeSyntax?.WEB?.startsWith("--")) {
        warnings.push(
          pathLabel(
            `${tokenPath}.codeSyntax.WEB`,
            "should use the full var(--token-name) syntax",
          ),
        );
      }
    });
  });

  for (const collection of manifest.tokenCollections) {
    for (const token of collection.tokens) {
      for (const [mode, value] of Object.entries(token.values)) {
        if (
          isRecord(value) &&
          "alias" in value &&
          nonEmptyString(value.alias) &&
          !tokenIds.has(value.alias)
        ) {
          errors.push(
            pathLabel(
              `token "${token.id}" mode "${mode}"`,
              `references unknown alias "${value.alias}"`,
            ),
          );
        } else if (
          isRecord(value) &&
          "alias" in value &&
          nonEmptyString(value.alias) &&
          tokenTypes.get(value.alias) !== token.type
        ) {
          errors.push(
            pathLabel(
              `token "${token.id}" mode "${mode}"`,
              `cannot alias "${value.alias}" because their types differ`,
            ),
          );
        }
      }
    }
  }

  manifest.components.forEach((component, componentIndex) => {
    const path = `components[${componentIndex}]`;
    if (!nonEmptyString(component.id)) {
      errors.push(pathLabel(`${path}.id`, "must be a non-empty string"));
    } else if (componentIds.has(component.id)) {
      errors.push(pathLabel(`${path}.id`, `duplicate id "${component.id}"`));
    }
    componentIds.add(component.id);
    if (!nonEmptyString(component.name)) {
      errors.push(pathLabel(`${path}.name`, "must be a non-empty string"));
    }
    if (component.documentation) {
      if (!nonEmptyString(component.documentation.group)) {
        errors.push(
          pathLabel(
            `${path}.documentation.group`,
            "must be a non-empty string",
          ),
        );
      }
      for (const [controlIndex, control] of (
        component.documentation.controls ?? []
      ).entries()) {
        const controlPath = `${path}.documentation.controls[${controlIndex}]`;
        if (!nonEmptyString(control.name)) {
          errors.push(pathLabel(`${controlPath}.name`, "must be a non-empty string"));
        }
        if (!nonEmptyString(control.type)) {
          errors.push(pathLabel(`${controlPath}.type`, "must be a non-empty string"));
        }
      }
    }
    if (!Array.isArray(component.variants) || component.variants.length === 0) {
      errors.push(pathLabel(`${path}.variants`, "must contain at least one variant"));
      return;
    }
    const propertyNames = new Set<string>();
    for (const [propertyIndex, property] of (component.properties ?? []).entries()) {
      const propertyPath = `${path}.properties[${propertyIndex}]`;
      if (!["TEXT", "BOOLEAN", "INSTANCE_SWAP"].includes(property.type)) {
        errors.push(pathLabel(`${propertyPath}.type`, "is not supported"));
      }
      if (!nonEmptyString(property.name)) {
        errors.push(pathLabel(`${propertyPath}.name`, "must be a non-empty string"));
      } else if (propertyNames.has(property.name)) {
        errors.push(
          pathLabel(`${propertyPath}.name`, `duplicate name "${property.name}"`),
        );
      }
      propertyNames.add(property.name);
      if (!nonEmptyString(property.layer)) {
        errors.push(pathLabel(`${propertyPath}.layer`, "must be a non-empty string"));
      }
    }
    if (component.variants.length > 30) {
      warnings.push(
        pathLabel(
          `${path}.variants`,
          "contains more than 30 variants; consider splitting the component set",
        ),
      );
    }

    component.variants.forEach((variant, variantIndex) => {
      const variantPath = `${path}.variants[${variantIndex}]`;
      if (!nonEmptyString(variant.id)) {
        errors.push(pathLabel(`${variantPath}.id`, "must be a non-empty string"));
      } else if (variantIds.has(variant.id)) {
        errors.push(pathLabel(`${variantPath}.id`, `duplicate id "${variant.id}"`));
      }
      variantIds.add(variant.id);
      if (!nonEmptyString(variant.sourceNode)) {
        errors.push(pathLabel(`${variantPath}.sourceNode`, "must be a non-empty string"));
      } else {
        sourceNodes.push(variant.sourceNode);
      }
      if (!isRecord(variant.properties) || Object.keys(variant.properties).length === 0) {
        errors.push(pathLabel(`${variantPath}.properties`, "must not be empty"));
      }
      for (const [bindingIndex, binding] of (variant.bindings ?? []).entries()) {
        const bindingPath = `${variantPath}.bindings[${bindingIndex}]`;
        if (!nonEmptyString(binding.layer)) {
          errors.push(pathLabel(`${bindingPath}.layer`, "must be a non-empty string"));
        }
        if (!BINDING_PROPERTIES.has(binding.property)) {
          errors.push(
            pathLabel(`${bindingPath}.property`, `"${binding.property}" is not supported`),
          );
        }
        if (!tokenIds.has(binding.token)) {
          errors.push(
            pathLabel(
              `${variantPath}.bindings`,
              `references unknown token "${binding.token}"`,
            ),
          );
        }
      }
      for (const [nestedIndex, nested] of (
        variant.nestedInstances ?? []
      ).entries()) {
        const nestedPath = `${variantPath}.nestedInstances[${nestedIndex}]`;
        if (!nonEmptyString(nested.layer)) {
          errors.push(pathLabel(`${nestedPath}.layer`, "must be a non-empty string"));
        }
        if (!nonEmptyString(nested.component)) {
          errors.push(
            pathLabel(`${nestedPath}.component`, "must be a non-empty string"),
          );
        }
        if (nested.component === component.id) {
          errors.push(
            pathLabel(
              nestedPath,
              `component "${component.id}" cannot nest an instance of itself`,
            ),
          );
        }
      }
    });
  });

  for (const component of manifest.components) {
    for (const dependency of component.dependencies ?? []) {
      if (!componentIds.has(dependency)) {
        errors.push(
          pathLabel(
            `component "${component.id}"`,
            `references unknown dependency "${dependency}"`,
          ),
        );
      }
    }
    for (const variant of component.variants) {
      for (const nested of variant.nestedInstances ?? []) {
        if (!componentIds.has(nested.component)) {
          errors.push(
            pathLabel(
              `variant "${variant.id}"`,
              `references unknown nested component "${nested.component}"`,
            ),
          );
        }
      }
    }
    for (const property of component.properties ?? []) {
      if (
        property.type === "INSTANCE_SWAP" &&
        !componentIds.has(property.defaultComponent)
      ) {
        errors.push(
          pathLabel(
            `component "${component.id}" property "${property.name}"`,
            `references unknown component "${property.defaultComponent}"`,
          ),
        );
      }
    }
  }

  errors.push(...validateDependencyGraph(manifest.components));

  const summary: ManifestSummary = {
    libraryName: manifest.library.name,
    release: manifest.library.release,
    collections: manifest.tokenCollections.length,
    tokens: manifest.tokenCollections.reduce(
      (count, collection) => count + collection.tokens.length,
      0,
    ),
    components: manifest.components.length,
    variants: manifest.components.reduce(
      (count, component) => count + component.variants.length,
      0,
    ),
    sourceNodes,
  };

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    manifest: errors.length === 0 ? manifest : undefined,
    summary,
  };
}

function validTokenValue(type: TokenType, value: TokenValue): boolean {
  if (isRecord(value) && "alias" in value) {
    return nonEmptyString(value.alias);
  }
  if (type === "FLOAT") return typeof value === "number" && Number.isFinite(value);
  if (type === "STRING") return typeof value === "string";
  if (type === "BOOLEAN") return typeof value === "boolean";
  if (typeof value === "string") {
    return /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(value);
  }
  return (
    isRecord(value) &&
    typeof value.r === "number" &&
    typeof value.g === "number" &&
    typeof value.b === "number" &&
    [value.r, value.g, value.b, value.a ?? 1].every(
      (channel) => typeof channel === "number" && channel >= 0 && channel <= 1,
    )
  );
}

function validateDependencyGraph(components: ComponentDefinition[]): string[] {
  const byId = new Map(components.map((component) => [component.id, component]));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const errors: string[] = [];

  function visit(id: string, lineage: string[]): void {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      errors.push(
        `components: dependency cycle detected (${[...lineage, id].join(" → ")})`,
      );
      return;
    }
    const component = byId.get(id);
    if (!component) return;
    visiting.add(id);
    const dependencies = new Set(component.dependencies ?? []);
    for (const variant of component.variants ?? []) {
      for (const nested of variant.nestedInstances ?? []) {
        dependencies.add(nested.component);
      }
    }
    for (const dependency of dependencies) {
      if (dependency !== id) visit(dependency, [...lineage, id]);
    }
    visiting.delete(id);
    visited.add(id);
  }

  for (const component of components) visit(component.id, []);
  return errors;
}

export function parseManifestJson(json: string): ValidationResult {
  try {
    return validateManifest(JSON.parse(json));
  } catch (error) {
    return {
      ok: false,
      errors: [
        error instanceof Error ? `Invalid JSON: ${error.message}` : "Invalid JSON.",
      ],
      warnings: [],
    };
  }
}
