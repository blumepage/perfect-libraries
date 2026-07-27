import type {
  ComponentDefinition,
  ComponentPropertyDefinition,
  StorybookControlDefinition,
} from "./manifest";

export interface DocumentationAxis {
  name: string;
  values: string[];
}

export interface DocumentationCombination {
  variantId: string;
  label: string;
  explanation: string;
  properties: Array<{ name: string; value: string }>;
}

export interface DocumentationComponent {
  id: string;
  name: string;
  group: string;
  description: string;
  documentationUrl?: string;
  properties: ComponentPropertyDefinition[];
  axes: DocumentationAxis[];
  combinations: DocumentationCombination[];
  controls: StorybookControlDefinition[];
  uses: string[];
  usedBy: string[];
  guidance: string[];
}

export interface DocumentationGroup {
  id: string;
  name: string;
  components: DocumentationComponent[];
}

export interface DocumentationPlan {
  groups: DocumentationGroup[];
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function stableHash(value: string): string {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

function fallbackGroupId(value: string): string {
  return `${slug(value) || "components"}-${stableHash(value)}`;
}

function groupOrder(left: string, right: string): number {
  if (left === "Foundations") return -1;
  if (right === "Foundations") return 1;
  return left.localeCompare(right);
}

function naturalList(values: string[]): string {
  if (values.length === 0) return "";
  if (values.length === 1) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function combinationExplanation(
  properties: Array<{ name: string; value: string }>,
): string {
  if (properties.length === 0) {
    return "The default configuration from Storybook.";
  }
  return `${properties
    .map(({ name, value }) => `${name} is set to ${value}`)
    .join(". ")}.`;
}

function componentGuidance(
  axes: DocumentationAxis[],
  properties: ComponentPropertyDefinition[],
  controls: StorybookControlDefinition[],
  hasStorybookLink: boolean,
): string[] {
  const guidance: string[] = [];
  if (axes.length > 0) {
    guidance.push(
      `Choose ${naturalList(axes.map((axis) => axis.name))} through the component variant controls. The supported values are documented below.`,
    );
  } else {
    guidance.push(
      "This component has one supported visual configuration in the current library release.",
    );
  }
  if (properties.length > 0) {
    guidance.push(
      `Customize ${naturalList(properties.map((property) => property.name))} through Figma component properties so the instance stays connected to the library.`,
    );
  } else {
    guidance.push(
      "Keep the component as a linked instance so future library updates continue to apply.",
    );
  }
  if (controls.length > 0 && hasStorybookLink) {
    guidance.push(
      `Use the linked Storybook story to exercise ${naturalList(controls.map((control) => control.label ?? control.name))} and review interactive behavior.`,
    );
  } else if (hasStorybookLink) {
    guidance.push(
      "Use the linked Storybook story as the implementation and behavior reference.",
    );
  }
  return guidance;
}

export function createDocumentationPlan(
  components: ComponentDefinition[],
): DocumentationPlan {
  const names = new Map(components.map((component) => [component.id, component.name]));
  const reverseDependencies = new Map<string, Set<string>>();
  for (const component of components) {
    const dependencies = new Set([
      ...(component.dependencies ?? []),
      ...component.variants.flatMap((variant) =>
        (variant.nestedInstances ?? []).map((nested) => nested.component),
      ),
    ]);
    for (const dependency of dependencies) {
      const dependents = reverseDependencies.get(dependency) ?? new Set<string>();
      dependents.add(component.id);
      reverseDependencies.set(dependency, dependents);
    }
  }

  const groups = new Map<
    string,
    { name: string; components: DocumentationComponent[] }
  >();
  for (const component of components) {
    const group = component.documentation?.group ?? "Components";
    const groupId =
      component.documentation?.groupId ?? fallbackGroupId(group);
    const axes = new Map<string, string[]>();
    const combinations = component.variants.map((variant) => {
      const properties = Object.entries(variant.properties).map(
        ([name, value]) => ({ name, value }),
      );
      for (const { name, value } of properties) {
        const values = axes.get(name) ?? [];
        if (!values.includes(value)) values.push(value);
        axes.set(name, values);
      }
      return {
        variantId: variant.id,
        label: properties.map(({ value }) => value).join(" · ") || "Default",
        explanation: combinationExplanation(properties),
        properties,
      };
    });
    const dependencies = new Set([
      ...(component.dependencies ?? []),
      ...component.variants.flatMap((variant) =>
        (variant.nestedInstances ?? []).map((nested) => nested.component),
      ),
    ]);
    const documentationAxes = [...axes.entries()].map(([name, values]) => ({
      name,
      values,
    }));
    const controls = component.documentation?.controls ?? [];
    const documentation: DocumentationComponent = {
      id: component.id,
      name: component.name,
      group,
      description: component.description ?? "",
      ...(component.documentationUrl
        ? { documentationUrl: component.documentationUrl }
        : {}),
      properties: component.properties ?? [],
      axes: documentationAxes,
      combinations,
      controls,
      uses: [...dependencies].map(
        (dependency) => names.get(dependency) ?? dependency,
      ),
      usedBy: [...(reverseDependencies.get(component.id) ?? [])].map(
        (dependent) => names.get(dependent) ?? dependent,
      ),
      guidance: componentGuidance(
        documentationAxes,
        component.properties ?? [],
        controls,
        Boolean(component.documentationUrl),
      ),
    };
    const grouped = groups.get(groupId);
    if (grouped && grouped.name !== group) {
      throw new Error(
        `Documentation group id "${groupId}" is used by both "${grouped.name}" and "${group}".`,
      );
    }
    const entry = grouped ?? { name: group, components: [] };
    entry.components.push(documentation);
    groups.set(groupId, entry);
  }

  return {
    groups: [...groups.entries()]
      .sort(([, left], [, right]) => groupOrder(left.name, right.name))
      .map(([id, group]) => ({
        id,
        name: group.name,
        components: group.components.sort((left, right) =>
          left.name.localeCompare(right.name),
        ),
      })),
  };
}
