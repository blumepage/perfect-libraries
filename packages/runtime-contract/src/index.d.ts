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
