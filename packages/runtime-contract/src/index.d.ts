export interface ManagedSourceContainerLike {
  parent: unknown;
  remove(): void;
}

export interface SourcePageLike<TContainer> {
  appendChild(container: TContainer): void;
}

export interface SourceContainerReconciliation<TContainer> {
  container: TContainer | undefined;
  moved: boolean;
  duplicatesRemoved: number;
}

export function reconcileManagedSourceContainer<
  TContainer extends ManagedSourceContainerLike,
  TPage extends SourcePageLike<TContainer>,
>(input: {
  candidates: readonly TContainer[];
  currentPage: TPage;
}): SourceContainerReconciliation<TContainer>;

export interface SourceRequest {
  sourceNode: string;
  variantId: string;
}

export interface SourceCandidateMetadata {
  libraryId?: string;
  entityType?: string;
  entityId?: string;
  release?: string;
}

export interface SourceNodeLike {
  name: string;
  type: string;
}

export type NumericBindingProperty =
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

export type NumericBindingField =
  | "paddingTop"
  | "paddingRight"
  | "paddingBottom"
  | "paddingLeft"
  | "itemSpacing"
  | "topLeftRadius"
  | "topRightRadius"
  | "bottomRightRadius"
  | "bottomLeftRadius"
  | "strokeWeight"
  | "opacity"
  | "fontSize"
  | "lineHeight"
  | "letterSpacing";

export function applyNumericVariableBinding(input: {
  nodeName: string;
  nodeType: string;
  property: NumericBindingProperty;
  bind?: (field: NumericBindingField) => void;
}): readonly NumericBindingField[];

export interface SourceConstraintsLike {
  horizontal: "MIN" | "CENTER" | "MAX" | "STRETCH" | "SCALE";
  vertical: "MIN" | "CENTER" | "MAX" | "STRETCH" | "SCALE";
}

export interface SourcePlacementLike {
  x?: number;
  y?: number;
  layoutPositioning?: "ABSOLUTE";
  constraints?: SourceConstraintsLike;
}

export interface PositionedSceneNodeLike {
  x: number;
  y: number;
  layoutPositioning?: "AUTO" | "ABSOLUTE";
  constraints?: SourceConstraintsLike;
}

export function applySourceChildPlacement(input: {
  parentLayoutMode: "HORIZONTAL" | "VERTICAL" | "NONE";
  source: SourcePlacementLike;
  child: PositionedSceneNodeLike;
}): void;

export interface ResizablePositionedNodeLike {
  width: number;
  height: number;
  x: number;
  y: number;
  resizeWithoutConstraints(width: number, height: number): void;
}

export interface ManualComponentSetLike {
  layoutMode: string;
  resizeWithoutConstraints(width: number, height: number): void;
}

export function layoutManualVariantGrid<
  TNode extends ResizablePositionedNodeLike,
>(input: {
  componentSet: ManualComponentSetLike;
  items: readonly {
    node: TNode;
    width: number;
    height: number;
  }[];
  columns: number;
  gap: number;
  padding: number;
}): void;

export function resolveSourceNodes<TNode extends SourceNodeLike>(input: {
  requests: readonly SourceRequest[];
  candidates: readonly TNode[];
  libraryId: string;
  release: string;
  getMetadata(node: TNode): SourceCandidateMetadata;
}): {
  nodes: Map<string, TNode>;
  errors: string[];
  warnings: string[];
};

export function reconcileAndResolveManagedSources<
  TContainer extends ManagedSourceContainerLike,
  TPage extends SourcePageLike<TContainer>,
  TNode extends SourceNodeLike,
>(input: {
  containers: readonly TContainer[];
  currentPage: TPage;
  requests: readonly SourceRequest[];
  libraryId: string;
  release: string;
  getMetadata(node: TNode): SourceCandidateMetadata;
  getCandidates(container: TContainer): readonly TNode[];
}): SourceContainerReconciliation<TContainer> & {
  nodes: Map<string, TNode>;
  errors: string[];
  warnings: string[];
};
