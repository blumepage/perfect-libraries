import type { SlotDefinition, VariableBindingDefinition } from "./manifest";

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

/** Slot replacement invalidates only the container itself, not its descendants. */
export function partitionSlotBindings(bindings: VariableBindingDefinition[], slots: SlotDefinition[] = []) {
  const layers = new Set(slots.map(slot => slot.layer));
  return {
    beforeComposition: bindings.filter(binding => !layers.has(binding.layer)),
    afterSlots: bindings.filter(binding => layers.has(binding.layer)),
  };
}
