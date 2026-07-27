import assert from "node:assert/strict";
import test from "node:test";

import {
  applySourceChildPlacement,
  applyNumericVariableBinding,
  layoutManualVariantGrid,
  reconcileAndResolveManagedSources,
  reconcileManagedSourceContainer,
  resolveSourceNodes,
} from "../src/index.js";

function createPage(name) {
  return {
    name,
    children: [],
    appendChild(node) {
      if (node.parent?.children) {
        node.parent.children = node.parent.children.filter(
          (candidate) => candidate !== node,
        );
      }
      node.parent = this;
      this.children.push(node);
    },
  };
}

function createContainer(parent, name = "sources") {
  const container = {
    name,
    parent,
    removed: false,
    remove() {
      this.removed = true;
      if (this.parent?.children) {
        this.parent.children = this.parent.children.filter(
          (candidate) => candidate !== this,
        );
      }
      this.parent = null;
    },
  };
  parent.children.push(container);
  return container;
}

test("moves a legacy managed source container onto the current source page", () => {
  const legacyPage = createPage("Legacy");
  const sourcePage = createPage("98 · Import sources");
  const container = createContainer(legacyPage);

  const result = reconcileManagedSourceContainer({
    candidates: [container],
    currentPage: sourcePage,
  });

  assert.equal(result.container, container);
  assert.equal(result.moved, true);
  assert.equal(result.duplicatesRemoved, 0);
  assert.equal(container.parent, sourcePage);
  assert.deepEqual(legacyPage.children, []);
  assert.deepEqual(sourcePage.children, [container]);
});

test("prefers the current-page source container and removes duplicates", () => {
  const legacyPage = createPage("Legacy");
  const sourcePage = createPage("98 · Import sources");
  const legacy = createContainer(legacyPage, "legacy");
  const current = createContainer(sourcePage, "current");

  const result = reconcileManagedSourceContainer({
    candidates: [legacy, current],
    currentPage: sourcePage,
  });

  assert.equal(result.container, current);
  assert.equal(result.moved, false);
  assert.equal(result.duplicatesRemoved, 1);
  assert.equal(legacy.removed, true);
  assert.deepEqual(sourcePage.children, [current]);
});

test("resolves exact managed sources without current-page errors", () => {
  const candidates = [
    {
      name: "Button / Primary",
      type: "FRAME",
      metadata: {
        libraryId: "example",
        entityType: "source",
        entityId: "button-primary",
        release: "1.0.0",
      },
    },
  ];
  const result = resolveSourceNodes({
    requests: [
      { sourceNode: "Button / Primary", variantId: "button-primary" },
    ],
    candidates,
    libraryId: "example",
    release: "1.0.0",
    getMetadata: (node) => node.metadata,
  });

  assert.equal(result.nodes.size, 1);
  assert.deepEqual(result.errors, []);
});

test("the importer operation moves a stale container before resolving its sources", () => {
  const legacyPage = createPage("Components");
  const sourcePage = createPage("98 · Import sources");
  const source = {
    name: "Button / Primary",
    type: "FRAME",
    metadata: {
      libraryId: "example",
      entityType: "source",
      entityId: "button-primary",
      release: "1.0.0",
    },
  };
  const container = createContainer(legacyPage);
  container.children = [source];
  source.parent = container;

  const result = reconcileAndResolveManagedSources({
    containers: [container],
    currentPage: sourcePage,
    requests: [
      { sourceNode: "Button / Primary", variantId: "button-primary" },
    ],
    libraryId: "example",
    release: "1.0.0",
    getMetadata: (node) => node.metadata,
    getCandidates: (managedContainer) => managedContainer.children,
  });

  assert.equal(result.container, container);
  assert.equal(result.moved, true);
  assert.equal(result.nodes.size, 1);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(legacyPage.children, []);
  assert.deepEqual(sourcePage.children, [container]);
});

test("a radius variable binds every independent component corner", () => {
  const bound = [];
  const fields = applyNumericVariableBinding({
    nodeName: "Style=Accent, Size=Large",
    nodeType: "COMPONENT",
    property: "radius",
    bind: (field) => bound.push(field),
  });

  assert.deepEqual(fields, [
    "topLeftRadius",
    "topRightRadius",
    "bottomRightRadius",
    "bottomLeftRadius",
  ]);
  assert.deepEqual(bound, fields);
});

test("absolute source children stay out of Auto Layout flow and retain top-right geometry", () => {
  const child = {
    layoutPositioning: "AUTO",
    constraints: { horizontal: "MIN", vertical: "MIN" },
    x: 0,
    y: 0,
  };

  applySourceChildPlacement({
    parentLayoutMode: "HORIZONTAL",
    source: {
      x: 34,
      y: -3,
      layoutPositioning: "ABSOLUTE",
      constraints: { horizontal: "MAX", vertical: "MIN" },
    },
    child,
  });

  assert.equal(child.layoutPositioning, "ABSOLUTE");
  assert.deepEqual(child.constraints, {
    horizontal: "MAX",
    vertical: "MIN",
  });
  assert.equal(child.x, 34);
  assert.equal(child.y, -3);
});

test("manual variant grids preserve exact source sizes instead of Auto Layout reflow", () => {
  const componentSet = {
    layoutMode: "VERTICAL",
    width: 0,
    height: 0,
    resizeWithoutConstraints(width, height) {
      this.width = width;
      this.height = height;
    },
  };
  const nodes = Array.from({ length: 5 }, () => ({
    width: 18,
    height: 54,
    x: 0,
    y: 0,
    resizeWithoutConstraints(width, height) {
      this.width = width;
      this.height = height;
    },
  }));

  layoutManualVariantGrid({
    componentSet,
    items: nodes.map((node) => ({ node, width: 28, height: 28 })),
    columns: 3,
    gap: 24,
    padding: 40,
  });

  assert.equal(componentSet.layoutMode, "NONE");
  assert.deepEqual(
    nodes.map(({ width, height, x, y }) => ({ width, height, x, y })),
    [
      { width: 28, height: 28, x: 40, y: 40 },
      { width: 28, height: 28, x: 92, y: 40 },
      { width: 28, height: 28, x: 144, y: 40 },
      { width: 28, height: 28, x: 40, y: 92 },
      { width: 28, height: 28, x: 92, y: 92 },
    ],
  );
  assert.equal(componentSet.width, 212);
  assert.equal(componentSet.height, 160);
});
