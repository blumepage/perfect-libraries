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
}

export interface DocumentationComponent {
  id: string;
  name: string;
  description: string;
  documentationUrl?: string;
  properties: ComponentPropertyDefinition[];
  axes: DocumentationAxis[];
  combinations: DocumentationCombination[];
  controls: StorybookControlDefinition[];
  uses: string[];
  usedBy: string[];
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
      for (const [name, value] of Object.entries(variant.properties)) {
        const values = axes.get(name) ?? [];
        if (!values.includes(value)) values.push(value);
        axes.set(name, values);
      }
      return {
        variantId: variant.id,
        label: Object.entries(variant.properties)
          .map(([name, value]) => `${name}=${value}`)
          .join(" · "),
      };
    });
    const dependencies = new Set([
      ...(component.dependencies ?? []),
      ...component.variants.flatMap((variant) =>
        (variant.nestedInstances ?? []).map((nested) => nested.component),
      ),
    ]);
    const documentation: DocumentationComponent = {
      id: component.id,
      name: component.name,
      description: component.description ?? "",
      ...(component.documentationUrl
        ? { documentationUrl: component.documentationUrl }
        : {}),
      properties: component.properties ?? [],
      axes: [...axes.entries()].map(([name, values]) => ({ name, values })),
      combinations,
      controls: component.documentation?.controls ?? [],
      uses: [...dependencies].map(
        (dependency) => names.get(dependency) ?? dependency,
      ),
      usedBy: [...(reverseDependencies.get(component.id) ?? [])].map(
        (dependent) => names.get(dependent) ?? dependent,
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
