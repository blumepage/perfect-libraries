import assert from "node:assert/strict";
import test from "node:test";

import { createDocumentationPlan } from "../dist/documentation-plan.mjs";

test("documentation plan keeps exact combinations and reverse relationships", () => {
  const plan = createDocumentationPlan([
    {
      id: "heading",
      name: "Heading",
      documentation: { group: "Foundations" },
      variants: [
        { id: "heading-sm", sourceNode: "Heading / Small", properties: { Size: "Small" } },
      ],
    },
    {
      id: "button",
      name: "Button",
      description: "Triggers an action.",
      documentation: {
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
