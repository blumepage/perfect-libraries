import assert from "node:assert/strict";
import test from "node:test";

import { createDocumentationPlan } from "../dist/documentation-plan.mjs";

test("documentation plan keeps exact combinations and reverse relationships", () => {
  const plan = createDocumentationPlan([
    {
      id: "heading",
      name: "Heading",
      documentation: { groupId: "foundations", group: "Foundations" },
      variants: [
        { id: "heading-sm", sourceNode: "Heading / Small", properties: { Size: "Small" } },
      ],
    },
    {
      id: "button",
      name: "Button",
      description: "Triggers an action.",
      documentation: {
        groupId: "controls",
        group: "Controls",
        controls: [{ name: "disabled", type: "boolean", defaultValue: false }],
      },
      dependencies: ["heading"],
      variants: [
        {
          id: "button-primary-small",
          sourceNode: "Button / Primary / Small",
          properties: { Style: "Primary", Size: "Small" },
        },
        {
          id: "button-link-medium",
          sourceNode: "Button / Link / Medium",
          properties: { Style: "Link", Size: "Medium" },
        },
      ],
    },
  ]);

  assert.deepEqual(plan.groups.map((group) => group.name), ["Foundations", "Controls"]);
  const button = plan.groups[1].components[0];
  assert.deepEqual(button.axes, [
    { name: "Style", values: ["Primary", "Link"] },
    { name: "Size", values: ["Small", "Medium"] },
  ]);
  assert.deepEqual(
    button.combinations.map((combination) => combination.label),
    ["Style=Primary · Size=Small", "Style=Link · Size=Medium"],
  );
  assert.deepEqual(button.uses, ["Heading"]);
  assert.deepEqual(plan.groups[0].components[0].usedBy, ["Button"]);
});

test("documentation group ids are unique and reject conflicting names", () => {
  const components = [
    {
      id: "first",
      name: "First",
      documentation: { group: "A/B" },
      variants: [{ id: "first-default", sourceNode: "First", properties: { State: "Default" } }],
    },
    {
      id: "second",
      name: "Second",
      documentation: { group: "A B" },
      variants: [{ id: "second-default", sourceNode: "Second", properties: { State: "Default" } }],
    },
  ];
  const plan = createDocumentationPlan(components);
  assert.equal(new Set(plan.groups.map((group) => group.id)).size, 2);

  components[0].documentation.groupId = "shared";
  components[1].documentation.groupId = "shared";
  assert.throws(() => createDocumentationPlan(components), /used by both/);
});
