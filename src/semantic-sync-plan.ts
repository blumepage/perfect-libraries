export type SemanticSyncPhase = "nested-instances" | "component-properties";

export interface SemanticSyncStep {
  componentId: string;
  phase: SemanticSyncPhase;
}

/**
 * Components are already dependency-sorted. Finishing both semantic phases for
 * each dependency before moving to its consumers ensures nested instances can
 * receive property overrides on their first import.
 */
export function createSemanticSyncPlan(
  componentIds: readonly string[],
): SemanticSyncStep[] {
  return componentIds.flatMap((componentId) => [
    { componentId, phase: "nested-instances" as const },
    { componentId, phase: "component-properties" as const },
  ]);
}
