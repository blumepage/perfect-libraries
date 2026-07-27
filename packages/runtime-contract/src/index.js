const SOURCE_NODE_TYPES = new Set(["FRAME", "COMPONENT", "INSTANCE"]);
const NUMERIC_BINDING_FIELDS = {
  "padding-top": ["paddingTop"],
  "padding-right": ["paddingRight"],
  "padding-bottom": ["paddingBottom"],
  "padding-left": ["paddingLeft"],
  gap: ["itemSpacing"],
  radius: [
    "topLeftRadius",
    "topRightRadius",
    "bottomRightRadius",
    "bottomLeftRadius",
  ],
  "radius-top-left": ["topLeftRadius"],
  "radius-top-right": ["topRightRadius"],
  "radius-bottom-right": ["bottomRightRadius"],
  "radius-bottom-left": ["bottomLeftRadius"],
  "stroke-weight": ["strokeWeight"],
  opacity: ["opacity"],
  "font-size": ["fontSize"],
  "line-height": ["lineHeight"],
  "letter-spacing": ["letterSpacing"],
};

export function applyNumericVariableBinding({
  nodeName,
  nodeType,
  property,
  bind,
}) {
  const fields = NUMERIC_BINDING_FIELDS[property];
  if (!fields || typeof bind !== "function") {
    throw new Error(
      `Property "${property}" cannot be bound on layer "${nodeName}" (${nodeType}).`,
    );
  }
  for (const field of fields) bind(field);
  return fields;
}

export function applySourceChildPlacement({
  parentLayoutMode,
  source,
  child,
}) {
  const absolute =
    parentLayoutMode !== "NONE" && source.layoutPositioning === "ABSOLUTE";
  if (absolute) child.layoutPositioning = "ABSOLUTE";
  if (source.constraints) {
    child.constraints = {
      horizontal: source.constraints.horizontal,
      vertical: source.constraints.vertical,
    };
  }
  if (parentLayoutMode === "NONE" || absolute) {
    child.x = source.x ?? 0;
    child.y = source.y ?? 0;
  }
}

export function layoutManualVariantGrid({
  componentSet,
  items,
  columns,
  gap,
  padding,
}) {
  componentSet.layoutMode = "NONE";
  const rowCount = Math.ceil(items.length / columns);
  const columnWidths = Array.from({ length: columns }, () => 0);
  const rowHeights = Array.from({ length: rowCount }, () => 0);

  items.forEach(({ width, height }, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    columnWidths[column] = Math.max(columnWidths[column], width);
    rowHeights[row] = Math.max(rowHeights[row], height);
  });

  items.forEach(({ node, width, height }, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    node.resizeWithoutConstraints(width, height);
    node.x =
      padding +
      columnWidths.slice(0, column).reduce((sum, value) => sum + value, 0) +
      column * gap;
    node.y =
      padding +
      rowHeights.slice(0, row).reduce((sum, value) => sum + value, 0) +
      row * gap;
  });

  componentSet.resizeWithoutConstraints(
    padding * 2 +
      columnWidths.reduce((sum, value) => sum + value, 0) +
      Math.max(0, columns - 1) * gap,
    padding * 2 +
      rowHeights.reduce((sum, value) => sum + value, 0) +
      Math.max(0, rowCount - 1) * gap,
  );
}

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
