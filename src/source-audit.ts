export interface AutoLayoutAuditCandidate {
  type: string;
  childCount: number;
  layoutMode?: string;
  sourceRole?: string;
}

export function shouldWarnMissingAutoLayout(
  candidate: AutoLayoutAuditCandidate,
): boolean {
  return (
    ["FRAME", "COMPONENT", "INSTANCE"].includes(candidate.type) &&
    candidate.childCount > 1 &&
    candidate.layoutMode === "NONE" &&
    candidate.sourceRole !== "vector-artwork"
  );
}
