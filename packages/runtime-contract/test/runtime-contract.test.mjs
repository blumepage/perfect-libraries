import assert from "node:assert/strict";
import test from "node:test";

import {
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
