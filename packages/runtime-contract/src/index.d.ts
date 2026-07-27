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
