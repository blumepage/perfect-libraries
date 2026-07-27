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
    ["Primary · Small", "Link · Medium"],
  );
  assert.deepEqual(button.combinations[0].properties, [
    { name: "Style", value: "Primary" },
    { name: "Size", value: "Small" },
  ]);
  assert.equal(
    button.combinations[0].explanation,
    "Style is set to Primary. Size is set to Small.",
  );
  assert.equal(button.group, "Controls");
  assert.deepEqual(button.guidance, [
    "Choose Style and Size through the component variant controls. The supported values are documented below.",
    "Keep the component as a linked instance so future library updates continue to apply.",
  ]);
  assert.deepEqual(button.uses, ["Heading"]);
  assert.deepEqual(plan.groups[0].components[0].usedBy, ["Button"]);
});

test("documentation copy remains complete for a component without variant axes", () => {
  const plan = createDocumentationPlan([
    {
      id: "divider",
      name: "Divider",
      documentationUrl: "https://storybook.example.test/divider",
      variants: [
        { id: "divider-default", sourceNode: "Divider", properties: {} },
      ],
    },
  ]);

  const divider = plan.groups[0].components[0];
  assert.equal(divider.combinations[0].label, "Default");
  assert.equal(
    divider.combinations[0].explanation,
    "The default configuration from Storybook.",
  );
  assert.deepEqual(divider.guidance, [
    "This component has one supported visual configuration in the current library release.",
    "Keep the component as a linked instance so future library updates continue to apply.",
    "Use the linked Storybook story as the implementation and behavior reference.",
  ]);
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
