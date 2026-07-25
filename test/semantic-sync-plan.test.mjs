import assert from "node:assert/strict";
import test from "node:test";

import { createSemanticSyncPlan } from "../dist/semantic-sync-plan.mjs";

test("finishes dependency properties before consumer nested overrides", () => {
  assert.deepEqual(createSemanticSyncPlan(["badge", "card"]), [
    { componentId: "badge", phase: "nested-instances" },
    { componentId: "badge", phase: "component-properties" },
    { componentId: "card", phase: "nested-instances" },
    { componentId: "card", phase: "component-properties" },
  ]);
});
