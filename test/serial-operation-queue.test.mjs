import assert from "node:assert/strict";
import test from "node:test";
import { SerialOperationQueue } from "../dist/serial-operation-queue.mjs";

test("serializes concurrent operations", async () => {
  const queue = new SerialOperationQueue();
  const events = [];
  let active = 0;
  let maxActive = 0;

  const run = (name) =>
    queue.run(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      events.push(`${name}:start`);
      await Promise.resolve();
      events.push(`${name}:end`);
      active -= 1;
      return name;
    });

  const results = await Promise.all([run("inspect"), run("apply")]);

  assert.deepEqual(results, ["inspect", "apply"]);
  assert.equal(maxActive, 1);
  assert.deepEqual(events, [
    "inspect:start",
    "inspect:end",
    "apply:start",
    "apply:end",
  ]);
});

test("continues after a rejected operation", async () => {
  const queue = new SerialOperationQueue();
  const failed = queue.run(async () => {
    throw new Error("failed");
  });
  const recovered = queue.run(async () => "recovered");

  await assert.rejects(failed, /failed/);
  assert.equal(await recovered, "recovered");
});
