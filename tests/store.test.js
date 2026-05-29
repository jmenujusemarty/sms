import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { addToBlacklist, createStore, enqueueMessage, normalizePhone } from "../src/store.js";

test("normalizePhone accepts international numbers and strips spaces", () => {
  assert.equal(normalizePhone("+420 777 123 456"), "+420777123456");
});

test("enqueueMessage persists queued message", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "sms-bridge-"));
  const store = await createStore(path.join(dir, "queue.json"));

  const message = await enqueueMessage(store, {
    to: "+420777123456",
    text: "Test",
    kind: "service"
  });

  const state = await store.read();
  assert.equal(state.messages.length, 1);
  assert.equal(state.messages[0].id, message.id);
  assert.equal(state.messages[0].status, "queued");
});

test("addToBlacklist persists one normalized number once", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "sms-bridge-"));
  const store = await createStore(path.join(dir, "queue.json"));

  await addToBlacklist(store, "+420 777 123 456");
  await addToBlacklist(store, "+420777123456");

  const state = await store.read();
  assert.deepEqual(state.blacklist, ["+420777123456"]);
});
