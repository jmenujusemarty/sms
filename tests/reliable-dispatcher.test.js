import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { dispatchOnce, recoverStaleSending } from "../src/dispatcher.js";
import { loadConfig } from "../src/config.js";
import { createStore, enqueueMessage } from "../src/store.js";
import { createDryRunSender } from "../src/senders/dryRun.js";

test("recoverStaleSending returns stale sending messages to retry", async () => {
  const store = await testStore();
  await enqueueMessage(store, { to: "+420777123456", text: "Recover", kind: "service" });
  await store.mutate((state) => {
    state.messages[0].status = "sending";
    state.messages[0].updatedAt = "2026-05-29T09:00:00.000Z";
  });

  const result = await recoverStaleSending(store, new Date("2026-05-29T10:00:00.000Z"), 10 * 60 * 1000);
  const state = await store.read();
  assert.equal(result.recovered, 1);
  assert.equal(state.messages[0].status, "retry");
});

test("dispatchOnce marks message failed after max attempts", async () => {
  const store = await testStore();
  await enqueueMessage(store, { to: "+420777123456", text: "Fail", kind: "service" });
  await store.mutate((state) => {
    state.messages[0].attempts = 2;
    state.messages[0].nextAttemptAt = "2026-05-29T09:00:00.000Z";
  });

  const result = await dispatchOnce({
    store,
    sender: { name: "broken", send: async () => { throw new Error("boom"); } },
    config: loadConfig({ maxAttempts: 3, quietHoursStart: "00:00", quietHoursEnd: "00:00" }),
    now: new Date("2026-05-29T10:00:00.000Z")
  });

  assert.equal(result.status, "failed");
  const state = await store.read();
  assert.equal(state.messages[0].status, "failed");
  assert.equal(state.messages[0].lastError, "boom");
});

test("dispatchOnce uses a lock to avoid parallel sends", async () => {
  const store = await testStore();
  await enqueueMessage(store, { to: "+420777123456", text: "Lock", kind: "service" });
  await store.mutate((state) => {
    state.messages[0].nextAttemptAt = "2026-05-29T09:00:00.000Z";
  });
  const sender = createDryRunSender();
  const config = loadConfig({ quietHoursStart: "00:00", quietHoursEnd: "00:00" });

  const [first, second] = await Promise.all([
    dispatchOnce({ store, sender, config, now: new Date("2026-05-29T10:00:00.000Z") }),
    dispatchOnce({ store, sender, config, now: new Date("2026-05-29T10:00:00.000Z") })
  ]);

  const statuses = [first.status, second.status].sort();
  assert.deepEqual(statuses, ["locked", "sent"]);
});

async function testStore() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "sms-dispatcher-"));
  return createStore(path.join(dir, "sms-bridge.sqlite"));
}
