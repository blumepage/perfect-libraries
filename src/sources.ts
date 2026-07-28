export const PERFECT_LIBRARIES_SOURCES_SCHEMA =
  "https://raw.githubusercontent.com/blumepage/perfect-libraries/main/schema/perfect-libraries-sources-v1.schema.json";

export interface SourceColor {
  r: number;
  g: number;
  b: number;
  a?: number;
}

export interface SourceSolidPaint {
  type: "SOLID";
  color: SourceColor;
  opacity?: number;
}

export interface SourceGradientStop {
  position: number;
  color: SourceColor & { a: number };
}

export interface SourceGradientPaint {
  type: "GRADIENT_LINEAR";
  gradientTransform: [[number, number, number], [number, number, number]];
  gradientStops: SourceGradientStop[];
  opacity?: number;
}

export type SourcePaint = SourceSolidPaint | SourceGradientPaint;

export interface SourceEffect {
  type: "DROP_SHADOW" | "INNER_SHADOW";
  color: SourceColor & { a: number };
  offset: { x: number; y: number };
  radius: number;
  spread?: number;
}

export interface SourceBaseNode {
  name: string;
  width: number;
  height: number;
  x?: number;
  y?: number;
  layoutSizingHorizontal?: "FILL";
  layoutSizingVertical?: "FILL";
  layoutPositioning?: "ABSOLUTE";
  constraints?: {
    horizontal: "MIN" | "CENTER" | "MAX" | "STRETCH" | "SCALE";
    vertical: "MIN" | "CENTER" | "MAX" | "STRETCH" | "SCALE";
  };
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
  topLeftRadius?: number;
  topRightRadius?: number;
  bottomRightRadius?: number;
  bottomLeftRadius?: number;
  fills?: SourcePaint[];
  strokes?: SourcePaint[];
  strokeWeight?: number;
  strokeTopWeight?: number;
  strokeRightWeight?: number;
  strokeBottomWeight?: number;
  strokeLeftWeight?: number;
  strokeAlign?: "INSIDE" | "CENTER" | "OUTSIDE";
  effects?: SourceEffect[];
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
  topLeftRadius?: number;
  topRightRadius?: number;
  bottomRightRadius?: number;
  bottomLeftRadius?: number;
  fills?: SourcePaint[];
  strokes?: SourcePaint[];
  strokeWeight?: number;
  strokeTopWeight?: number;
  strokeRightWeight?: number;
  strokeBottomWeight?: number;
  strokeLeftWeight?: number;
  strokeAlign?: "INSIDE" | "CENTER" | "OUTSIDE";
  effects?: SourceEffect[];
}

export interface SourceImageNode extends SourceBaseNode {
  type: "IMAGE";
  data: string;
  mimeType: "image/png" | "image/jpeg" | "image/gif";
  scaleMode?: "FILL" | "FIT";
  cornerRadius?: number;
  topLeftRadius?: number;
  topRightRadius?: number;
  bottomRightRadius?: number;
  bottomLeftRadius?: number;
  strokes?: SourcePaint[];
  strokeWeight?: number;
  strokeTopWeight?: number;
  strokeRightWeight?: number;
  strokeBottomWeight?: number;
  strokeLeftWeight?: number;
  strokeAlign?: "INSIDE" | "CENTER" | "OUTSIDE";
  effects?: SourceEffect[];
}

export interface SourceVectorNode extends SourceBaseNode {
  type: "VECTOR";
  svg: string;
}

export type SourceSceneNode =
  | SourceFrameNode
  | SourceTextNode
  | SourceRectangleNode
  | SourceImageNode
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

function validateColor(
  value: unknown,
  path: string,
  errors: string[],
  requireAlpha = false,
): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be a color object.`);
    return;
  }
  for (const channel of requireAlpha ? ["r", "g", "b", "a"] : ["r", "g", "b"]) {
    if (
      !finiteNumber(value[channel]) ||
      value[channel] < 0 ||
      value[channel] > 1
    ) {
      errors.push(`${path}.${channel} must be between 0 and 1.`);
    }
  }
  if (
    !requireAlpha &&
    value.a !== undefined &&
    (!finiteNumber(value.a) || value.a < 0 || value.a > 1)
  ) {
    errors.push(`${path}.a must be between 0 and 1.`);
  }
}

function validatePaint(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be a paint object.`);
    return;
  }
  if (value.type === "SOLID") {
    validateColor(value.color, `${path}.color`, errors);
  } else if (value.type === "GRADIENT_LINEAR") {
    if (
      !Array.isArray(value.gradientTransform) ||
      value.gradientTransform.length !== 2 ||
      value.gradientTransform.some(
        (row) =>
          !Array.isArray(row) ||
          row.length !== 3 ||
          row.some((number) => !finiteNumber(number)),
      )
    ) {
      errors.push(`${path}.gradientTransform must be a 2x3 numeric matrix.`);
    }
    if (!Array.isArray(value.gradientStops) || value.gradientStops.length < 2) {
      errors.push(`${path}.gradientStops must contain at least two stops.`);
    } else {
      value.gradientStops.forEach((stop, index) => {
        const stopPath = `${path}.gradientStops[${index}]`;
        if (!isRecord(stop)) {
          errors.push(`${stopPath} must be an object.`);
          return;
        }
        if (
          !finiteNumber(stop.position) ||
          stop.position < 0 ||
          stop.position > 1
        ) {
          errors.push(`${stopPath}.position must be between 0 and 1.`);
        }
        validateColor(stop.color, `${stopPath}.color`, errors, true);
      });
    }
  } else {
    errors.push(`${path}.type is not supported.`);
  }
  if (
    value.opacity !== undefined &&
    (!finiteNumber(value.opacity) || value.opacity < 0 || value.opacity > 1)
  ) {
    errors.push(`${path}.opacity must be between 0 and 1.`);
  }
}

