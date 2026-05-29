import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.js";
import { dispatchOnce } from "../src/dispatcher.js";
import { addToBlacklist, createStore, enqueueMessage } from "../src/store.js";
import { createDryRunSender } from "../src/senders/dryRun.js";

test("dispatchOnce marks blacklisted queued messages as blocked", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "sms-dispatch-"));
  const store = await createStore(path.join(dir, "queue.json"));
  await addToBlacklist(store, "+420777123456");
  const message = await enqueueMessage(store, {
    to: "+420777123456",
    text: "Blocked",
    kind: "service"
  });

  const result = await dispatchOnce({
    store,
    sender: createDryRunSender(),
    config: loadConfig({ quietHoursStart: "00:00", quietHoursEnd: "00:00" }),
    now: new Date("2026-05-29T10:00:00.000Z")
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.message.id, message.id);

  const state = await store.read();
  assert.equal(state.messages[0].status, "blocked");
});
