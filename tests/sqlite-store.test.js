import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createStore, enqueueMessage } from "../src/store.js";

test("SQLite store migrates schema and persists state across instances", async () => {
  const dbPath = await tempDbPath();
  const store = await createStore(dbPath);

  await enqueueMessage(store, {
    to: "+420777123456",
    text: "Persistent",
    kind: "service"
  });

  const reopened = await createStore(dbPath);
  const state = await reopened.read();
  assert.equal(state.messages.length, 1);
  assert.equal(state.messages[0].text, "Persistent");
  assert.equal(state.schemaVersion, 1);
});

test("SQLite store imports legacy JSON state once", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "sms-import-"));
  const jsonPath = path.join(dir, "queue.json");
  const dbPath = path.join(dir, "sms-bridge.sqlite");
  await writeFile(jsonPath, JSON.stringify({
    contacts: [{ id: "c1", name: "Jana", phone: "+420777123456", marketingConsent: true }],
    messages: [{ id: "m1", to: "+420777123456", text: "Legacy", kind: "service", status: "queued" }],
    blacklist: ["+420777999999"],
    audit: [{ id: "a1", action: "legacy", createdAt: "2026-05-29T00:00:00.000Z" }]
  }));

  const store = await createStore(dbPath);
  const result = await store.importJson(jsonPath);
  const state = await store.read();

  assert.equal(result.imported, true);
  assert.equal(state.contacts.length, 1);
  assert.equal(state.messages.length, 1);
  assert.equal(state.blacklist.length, 1);
  assert.equal(state.audit.length, 1);

  const second = await store.importJson(jsonPath);
  assert.equal(second.imported, false);
  assert.equal((await store.read()).messages.length, 1);
});

test("SQLite store can export JSON backup", async () => {
  const dbPath = await tempDbPath();
  const store = await createStore(dbPath);
  await enqueueMessage(store, {
    to: "+420777123456",
    text: "Backup",
    kind: "service"
  });

  const backup = await store.exportJson();
  const parsed = JSON.parse(await readFile(backup.path, "utf8"));
  assert.equal(backup.messages, 1);
  assert.equal(parsed.messages[0].text, "Backup");
});

async function tempDbPath() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "sms-sqlite-"));
  return path.join(dir, "sms-bridge.sqlite");
}
