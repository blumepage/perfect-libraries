const SOURCE_NODE_TYPES = new Set(["FRAME", "COMPONENT", "INSTANCE"]);

export function reconcileManagedSourceContainer({
  candidates,
  currentPage,
}) {
  const onCurrentPage = candidates.find(
    (candidate) => candidate.parent === currentPage,
  );
  const container = onCurrentPage ?? candidates[0];
  const duplicates = candidates.filter((candidate) => candidate !== container);
  for (const duplicate of duplicates) duplicate.remove();

  const moved = Boolean(container && container.parent !== currentPage);
  if (moved) currentPage.appendChild(container);

  return {
    container,
    moved,
    duplicatesRemoved: duplicates.length,
  };
}

export function resolveSourceNodes({
  requests,
  candidates,
  libraryId,
  release,
  getMetadata,
}) {
  const requested = new Map(
    requests.map(({ sourceNode, variantId }) => [sourceNode, variantId]),
  );
  const matches = new Map([...requested.keys()].map((name) => [name, []]));

  for (const candidate of candidates) {
    if (
      requested.has(candidate.name) &&
      SOURCE_NODE_TYPES.has(candidate.type)
    ) {
      matches.get(candidate.name).push(candidate);
    }
  }

  const nodes = new Map();
  const errors = [];
  const warnings = [];

  for (const [name, expectedEntityId] of requested) {
    const named = matches.get(name) ?? [];
    const managedSources = named.filter((candidate) => {
      const metadata = getMetadata(candidate);
      return (
        metadata.libraryId === libraryId &&
        metadata.entityType === "source" &&
        metadata.entityId === expectedEntityId &&
        metadata.release === release
      );
    });
    const eligible = managedSources.length > 0 ? managedSources : named;

    if (eligible.length === 0) {
      errors.push(`Source node "${name}" was not found on the current page.`);
      continue;
    }
    if (eligible.length > 1) {
      errors.push(
        `Source node "${name}" is ambiguous; ${eligible.length} import frames have that exact name.`,
      );
      continue;
    }

    const node = eligible[0];
    const metadata = getMetadata(node);
    if (metadata.libraryId === libraryId && metadata.entityType !== "source") {
      errors.push(
        `Source node "${name}" is already managed output. Keep imported source frames separate from the generated library.`,
      );
      continue;
    }
    nodes.set(name, node);
  }

  return { nodes, errors, warnings };
}

export function reconcileAndResolveManagedSources({
  containers,
  currentPage,
  requests,
  libraryId,
  release,
  getMetadata,
  getCandidates,
}) {
  const reconciliation = reconcileManagedSourceContainer({
    candidates: containers,
    currentPage,
  });
  const candidates = reconciliation.container
    ? getCandidates(reconciliation.container)
    : [];
  const lookup = resolveSourceNodes({
    requests,
    candidates,
    libraryId,
    release,
    getMetadata,
  });

  return {
    ...reconciliation,
    ...lookup,
  };
}