function validateEffect(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be an effect object.`);
    return;
  }
  if (!["DROP_SHADOW", "INNER_SHADOW"].includes(String(value.type))) {
    errors.push(`${path}.type is not supported.`);
  }
  validateColor(value.color, `${path}.color`, errors, true);
  if (
    !isRecord(value.offset) ||
    !finiteNumber(value.offset.x) ||
    !finiteNumber(value.offset.y)
  ) {
    errors.push(`${path}.offset must contain numeric x and y values.`);
  }
  if (!finiteNumber(value.radius) || value.radius < 0) {
    errors.push(`${path}.radius must be a non-negative number.`);
  }
  if (value.spread !== undefined && !finiteNumber(value.spread)) {
    errors.push(`${path}.spread must be a number.`);
  }
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
  if (
    !["FRAME", "TEXT", "RECTANGLE", "IMAGE", "VECTOR"].includes(
      String(value.type),
    )
  ) {
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
  if (
    value.layoutPositioning !== undefined &&
    value.layoutPositioning !== "ABSOLUTE"
  ) {
    errors.push(`${path}.layoutPositioning is invalid.`);
  }
  for (const field of [
    "layoutSizingHorizontal",
    "layoutSizingVertical",
  ] as const) {
    if (value[field] !== undefined && value[field] !== "FILL") {
      errors.push(`${path}.${field} is invalid.`);
    }
  }
  if (value.constraints !== undefined) {
    if (!isRecord(value.constraints)) {
      errors.push(`${path}.constraints must be an object.`);
    } else {
      const values = ["MIN", "CENTER", "MAX", "STRETCH", "SCALE"];
      if (!values.includes(String(value.constraints.horizontal))) {
        errors.push(`${path}.constraints.horizontal is invalid.`);
      }
      if (!values.includes(String(value.constraints.vertical))) {
        errors.push(`${path}.constraints.vertical is invalid.`);
      }
    }
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
  for (const field of ["fills", "strokes"]) {
    if (value[field] !== undefined) {
      if (!Array.isArray(value[field])) {
        errors.push(`${path}.${field} must be an array.`);
      } else {
        value[field].forEach((paint, index) =>
          validatePaint(paint, `${path}.${field}[${index}]`, errors),
        );
      }
    }
  }
  if (value.effects !== undefined) {
    if (!Array.isArray(value.effects)) {
      errors.push(`${path}.effects must be an array.`);
    } else {
      value.effects.forEach((effect, index) =>
        validateEffect(effect, `${path}.effects[${index}]`, errors),
      );
    }
  }
  for (const field of [
    "cornerRadius",
    "topLeftRadius",
    "topRightRadius",
    "bottomRightRadius",
    "bottomLeftRadius",
    "strokeWeight",
    "strokeTopWeight",
    "strokeRightWeight",
    "strokeBottomWeight",
    "strokeLeftWeight",
  ]) {
    if (
      value[field] !== undefined &&
      (!finiteNumber(value[field]) || value[field] < 0)
    ) {
      errors.push(`${path}.${field} must be a non-negative number.`);
    }
  }
  if (
    value.strokeAlign !== undefined &&
    !["INSIDE", "CENTER", "OUTSIDE"].includes(String(value.strokeAlign))
  ) {
    errors.push(`${path}.strokeAlign is invalid.`);
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
  if (value.type === "IMAGE") {
    if (typeof value.data !== "string" || !value.data) {
      errors.push(`${path}.data must be a non-empty base64 string.`);
    } else if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value.data)) {
      errors.push(`${path}.data must contain valid base64 characters.`);
    }
    if (!["image/png", "image/jpeg", "image/gif"].includes(String(value.mimeType))) {
      errors.push(`${path}.mimeType is not supported.`);
    }
    if (
      value.scaleMode !== undefined &&
      !["FILL", "FIT"].includes(String(value.scaleMode))
    ) {
      errors.push(`${path}.scaleMode is invalid.`);
    }
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
