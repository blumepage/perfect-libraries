export const PERFECT_LIBRARIES_SOURCES_SCHEMA =
  "https://raw.githubusercontent.com/blumepage/perfect-libraries/main/schema/perfect-libraries-sources-v1.schema.json";

export interface SourceColor {
  r: number;
  g: number;
  b: number;
}

export interface SourcePaint {
  type: "SOLID";
  color: SourceColor;
  opacity?: number;
}

export interface SourceBaseNode {
  name: string;
  width: number;
  height: number;
  x?: number;
  y?: number;
  opacity?: number;
}

export interface SourceFrameNode extends SourceBaseNode {
  type: "FRAME";
  layoutMode: "HORIZONTAL" | "VERTICAL" | "NONE";
  primaryAxisSizingMode?: "FIXED" | "AUTO";
  counterAxisSizingMode?: "FIXED" | "AUTO";
  primaryAxisAlignItems?: "MIN" | "MAX" | "CENTER" | "SPACE_BETWEEN";
  counterAxisAlignItems?: "MIN" | "MAX" | "CENTER" | "BASELINE";
  layoutWrap?: "NO_WRAP" | "WRAP";
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  itemSpacing?: number;
  counterAxisSpacing?: number;
  cornerRadius?: number;
  fills?: SourcePaint[];
  strokes?: SourcePaint[];
  strokeWeight?: number;
  clipsContent?: boolean;
  children: SourceSceneNode[];
}

export interface SourceTextNode extends SourceBaseNode {
  type: "TEXT";
  characters: string;
  fontFamily: string;
  fontStyle: string;
  fontSize: number;
  fontWeight?: number;
  lineHeight?: number;
  letterSpacing?: number;
  textAlignHorizontal?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
  fills?: SourcePaint[];
}

export interface SourceRectangleNode extends SourceBaseNode {
  type: "RECTANGLE";
  cornerRadius?: number;
  fills?: SourcePaint[];
  strokes?: SourcePaint[];
  strokeWeight?: number;
}

export interface SourceVectorNode extends SourceBaseNode {
  type: "VECTOR";
  svg: string;
}

export type SourceSceneNode =
  | SourceFrameNode
  | SourceTextNode
  | SourceRectangleNode
  | SourceVectorNode;

export interface SourceVariant {
  id: string;
  sourceNode: string;
  scene: SourceFrameNode;
  warnings?: string[];
}

export interface PerfectLibrariesSources {
  $schema: typeof PERFECT_LIBRARIES_SOURCES_SCHEMA;
  version: 1;
  library: {
    id: string;
    release: string;
  };
  generatedAt: string;
  variants: SourceVariant[];
}

export interface SourcesValidationResult {
  ok: boolean;
  errors: string[];
  sources?: PerfectLibrariesSources;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validateSceneNode(
  value: unknown,
  path: string,
  errors: string[],
): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object.`);
    return;
  }
  if (!["FRAME", "TEXT", "RECTANGLE", "VECTOR"].includes(String(value.type))) {
    errors.push(`${path}.type is not supported.`);
  }
  if (typeof value.name !== "string" || !value.name.trim()) {
    errors.push(`${path}.name must be a non-empty string.`);
  }
  if (!finiteNumber(value.width) || value.width <= 0) {
    errors.push(`${path}.width must be a positive number.`);
  }
  if (!finiteNumber(value.height) || value.height <= 0) {
    errors.push(`${path}.height must be a positive number.`);
  }
  if (value.type === "FRAME") {
    if (!["HORIZONTAL", "VERTICAL", "NONE"].includes(String(value.layoutMode))) {
      errors.push(`${path}.layoutMode is invalid.`);
    }
    if (!Array.isArray(value.children)) {
      errors.push(`${path}.children must be an array.`);
    } else {
      value.children.forEach((child, index) =>
        validateSceneNode(child, `${path}.children[${index}]`, errors),
      );
    }
  }
  if (
    value.type === "TEXT" &&
    (typeof value.characters !== "string" ||
      typeof value.fontFamily !== "string" ||
      typeof value.fontStyle !== "string" ||
      !finiteNumber(value.fontSize))
  ) {
    errors.push(`${path} has invalid text properties.`);
  }
  if (value.type === "VECTOR" && typeof value.svg !== "string") {
    errors.push(`${path}.svg must be a string.`);
  }
}

export function validateSources(input: unknown): SourcesValidationResult {
  const errors: string[] = [];
  if (!isRecord(input)) {
    return { ok: false, errors: ["Sources must be a JSON object."] };
  }
  if (input.$schema !== PERFECT_LIBRARIES_SOURCES_SCHEMA) {
    errors.push(`$schema must equal "${PERFECT_LIBRARIES_SOURCES_SCHEMA}".`);
  }
  if (input.version !== 1) errors.push("version must equal 1.");
  if (!isRecord(input.library)) {
    errors.push("library must be an object.");
  } else {
    if (typeof input.library.id !== "string" || !input.library.id) {
      errors.push("library.id must be a non-empty string.");
    }
    if (typeof input.library.release !== "string" || !input.library.release) {
      errors.push("library.release must be a non-empty string.");
    }
  }
  if (!Array.isArray(input.variants)) {
    errors.push("variants must be an array.");
  } else {
    const ids = new Set<string>();
    for (let index = 0; index < input.variants.length; index += 1) {
      const variant = input.variants[index];
      const path = `variants[${index}]`;
      if (!isRecord(variant)) {
        errors.push(`${path} must be an object.`);
        continue;
      }
      if (typeof variant.id !== "string" || !variant.id) {
        errors.push(`${path}.id must be a non-empty string.`);
      } else if (ids.has(variant.id)) {
        errors.push(`${path}.id duplicates "${variant.id}".`);
      } else {
        ids.add(variant.id);
      }
      if (typeof variant.sourceNode !== "string" || !variant.sourceNode) {
        errors.push(`${path}.sourceNode must be a non-empty string.`);
      }
      validateSceneNode(variant.scene, `${path}.scene`, errors);
      if (
        isRecord(variant.scene) &&
        typeof variant.sourceNode === "string" &&
        variant.scene.name !== variant.sourceNode
      ) {
        errors.push(`${path}.scene.name must match sourceNode.`);
      }
    }
  }
  return errors.length
    ? { ok: false, errors }
    : { ok: true, errors, sources: input as unknown as PerfectLibrariesSources };
}
