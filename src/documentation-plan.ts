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

  const groups = new Map<string, DocumentationComponent[]>();
  for (const component of components) {
    const group = component.documentation?.group ?? "Components";
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
    const grouped = groups.get(group) ?? [];
    grouped.push(documentation);
    groups.set(group, grouped);
  }

  return {
    groups: [...groups.entries()]
      .sort(([left], [right]) => groupOrder(left, right))
      .map(([name, grouped]) => ({
        id: slug(name) || "components",
        name,
        components: grouped.sort((left, right) => left.name.localeCompare(right.name)),
      })),
  };
}
