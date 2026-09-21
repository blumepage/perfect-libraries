import assert from "node:assert/strict";
import test from "node:test";

import { createSemanticSyncPlan, partitionSlotBindings } from "../dist/semantic-sync-plan.mjs";

test("finishes dependency properties before consumer nested overrides", () => {
  assert.deepEqual(createSemanticSyncPlan(["badge", "card"]), [
    { componentId: "badge", phase: "nested-instances" },
    { componentId: "badge", phase: "component-properties" },
    { componentId: "card", phase: "nested-instances" },
    { componentId: "card", phase: "component-properties" },
  ]);
});

test("defers only replaced slot-container bindings, preserving source paths under nested instances", () => {
  const bindings = [
    {layer:"Items",property:"fill",token:"surface"},
    {layer:"Items/Row/Label",property:"text-fill",token:"text"},
    {layer:"Icon/vector",property:"fill",token:"icon"},
    {layer:"ItemsExtra",property:"fill",token:"other"},
  ];
  assert.deepEqual(partitionSlotBindings(bindings,[{name:"Items",layer:"Items"}]), {
    beforeComposition: bindings.slice(1), afterSlots: [bindings[0]],
  });
  assert.deepEqual(partitionSlotBindings(bindings), {beforeComposition:bindings,afterSlots:[]});
});
